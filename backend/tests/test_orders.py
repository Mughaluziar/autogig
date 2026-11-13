"""Unified order detection, verification and tracking."""
import hashlib
import hmac
import json
from datetime import timedelta

import pytest

from conftest import bearer, run, signup
from app.config import get_settings
from app.orders import service, store
from app.orders.adapters import get_adapter
from app.orders.adapters.base import AccessRevoked, AccountIdentity, AdapterError
from app.orders.adapters.freelancer import FreelancerAdapter, _status
from app.orders.adapters.upwork import UpworkAdapter
from app.orders.models import OrderSignal, OrderStatus, Source
from app.routers import orders as orders_router

WEBHOOK = {"Authorization": "Bearer test-webhook-secret"}


@pytest.fixture
def inbound(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "inbound_email_domain", "in.example.test")
    monkeypatch.setattr(settings, "inbound_email_webhook_secret", "test-webhook-secret")
    monkeypatch.setattr(settings, "inbound_email_platforms", "Fiverr,Upwork")


class FakeUpwork:
    """Stands in for the Upwork API: offers keyed by the account's user id."""

    def __init__(self, monkeypatch):
        self.adapter = get_adapter("Upwork")
        self.offers: dict[str, list[OrderSignal]] = {}
        self.fail: Exception | None = None
        self.calls = 0
        identities = {"conn-a": "uw-a", "conn-b": "uw-b"}
        monkeypatch.setattr(self.adapter, "api_enabled", lambda settings: True)
        monkeypatch.setattr(orders_router, "_api_connect_ready", lambda *a: True)

        async def no_connection_check(*args):
            return {}

        async def identify(account):
            cid = account["connection"]["connectionId"]
            return AccountIdentity(external_account_id=identities[cid], handle=cid)

        async def list_orders(account):
            self.calls += 1
            if self.fail:
                raise self.fail
            return list(self.offers.get(account["external_account_id"], []))

        async def fetch_order(account, external_id):
            self.calls += 1
            if self.fail:
                raise self.fail
            return next((o for o in self.offers.get(account["external_account_id"], [])
                         if o.external_order_id == external_id), None)

        monkeypatch.setattr(orders_router, "verify_upwork_connection", no_connection_check)
        monkeypatch.setattr(self.adapter, "identify", identify)
        monkeypatch.setattr(self.adapter, "list_orders", list_orders)
        monkeypatch.setattr(self.adapter, "fetch_order", fetch_order)

    def offer(self, account_ext: str, order_id: str, title: str, amount: float = 500.0,
              status: OrderStatus = OrderStatus.ACTIVE) -> OrderSignal:
        signal = OrderSignal(platform="Upwork", source=Source.API_SYNC, external_order_id=order_id,
                             title=title, client_name="Acme", amount=amount, currency="USD",
                             status=status, created_at="2026-11-01T10:00:00Z", authoritative=True)
        self.offers.setdefault(account_ext, [o for o in self.offers.get(account_ext, [])
                                             if o.external_order_id != order_id]).append(signal)
        return signal


@pytest.fixture
def upwork(monkeypatch):
    return FakeUpwork(monkeypatch)


def connect_upwork(client, headers, connection_id, label=""):
    res = client.post("/api/orders/accounts", headers=headers,
                      json={"platform": "Upwork", "mode": "api", "connectionId": connection_id, "label": label})
    assert res.status_code == 200, res.text
    return res.json()


def orders(client, headers, **params):
    res = client.get("/api/orders", headers=headers, params=params)
    assert res.status_code == 200, res.text
    return res.json()


# --------------------------------------------------------------------------- #
# Email detection
# --------------------------------------------------------------------------- #
def test_fiverr_email_order_is_detected_deduplicated_and_never_verified(client, inbound):
    alice = bearer(signup(client, email="fv-alice@example.com")["token"])
    account = client.post("/api/orders/accounts", headers=alice, json={"platform": "Fiverr", "label": "Logos"}).json()
    assert account["connection"] == "email" and account["inboundAddress"].startswith("o-")

    email = {"To": account["inboundAddress"], "From": "Fiverr <noreply@fiverr.com>",
             "Subject": "You've received an order from mira_k", "TextBody": "Order #FO8C21D4A9E1 for $180.00",
             "MessageID": "<fv-order-1@example.test>"}
    assert client.post("/api/inbox/inbound", headers=WEBHOOK, json=email).json()["duplicate"] is False
    client.post("/api/inbox/inbound", headers=WEBHOOK, json=email)  # replayed delivery

    rows = orders(client, alice)["orders"]
    assert len(rows) == 1
    order = rows[0]
    assert order["externalOrderId"] == "FO8C21D4A9E1"
    assert order["accountId"] == account["id"] and order["clientName"] == "mira_k"
    assert order["amount"] == 180.0 and order["currency"] == "USD"
    assert order["verification"]["status"] == "unverifiable"
    # The message still reaches the unified inbox.
    assert client.get("/api/conversations", headers=alice).json()


def test_email_without_a_matching_account_stays_unassigned_until_linked(client, inbound):
    alice = bearer(signup(client, email="fv-two@example.com")["token"])
    for label in ("One", "Two"):
        client.post("/api/orders/accounts", headers=alice, json={"platform": "Fiverr", "label": label})
    address = client.get("/api/inbox/address", headers=alice).json()["address"]
    client.post("/api/inbox/inbound", headers=WEBHOOK, json={
        "To": address, "From": "noreply@fiverr.com", "Subject": "New order received",
        "TextBody": "Order #FO11AA22BB33", "MessageID": "<fv-2@example.test>"})
    order = orders(client, alice)["orders"][0]
    assert order["accountId"] is None and order["accountLabel"] == "Unassigned"

    target = client.get("/api/orders/accounts", headers=alice).json()[1]
    linked = client.patch(f"/api/orders/{order['id']}/account", headers=alice, json={"accountId": target["id"]})
    assert linked.status_code == 200 and linked.json()["accountId"] == target["id"]


def test_non_order_email_creates_no_order(client, inbound):
    alice = bearer(signup(client, email="fv-msg@example.com")["token"])
    address = client.get("/api/inbox/address", headers=alice).json()["address"]
    client.post("/api/inbox/inbound", headers=WEBHOOK, json={
        "To": address, "From": "noreply@fiverr.com", "Subject": "You have a new message",
        "TextBody": "Hi there", "MessageID": "<fv-3@example.test>"})
    assert orders(client, alice)["orders"] == []


# --------------------------------------------------------------------------- #
# API sync, multi-account, verification
# --------------------------------------------------------------------------- #
def test_two_accounts_on_one_platform_keep_their_own_orders(client, upwork):
    alice = bearer(signup(client, email="uw-multi@example.com")["token"])
    upwork.offer("uw-a", "1001", "Dashboard build")
    upwork.offer("uw-b", "2002", "API work", amount=900)
    a = connect_upwork(client, alice, "conn-a", "Agency")
    b = connect_upwork(client, alice, "conn-b", "Personal")
    assert client.post("/api/orders/accounts", headers=alice,
                       json={"platform": "Upwork", "mode": "api", "connectionId": "conn-a"}).status_code == 409

    rows = {o["externalOrderId"]: o for o in orders(client, alice)["orders"]}
    assert rows["1001"]["accountId"] == a["id"] and rows["2002"]["accountId"] == b["id"]
    assert all(o["verification"]["status"] == "verified" for o in rows.values())
    assert orders(client, alice, account=b["id"])["summary"]["total"] == 1

    # Re-syncing never duplicates; a status change is detected and audited.
    upwork.offer("uw-a", "1001", "Dashboard build", status=OrderStatus.CANCELLED)
    assert client.post(f"/api/orders/accounts/{a['id']}/sync", headers=alice).json()["status"] == "ok"
    client.post(f"/api/orders/accounts/{a['id']}/sync", headers=alice)
    rows = orders(client, alice)["orders"]
    assert len(rows) == 2
    cancelled = next(o for o in rows if o["externalOrderId"] == "1001")
    assert cancelled["status"] == "cancelled"
    events = client.get(f"/api/orders/{cancelled['id']}", headers=alice).json()["events"]
    assert any(e["type"] == "status_changed" and e["data"].get("to") == "cancelled" for e in events)


def test_first_sync_backfills_without_a_notification_per_order(client, upwork):
    alice = bearer(signup(client, email="uw-backfill@example.com")["token"])
    for i in range(5):
        upwork.offer("uw-a", f"30{i}", f"Old job {i}")
    connect_upwork(client, alice, "conn-a")
    notes = client.get("/api/notifications", headers=alice).json()
    assert len([n for n in notes if "order" in n["title"].lower() or "connected" in n["title"].lower()]) == 1


def test_arrival_time_marks_new_live_orders_only(client, upwork):
    """`arrivedAt` opens the protection window: set when an order first shows
    up as live work, never for a backfill, and for an offer when it starts."""
    alice = bearer(signup(client, email="uw-arrival@example.com")["token"])
    upwork.offer("uw-a", "400", "Imported")
    account = connect_upwork(client, alice, "conn-a")
    upwork.offer("uw-a", "401", "New order")
    upwork.offer("uw-a", "402", "Offer", status=OrderStatus.OFFER)
    client.post(f"/api/orders/accounts/{account['id']}/sync", headers=alice)
    by_id = {o["externalOrderId"]: o for o in orders(client, alice)["orders"]}
    assert by_id["400"]["arrivedAt"] is None
    assert by_id["401"]["arrivedAt"] is not None
    assert by_id["402"]["arrivedAt"] is None

    upwork.offer("uw-a", "402", "Offer", status=OrderStatus.ACTIVE)
    client.post(f"/api/orders/accounts/{account['id']}/sync", headers=alice)
    by_id = {o["externalOrderId"]: o for o in orders(client, alice)["orders"]}
    assert by_id["402"]["arrivedAt"] is not None and by_id["400"]["arrivedAt"] is None


def test_email_signal_is_only_verified_by_the_platform(client, inbound, upwork):
    alice = bearer(signup(client, email="uw-email@example.com")["token"])
    account = connect_upwork(client, alice, "conn-a")
    email = {"To": account["inboundAddress"], "From": "Upwork <donotreply@upwork.com>",
             "Subject": "You received an offer: Data pipeline",
             "TextBody": "Offer for $400. View it at https://www.upwork.com/nx/offers/5555555",
             "MessageID": "<uw-offer@example.test>"}
    # The platform doesn't know the order yet: the email alone proves nothing.
    client.post("/api/inbox/inbound", headers=WEBHOOK, json=email)
    order = orders(client, alice)["orders"][0]
    assert order["externalOrderId"] == "5555555"
    assert order["verification"]["status"] == "rejected"

    upwork.offer("uw-a", "5555555", "Data pipeline", amount=450)
    verified = client.post(f"/api/orders/{order['id']}/verify", headers=alice).json()
    assert verified["verification"]["status"] == "verified"
    assert verified["amount"] == 450  # the platform value wins over the email
    assert verified["verification"]["evidence"]["method"] == "platform_api"
    events = client.get(f"/api/orders/{order['id']}", headers=alice).json()["events"]
    assert any(e["type"] == "field_mismatch" for e in events)


def test_email_order_without_api_access_waits_instead_of_guessing(client, inbound):
    alice = bearer(signup(client, email="uw-noapi@example.com")["token"])
    account = client.post("/api/orders/accounts", headers=alice, json={"platform": "Upwork"}).json()
    client.post("/api/inbox/inbound", headers=WEBHOOK, json={
        "To": account["inboundAddress"], "From": "donotreply@upwork.com",
        "Subject": "Your contract has started: Mobile app", "TextBody": "Good luck!", "MessageID": "<uw-c@x>"})
    order = orders(client, alice)["orders"][0]
    assert order["verification"]["status"] == "pending"
    assert "email-only" in order["verification"]["reason"]
    assert order["title"] == "Mobile app" and order["status"] == "active"


def test_transient_errors_retry_with_backoff_then_fail(client, upwork):
    alice = bearer(signup(client, email="uw-retry@example.com")["token"])
    account = connect_upwork(client, alice, "conn-a")
    stored = run(client, store.get_account, _uid(client, "uw-retry@example.com"), account["id"])
    signal = OrderSignal(platform="Upwork", source=Source.EMAIL, external_order_id="777", title="Retry me",
                         signal_ref="r-1")
    order = run(client, service.ingest, stored["user_id"], signal, stored).order
    upwork.fail = AdapterError("Upwork API returned 503.")
    for attempt in range(1, service.MAX_VERIFY_ATTEMPTS + 1):
        result = client.post(f"/api/orders/{order['id']}/verify", headers=alice).json()["verification"]
        expected = "failed" if attempt == service.MAX_VERIFY_ATTEMPTS else "pending"
        assert result["status"] == expected and result["attempts"] == attempt
    assert result["nextAttemptAt"] is None


def test_revoked_access_fails_verification_and_flags_the_account(client, upwork):
    alice = bearer(signup(client, email="uw-revoked@example.com")["token"])
    account = connect_upwork(client, alice, "conn-a")
    upwork.fail = AccessRevoked("token expired")
    result = client.post(f"/api/orders/accounts/{account['id']}/sync", headers=alice).json()
    assert result["status"] == "error" and result["account"]["status"] == "needs_reauth"
    events = client.get("/api/orders/events", headers=alice).json()
    assert any(e["type"] == "sync_failed" for e in events)


def test_verified_orders_cannot_be_dismissed_but_unverified_ones_can(client, upwork, inbound):
    alice = bearer(signup(client, email="uw-dismiss@example.com")["token"])
    upwork.offer("uw-a", "42", "Real job")
    connect_upwork(client, alice, "conn-a")
    real = orders(client, alice)["orders"][0]
    assert client.post(f"/api/orders/{real['id']}/dismiss", headers=alice).status_code == 409

    fiverr = client.post("/api/orders/accounts", headers=alice, json={"platform": "Fiverr"}).json()
    client.post("/api/inbox/inbound", headers=WEBHOOK, json={
        "To": fiverr["inboundAddress"], "From": "noreply@fiverr.com", "Subject": "New order",
        "TextBody": "#FO99887766", "MessageID": "<fake@x>"})
    fake = orders(client, alice, platform="Fiverr")["orders"][0]
    dismissed = client.post(f"/api/orders/{fake['id']}/dismiss", headers=alice).json()
    assert dismissed["verification"]["status"] == "rejected" and dismissed["verification"]["dismissed"]


def test_orders_and_accounts_are_private_to_their_user(client, upwork):
    alice = bearer(signup(client, email="uw-priv-a@example.com")["token"])
    bob = bearer(signup(client, email="uw-priv-b@example.com")["token"])
    upwork.offer("uw-a", "9", "Private")
    account = connect_upwork(client, alice, "conn-a")
    order = orders(client, alice)["orders"][0]
    assert orders(client, bob)["orders"] == []
    assert client.get(f"/api/orders/{order['id']}", headers=bob).status_code == 404
    assert client.post(f"/api/orders/{order['id']}/verify", headers=bob).status_code == 404
    assert client.post(f"/api/orders/accounts/{account['id']}/sync", headers=bob).status_code == 404
    assert client.get("/api/orders", params={"account": account["id"]}, headers=bob).json()["orders"] == []


def test_filters_and_search(client, upwork):
    alice = bearer(signup(client, email="uw-filter@example.com")["token"])
    upwork.offer("uw-a", "100", "Landing page", status=OrderStatus.COMPLETED)
    upwork.offer("uw-a", "200", "Mobile app")
    connect_upwork(client, alice, "conn-a")
    assert [o["externalOrderId"] for o in orders(client, alice, q="landing")["orders"]] == ["100"]
    assert [o["externalOrderId"] for o in orders(client, alice, status="active")["orders"]] == ["200"]
    assert orders(client, alice, verification="verified")["summary"]["total"] == 2
    assert orders(client, alice, platform="Fiverr")["summary"]["total"] == 0
    assert orders(client, alice, **{"from": "2026-11-01", "to": "2026-11-01"})["summary"]["total"] == 2
    assert orders(client, alice, **{"from": "2026-11-02"})["summary"]["total"] == 0
    assert orders(client, alice)["summary"]["verifiedValue"] == {"USD": 1000.0}
    assert client.get("/api/orders", headers=alice, params={"verification": "maybe"}).status_code == 422


def test_retention_clears_upwork_data_that_was_not_refreshed(client, upwork):
    alice = bearer(signup(client, email="uw-retain@example.com")["token"])
    upwork.offer("uw-a", "55", "Short-lived")
    account = connect_upwork(client, alice, "conn-a")
    order = orders(client, alice)["orders"][0]
    uid = _uid(client, "uw-retain@example.com")
    stale = store.now() - timedelta(hours=25)
    current = run(client, store.get_order, uid, order["id"])
    run(client, _force, uid, order["id"], {"last_synced_at": stale}, current["version"])
    assert run(client, service.enforce_retention)["cleared"] == 1
    cleared = orders(client, alice)["orders"][0]
    assert cleared["dataExpired"] and cleared["title"] is None and cleared["amount"] is None
    assert cleared["verification"]["status"] == "verified"  # the fact of verification is our own record

    client.post(f"/api/orders/accounts/{account['id']}/sync", headers=alice)
    restored = orders(client, alice)["orders"][0]
    assert not restored["dataExpired"] and restored["title"] == "Short-lived"


def test_nango_webhook_requires_a_valid_signature_and_only_hints(client, upwork, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "nango_webhook_signing_key", "signing-key")
    session = signup(client, email="uw-hook@example.com")
    alice = bearer(session["token"])
    # Upwork itself now connects directly (app/upwork/); the handler serves any
    # account whose API connection runs through Nango, so add one as such.
    account = run(client, store.add_account, session["user"]["id"], {
        "platform": "Upwork", "label": "Through Nango", "status": "active", "consecutive_failures": 0,
        "connection": {"kind": "nango", "integrationId": "upwork", "connectionId": "conn-a"},
        "external_account_id": "uw-a", "handle": "conn-a",
    })
    direct = connect_upwork(client, alice, "conn-b")
    monkeypatch.setattr(upwork.adapter, "webhook_order_ids", lambda payload: [payload.get("id")])
    body = json.dumps({"type": "forward", "from": "upwork", "providerConfigKey": "upwork",
                       "connectionId": "conn-a", "payload": {"entity": "OFFER", "action": "CREATE", "id": "808"}})
    sig = hmac.new(b"signing-key", body.encode(), hashlib.sha256).hexdigest()

    bad = client.post("/api/orders/webhooks/nango", content=body, headers={"X-Nango-Hmac-Sha256": "0" * 64})
    assert bad.status_code == 401

    # Not on the account: logged, nothing stored.
    ok = client.post("/api/orders/webhooks/nango", content=body, headers={"X-Nango-Hmac-Sha256": sig})
    assert ok.status_code == 200 and ok.json()["matched"] == 1
    assert orders(client, alice)["orders"] == []

    upwork.offer("uw-a", "808", "Hooked")
    client.post("/api/orders/webhooks/nango", content=body, headers={"X-Nango-Hmac-Sha256": sig})
    order = orders(client, alice)["orders"][0]
    assert order["verification"]["status"] == "verified" and order["accountId"] == account["id"]

    # A direct Upwork OAuth connection is never matched by a Nango webhook.
    other = json.dumps({"type": "forward", "from": "upwork", "providerConfigKey": "upwork",
                        "connectionId": "conn-b", "payload": {"entity": "OFFER", "action": "CREATE", "id": "909"}})
    res = client.post("/api/orders/webhooks/nango", content=other,
                      headers={"X-Nango-Hmac-Sha256": hmac.new(b"signing-key", other.encode(), hashlib.sha256).hexdigest()})
    assert res.json()["matched"] == 0 and direct["connection"] == "upwork_oauth"


def test_capabilities_report_limits_honestly(client):
    alice = bearer(signup(client, email="caps@example.com")["token"])
    report = client.get("/api/orders/capabilities", headers=alice).json()
    by_name = {p["platform"]: p for p in report["platforms"]}
    assert by_name["Fiverr"]["verification"] == "none" and by_name["Fiverr"]["detection"] == ["email"]
    assert by_name["Upwork"]["apiEnabled"] is False and by_name["Upwork"]["canConnectApi"] is False
    assert by_name["Freelancer.com"]["connection"] == "platform_token"
    assert any(u["platform"] == "Toptal" for u in report["unsupported"])
    blocked = client.post("/api/orders/accounts", headers=alice, json={"platform": "Upwork", "mode": "api", "connectionId": "x"})
    assert blocked.status_code == 503
    assert client.post("/api/orders/accounts", headers=alice, json={"platform": "Fiverr", "mode": "api"}).status_code == 422


def test_settings_patch_cannot_overwrite_server_owned_connection_keys(client):
    alice = bearer(signup(client, email="settings-owned@example.com")["token"])
    for key in ("nangoConnections", "inboundTokenHash", "bidRules"):
        res = client.patch("/api/settings", headers=alice, json={key: {"upwork": {"connectionId": "someone-elses"}}})
        assert res.status_code == 422
    assert client.patch("/api/settings", headers=alice, json={"profile": {"title": "Dev"}}).status_code == 200


# --------------------------------------------------------------------------- #
# Adapter units
# --------------------------------------------------------------------------- #
def test_fiverr_parser_statuses():
    fiverr = get_adapter("fiverr")
    assert fiverr.parse_email("Your order was cancelled", "#FO1234567A").status == OrderStatus.CANCELLED
    assert fiverr.parse_email("Order completed", "").status == OrderStatus.COMPLETED
    assert fiverr.parse_email("You have a new message", "") is None


def test_upwork_offer_mapping_handles_money_objects_and_lists():
    adapter = UpworkAdapter()
    signal = adapter._from_offer({
        "id": "11", "title": "Build", "client": {"id": "c1", "name": "Acme"},
        "offerTerms": {"fixedPriceTerm": {"budget": {"rawValue": "1250.50", "currency": "USD"}}},
        "milestones": [{"id": "m1", "description": "Phase 1", "state": "Active",
                        "depositAmount": {"rawValue": "500", "currency": "USD"}}],
    }, OrderStatus.ACTIVE)
    assert (signal.amount, signal.currency, signal.client_name) == (1250.5, "USD", "Acme")
    assert signal.milestones[0].amount == 500.0 and signal.authoritative
    hourly = adapter._from_offer({"id": "12", "offerTerms": {"hourlyTerms": [{"rate": {"rawValue": 60, "currency": "USD"}}]}}, None)
    assert hourly.amount == 60.0 and hourly.status is None
    assert adapter.parse_email("Your contract has started: Mobile app", "").title == "Mobile app"


def test_freelancer_status_mapping():
    assert _status({"award_status": "revoked"}, []) == OrderStatus.CANCELLED
    assert _status({"award_status": "awarded", "time_accepted": 1}, []) == OrderStatus.ACTIVE
    assert _status({"award_status": "awarded"}, []) == OrderStatus.OFFER
    assert _status({"award_status": "awarded", "complete_status": "complete"}, []) == OrderStatus.COMPLETED
    assert _status({"award_status": "awarded", "time_accepted": 1}, [{"status": "disputed"}]) == OrderStatus.DISPUTED


def test_freelancer_list_orders_builds_verified_signals(monkeypatch):
    adapter = FreelancerAdapter()
    monkeypatch.setattr(adapter, "api_enabled", lambda settings: True)
    responses = {
        "/projects/0.1/bids/": {"bids": [
            {"id": 1, "project_id": 900001, "bidder_id": 77, "amount": 300, "award_status": "awarded", "time_accepted": 1700000000, "time_awarded": 1700000000},
            {"id": 2, "project_id": 900002, "bidder_id": 99, "amount": 50, "award_status": "awarded"},  # another bidder
        ]},
        "/projects/0.1/projects/900001/": {"id": 900001, "owner_id": 5, "title": "Scraper", "currency": {"code": "EUR"}, "seo_url": "python/scraper"},
        "/projects/0.1/milestones/": {"milestones": {"m": {"transaction_id": 3, "project_id": 900001, "bidder_id": 77, "amount": 100, "status": "cleared"}}},
    }

    async def fake_get(path, params=None):
        return responses.get(path)

    monkeypatch.setattr(adapter, "_get", fake_get)
    import asyncio
    signals = asyncio.run(adapter.list_orders({"external_account_id": "77"}))
    assert len(signals) == 1
    s = signals[0]
    assert (s.external_order_id, s.amount, s.currency, s.status) == ("900001", 300.0, "EUR", OrderStatus.ACTIVE)
    assert s.account_external_id == "77" and s.milestones[0].status == "cleared"
    assert s.url == "https://www.freelancer.com/projects/python/scraper"


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _uid(client, email: str) -> str:
    from app import db
    return run(client, db.find_user, email)["id"]


async def _force(user_id, order_id, fields, version):
    return await store.update_order(user_id, order_id, fields, expect_version=version)


def test_platform_confirmation_moves_a_misrouted_email_to_the_right_account(client, inbound, upwork):
    alice = bearer(signup(client, email="uw-misroute@example.com")["token"])
    a = connect_upwork(client, alice, "conn-a", "A")
    b = connect_upwork(client, alice, "conn-b", "B")
    # Forwarded to A's address, but the offer is B's.
    client.post("/api/inbox/inbound", headers=WEBHOOK, json={
        "To": a["inboundAddress"], "From": "donotreply@upwork.com", "Subject": "New offer: Audit",
        "TextBody": "https://www.upwork.com/ab/offers/6060606", "MessageID": "<misroute@x>"})
    order = orders(client, alice)["orders"][0]
    assert order["accountId"] == a["id"] and order["verification"]["status"] == "rejected"

    upwork.offer("uw-b", "6060606", "Audit")
    client.post(f"/api/orders/accounts/{b['id']}/sync", headers=alice)
    rows = orders(client, alice)["orders"]
    assert len(rows) == 1
    assert rows[0]["accountId"] == b["id"] and rows[0]["verification"]["status"] == "verified"
    assert rows[0]["verification"]["evidence"]["accountId"] == b["id"]


def test_a_verified_order_is_never_downgraded_by_a_later_failed_check(client, inbound, upwork):
    alice = bearer(signup(client, email="uw-sticky@example.com")["token"])
    upwork.offer("uw-a", "7007007", "Sticky", status=OrderStatus.ACTIVE)
    account = connect_upwork(client, alice, "conn-a")
    order = orders(client, alice)["orders"][0]
    assert order["verification"]["status"] == "verified"

    upwork.fail = AdapterError("Upwork API returned 503.")
    assert client.post(f"/api/orders/{order['id']}/verify", headers=alice).json()["verification"]["status"] == "verified"
    upwork.fail = None
    saved = upwork.offers["uw-a"]
    upwork.offers["uw-a"] = []  # the platform stops returning it
    gone = client.post(f"/api/orders/{order['id']}/verify", headers=alice).json()["verification"]
    assert gone["status"] == "verified" and "no longer returns" in gone["reason"]
    upwork.offers["uw-a"] = saved


def test_an_email_status_change_on_a_verified_order_is_rechecked_not_trusted(client, inbound, upwork):
    alice = bearer(signup(client, email="uw-hint@example.com")["token"])
    upwork.offer("uw-a", "7007007", "Sticky", status=OrderStatus.ACTIVE)
    account = connect_upwork(client, alice, "conn-a")
    order = orders(client, alice)["orders"][0]
    uid = _uid(client, "uw-hint@example.com")

    # The email claims the contract ended; the platform still says active.
    client.post("/api/inbox/inbound", headers=WEBHOOK, json={
        "To": account["inboundAddress"], "From": "donotreply@upwork.com", "Subject": "Your contract has ended: Sticky",
        "TextBody": "https://www.upwork.com/ab/offers/7007007", "MessageID": "<ended@x>"})
    stored = run(client, store.get_order, uid, order["id"])
    assert stored["status"] == "active" and stored["next_verify_at"] is not None
    assert len(orders(client, alice)["orders"]) == 1

    # Once the platform agrees, the scheduled re-check picks it up.
    upwork.offer("uw-a", "7007007", "Sticky", status=OrderStatus.COMPLETED)
    # offer(id:) reports no lifecycle state; the next list sync carries it.
    run(client, service.run_due_verifications)
    assert run(client, store.get_order, uid, order["id"])["next_verify_at"] is None
    client.post(f"/api/orders/accounts/{account['id']}/sync", headers=alice)
    assert run(client, store.get_order, uid, order["id"])["status"] == "completed"
