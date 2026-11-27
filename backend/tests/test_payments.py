"""Invoice pay links: snapshot, public page, Stripe checkout and webhook."""
import hashlib
import hmac
import json
import time

import pytest

from conftest import bearer, run, signup
from app import repo
from app.config import get_settings
from app.payments import stripe_api

SECRET = "whsec_test_secret"


@pytest.fixture
def owner(client):
    data = signup(client, email="maker@example.com", role="admin", name="Sam Rivera", company="Pixel Forge")
    return {"headers": bearer(data["token"]), "id": data["user"]["id"]}


@pytest.fixture
def stripe(monkeypatch):
    """Stripe is configured; the API calls are recorded instead of sent."""
    settings = get_settings()
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")
    monkeypatch.setattr(settings, "stripe_webhook_secret", SECRET)
    state = {"calls": [], "kind": None}

    async def create(settings, **kwargs):
        state["calls"].append(kwargs)
        n = len(state["calls"])
        return {"id": f"cs_test_{n}", "url": f"https://checkout.stripe.com/c/pay/cs_test_{n}"}

    async def kind(settings, payment_intent_id):
        return state["kind"]

    monkeypatch.setattr(stripe_api, "create_checkout_session", create)
    monkeypatch.setattr(stripe_api, "payment_method_kind", kind)
    return state


def invoice(**over) -> dict:
    body = {
        "invoiceId": "inv-1", "number": "INV-0001", "client": "Acme Co", "description": "Website build",
        "currency": "USD", "methods": ["debit", "credit", "crypto"],
        "milestones": [
            {"id": "m1", "title": "Deposit", "amount": 500, "due": "2026-11-20"},
            {"id": "m2", "title": "Final delivery", "amount": 1250.5, "due": "2026-12-20"},
        ],
    }
    body.update(over)
    return body


def create_link(client, owner, **over) -> dict:
    res = client.post("/api/pay-links", json=invoice(**over), headers=owner["headers"])
    assert res.status_code == 200, res.text
    return res.json()


def event(token, milestone_id, amount, *, session_id="cs_test_1", method="credit",
          status="paid", etype="checkout.session.completed", event_id=None, payment_intent=None) -> bytes:
    # Stripe gives every event its own id; a replay re-sends the same one.
    return json.dumps({"id": event_id or f"evt_{session_id}_{etype}_{status}", "type": etype, "data": {"object": {
        "id": session_id, "object": "checkout.session", "payment_status": status,
        "amount_total": amount, "currency": "usd", "payment_intent": payment_intent or f"pi_{session_id}",
        "metadata": {"pay_token": token, "milestone_id": milestone_id, "method": method},
    }}}).encode()


def signed(body: bytes, *, secret=SECRET, ts: int | None = None) -> dict:
    ts = int(time.time()) if ts is None else ts
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return {"Stripe-Signature": f"t={ts},v1={sig}", "Content-Type": "application/json"}


def post_event(client, body: bytes, **kw):
    return client.post("/api/payments/stripe/webhook", content=body, headers=signed(body, **kw))


def notifications(client, user_id, title):
    return [n for n in run(client, repo.list_for, "notifications", user_id) if n["title"] == title]


# --------------------------------------------------------------------------- #
# Owner: create, refresh, list, withdraw
# --------------------------------------------------------------------------- #
def test_link_needs_a_session(client):
    assert client.post("/api/pay-links", json=invoice()).status_code == 401
    assert client.get("/api/pay-links").status_code == 401


def test_create_link_is_one_per_invoice_and_lists_with_status(client, owner):
    link = create_link(client, owner)
    assert len(link["token"]) >= 16
    assert link["total"] == 1750.5 and link["paid"] == 0
    assert [m["status"] for m in link["milestones"]] == ["due", "due"]
    assert create_link(client, owner, number="INV-0001b")["token"] == link["token"]

    listed = client.get("/api/pay-links", headers=owner["headers"]).json()
    assert listed["live"] is False and listed["cryptoLive"] is False
    assert [x["token"] for x in listed["links"]] == [link["token"]]


def test_links_are_private_to_their_owner(client, owner):
    create_link(client, owner)
    other = signup(client, email="other@example.com", role="admin")
    assert client.get("/api/pay-links", headers=bearer(other["token"])).json()["links"] == []
    assert client.delete("/api/pay-links/inv-1", headers=bearer(other["token"])).status_code == 404


def test_invalid_snapshots_are_rejected(client, owner):
    h = owner["headers"]
    assert client.post("/api/pay-links", json=invoice(currency="EUR"), headers=h).status_code == 422
    assert client.post("/api/pay-links", json=invoice(methods=[]), headers=h).status_code == 422
    assert client.post("/api/pay-links", json=invoice(methods=["paypal"]), headers=h).status_code == 422
    dup = [{"id": "m1", "title": "A", "amount": 1}, {"id": "m1", "title": "B", "amount": 2}]
    assert client.post("/api/pay-links", json=invoice(milestones=dup), headers=h).status_code == 422
    zero = [{"id": "m1", "title": "A", "amount": 0}]
    assert client.post("/api/pay-links", json=invoice(milestones=zero), headers=h).status_code == 422


# --------------------------------------------------------------------------- #
# Public page
# --------------------------------------------------------------------------- #
def test_public_page_shows_the_invoice_but_not_the_owner(client, owner):
    token = create_link(client, owner)["token"]
    res = client.get(f"/api/pay/{token}")
    assert res.status_code == 200
    page = res.json()
    assert page["business"] == "Pixel Forge"
    assert page["number"] == "INV-0001" and page["client"] == "Acme Co"
    assert page["remaining"] == 1750.5 and page["live"] is False
    assert page["methods"] == ["debit", "credit", "crypto"]
    text = res.text
    assert "maker@example.com" not in text and owner["id"] not in text
    assert "user_id" not in page and "invoiceId" not in page and "invoice_id" not in page


def test_unknown_or_withdrawn_links_are_not_found(client, owner):
    assert client.get("/api/pay/not-a-real-token-at-all").status_code == 404
    assert client.get("/api/pay/x").status_code == 404
    token = create_link(client, owner)["token"]
    assert client.delete("/api/pay-links/inv-1", headers=owner["headers"]).status_code == 200
    assert client.get(f"/api/pay/{token}").status_code == 404
    assert client.post(f"/api/pay/{token}/checkout", json={"method": "debit"}).status_code == 404
    assert client.get("/api/pay-links", headers=owner["headers"]).json()["links"] == []


# --------------------------------------------------------------------------- #
# Checkout
# --------------------------------------------------------------------------- #
def test_checkout_without_stripe_says_so_and_charges_nothing(client, owner):
    token = create_link(client, owner)["token"]
    res = client.post(f"/api/pay/{token}/checkout", json={"method": "debit"})
    assert res.status_code == 503
    assert "nothing was charged" in res.json()["detail"]
    assert "Pixel Forge" in res.json()["detail"]


def test_checkout_charges_the_stored_amount(client, owner, stripe):
    token = create_link(client, owner)["token"]
    # An amount in the request is ignored: the snapshot decides.
    res = client.post(f"/api/pay/{token}/checkout", json={"method": "credit", "amount": 1})
    assert res.status_code == 200, res.text
    assert res.json()["url"].startswith("https://checkout.stripe.com/")
    first = stripe["calls"][0]
    assert first["amount_cents"] == 50_000  # the first unpaid milestone
    assert first["method"] == "credit"
    assert first["metadata"]["pay_token"] == token and first["metadata"]["milestone_id"] == "m1"
    assert first["success_url"].endswith(f"/pay/{token}?status=success")
    assert first["cancel_url"].endswith(f"/pay/{token}?status=cancelled")

    client.post(f"/api/pay/{token}/checkout", json={"method": "debit", "milestoneId": "m2"})
    assert stripe["calls"][1]["amount_cents"] == 125_050
    assert client.post(f"/api/pay/{token}/checkout",
                       json={"method": "debit", "milestoneId": "nope"}).status_code == 404


def test_checkout_rejects_methods_the_invoice_does_not_accept(client, owner, stripe):
    token = create_link(client, owner, methods=["debit"])["token"]
    assert client.post(f"/api/pay/{token}/checkout", json={"method": "crypto"}).status_code == 400
    assert client.post(f"/api/pay/{token}/checkout", json={"method": "credit"}).status_code == 400
    assert client.post(f"/api/pay/{token}/checkout", json={"method": "debit"}).status_code == 200


def test_crypto_needs_its_own_switch(client, owner, stripe, monkeypatch):
    token = create_link(client, owner)["token"]
    res = client.post(f"/api/pay/{token}/checkout", json={"method": "crypto"})
    assert res.status_code == 503 and "Crypto" in res.json()["detail"]
    monkeypatch.setattr(get_settings(), "payments_crypto_enabled", True)
    assert client.get(f"/api/pay/{token}").json()["cryptoLive"] is True
    assert client.post(f"/api/pay/{token}/checkout", json={"method": "crypto"}).status_code == 200
    assert stripe["calls"][-1]["method"] == "crypto"


def test_checkout_is_rate_limited_per_link(client, owner, stripe):
    token = create_link(client, owner)["token"]
    codes = [client.post(f"/api/pay/{token}/checkout", json={"method": "debit"}).status_code for _ in range(11)]
    assert codes[:10] == [200] * 10 and codes[10] == 429


def test_stripe_failure_is_reported_without_charging(client, owner, stripe, monkeypatch):
    async def down(settings, **kwargs):
        raise stripe_api.StripeError("unreachable")
    monkeypatch.setattr(stripe_api, "create_checkout_session", down)
    token = create_link(client, owner)["token"]
    res = client.post(f"/api/pay/{token}/checkout", json={"method": "debit"})
    assert res.status_code == 502 and "nothing was charged" in res.json()["detail"]


# --------------------------------------------------------------------------- #
# Webhook
# --------------------------------------------------------------------------- #
def test_webhook_marks_the_milestone_paid_once(client, owner, stripe):
    token = create_link(client, owner)["token"]
    body = event(token, "m1", 50_000)
    res = post_event(client, body)
    assert res.status_code == 200 and res.json()["paid"] is True
    # Stripe retries deliveries: a replay of the event id is answered from the event log and changes nothing.
    assert post_event(client, body).json() == {"received": True, "duplicate": True}
    # A different event about the same session (Stripe can describe one payment twice) changes nothing either.
    again = post_event(client, event(token, "m1", 50_000, event_id="evt_other")).json()
    assert again["paid"] is False and again["duplicate"] is True

    link = client.get("/api/pay-links", headers=owner["headers"]).json()["links"][0]
    m1 = link["milestones"][0]
    assert m1["status"] == "paid" and m1["paidVia"] == "credit" and m1["paidOn"]
    assert link["paid"] == 500 and link["extraPayments"] == 0
    assert len(notifications(client, owner["id"], "Payment received")) == 1
    assert client.get(f"/api/pay/{token}").json()["remaining"] == 1250.5

    paid_again = client.post(f"/api/pay/{token}/checkout", json={"method": "debit", "milestoneId": "m1"})
    assert paid_again.status_code == 409
    client.post(f"/api/pay/{token}/checkout", json={"method": "debit"})
    assert stripe["calls"][-1]["metadata"]["milestone_id"] == "m2"


def test_webhook_records_the_real_card_funding_type(client, owner, stripe):
    stripe["kind"] = "debit"
    token = create_link(client, owner)["token"]
    post_event(client, event(token, "m1", 50_000, method="credit"))
    link = client.get("/api/pay-links", headers=owner["headers"]).json()["links"][0]
    assert link["milestones"][0]["paidVia"] == "debit"


def test_webhook_rejects_bad_or_stale_signatures(client, owner, stripe):
    token = create_link(client, owner)["token"]
    body = event(token, "m1", 50_000)
    assert post_event(client, body, secret="whsec_wrong").status_code == 400
    assert post_event(client, body, ts=int(time.time()) - 600).status_code == 400
    assert post_event(client, body, ts=int(time.time()) + 600).status_code == 400
    unsigned = client.post("/api/payments/stripe/webhook", content=body, headers={"Content-Type": "application/json"})
    assert unsigned.status_code == 400
    # A body changed after signing fails too.
    headers = signed(body)
    tampered = body.replace(b"50000", b"99999")
    assert client.post("/api/payments/stripe/webhook", content=tampered, headers=headers).status_code == 400
    link = client.get("/api/pay-links", headers=owner["headers"]).json()["links"][0]
    assert link["paid"] == 0


def test_webhook_without_a_secret_is_refused(client, owner):
    body = event("t" * 22, "m1", 50_000)
    assert post_event(client, body).status_code == 503


def test_async_crypto_payment_counts_only_when_it_settles(client, owner, stripe):
    stripe["kind"] = "crypto"
    token = create_link(client, owner)["token"]
    pending = post_event(client, event(token, "m1", 50_000, method="crypto", status="unpaid"))
    assert pending.json().get("pending") is True
    assert client.get(f"/api/pay/{token}").json()["paid"] == 0
    settled = event(token, "m1", 50_000, method="crypto", etype="checkout.session.async_payment_succeeded")
    assert post_event(client, settled).json()["paid"] is True
    link = client.get("/api/pay-links", headers=owner["headers"]).json()["links"][0]
    assert link["milestones"][0]["paidVia"] == "crypto"


def test_short_payment_is_flagged_not_counted(client, owner, stripe):
    token = create_link(client, owner)["token"]
    post_event(client, event(token, "m1", 100))
    assert client.get(f"/api/pay/{token}").json()["paid"] == 0
    assert len(notifications(client, owner["id"], "Payment needs review")) == 1


def test_second_payment_for_a_paid_milestone_is_kept_for_refund(client, owner, stripe):
    token = create_link(client, owner)["token"]
    post_event(client, event(token, "m1", 50_000, session_id="cs_a"))
    second = event(token, "m1", 50_000, session_id="cs_b")
    post_event(client, second)
    post_event(client, second)  # replay of the duplicate: still one record
    link = client.get("/api/pay-links", headers=owner["headers"]).json()["links"][0]
    assert link["extraPayments"] == 1 and link["paid"] == 500
    assert len(notifications(client, owner["id"], "Duplicate payment")) == 1


def test_events_for_other_stripe_payments_are_ignored(client, owner, stripe):
    body = json.dumps({"type": "checkout.session.completed", "data": {"object": {
        "id": "cs_x", "payment_status": "paid", "amount_total": 100, "currency": "usd", "metadata": {}}}}).encode()
    assert post_event(client, body).json() == {"received": True}
    other = json.dumps({"type": "invoice.paid", "data": {"object": {}}}).encode()
    assert post_event(client, other).json() == {"received": True}


# --------------------------------------------------------------------------- #
# Refreshing a snapshot after payments
# --------------------------------------------------------------------------- #
def test_milestones_paid_online_are_locked(client, owner, stripe):
    token = create_link(client, owner)["token"]
    post_event(client, event(token, "m1", 50_000))
    h = owner["headers"]
    changed = invoice(milestones=[{"id": "m1", "title": "Deposit", "amount": 400, "due": "2026-11-20"},
                                  {"id": "m2", "title": "Final delivery", "amount": 1250.5, "due": "2026-12-20"}])
    assert client.post("/api/pay-links", json=changed, headers=h).status_code == 409
    removed = invoice(milestones=[{"id": "m2", "title": "Final delivery", "amount": 1250.5}])
    assert client.post("/api/pay-links", json=removed, headers=h).status_code == 409
    # The same snapshot (as the dashboard re-sends it) keeps the payment.
    again = create_link(client, owner)
    assert again["milestones"][0]["status"] == "paid" and again["milestones"][0]["paidVia"] == "credit"


def test_owner_can_mark_milestones_paid_by_hand(client, owner, stripe):
    token = create_link(client, owner)["token"]
    manual = invoice(milestones=[{"id": "m1", "title": "Deposit", "amount": 500, "paidManually": True},
                                 {"id": "m2", "title": "Final delivery", "amount": 1250.5}])
    link = create_link(client, owner, milestones=manual["milestones"])
    assert link["milestones"][0]["status"] == "paid" and link["milestones"][0]["paidVia"] == "manual"
    assert client.post(f"/api/pay/{token}/checkout",
                       json={"method": "debit", "milestoneId": "m1"}).status_code == 409
    # Undoing a manual payment makes it payable again.
    undone = create_link(client, owner)
    assert undone["milestones"][0]["status"] == "due"
    # A client payment for a milestone already marked paid by hand is flagged.
    create_link(client, owner, milestones=manual["milestones"])
    post_event(client, event(token, "m1", 50_000, session_id="cs_late"))
    assert client.get("/api/pay-links", headers=owner["headers"]).json()["links"][0]["extraPayments"] == 1


def test_signature_helper_accepts_any_listed_v1():
    body = b'{"x":1}'
    ts = int(time.time())
    good = hmac.new(b"s", f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    assert stripe_api.verify_signature(body, f"t={ts},v1=deadbeef,v1={good}", "s")
    assert not stripe_api.verify_signature(body, f"t={ts},v0={good}", "s")
    assert not stripe_api.verify_signature(body, f"t=abc,v1={good}", "s")
    assert not stripe_api.verify_signature(body, "", "s")


def test_stripe_helper_builds_the_checkout_request(client, monkeypatch):
    """The real helper, against a fake transport: what Stripe receives."""
    import httpx
    from urllib.parse import parse_qs

    settings = get_settings()
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")
    sent = []

    async def fake_send(self, request, **kwargs):
        sent.append(request)
        if request.url.path.endswith("/checkout/sessions"):
            return httpx.Response(200, json={"id": "cs_1", "url": "https://checkout.stripe.com/c/pay/cs_1"}, request=request)
        return httpx.Response(200, json={"latest_charge": {"payment_method_details": {
            "type": "card", "card": {"funding": "debit"}}}}, request=request)

    monkeypatch.setattr(httpx.AsyncClient, "send", fake_send)
    session = run(client, lambda: stripe_api.create_checkout_session(
        settings, amount_cents=12_345, name="Pixel Forge · INV-1 · Deposit", method="crypto",
        metadata={"pay_token": "tok", "milestone_id": "m1"}, success_url="https://x/s", cancel_url="https://x/c",
        client_reference_id="link-1"))
    assert session == {"id": "cs_1", "url": "https://checkout.stripe.com/c/pay/cs_1"}
    req = sent[0]
    assert req.headers["authorization"] == "Bearer sk_test_123"
    form = {k: v[0] for k, v in parse_qs(req.content.decode()).items()}
    assert form["mode"] == "payment"
    assert form["line_items[0][price_data][unit_amount]"] == "12345"
    assert form["line_items[0][price_data][currency]"] == "usd"
    assert form["payment_method_types[0]"] == "crypto"
    assert form["metadata[pay_token]"] == "tok" and form["metadata[milestone_id]"] == "m1"
    assert int(form["expires_at"]) >= int(time.time()) + 30 * 60

    assert run(client, lambda: stripe_api.payment_method_kind(settings, "pi_1")) == "debit"

    async def rejected(self, request, **kwargs):
        return httpx.Response(400, json={"error": {"message": "crypto is not enabled"}}, request=request)
    monkeypatch.setattr(httpx.AsyncClient, "send", rejected)
    with pytest.raises(stripe_api.StripeError, match="crypto is not enabled"):
        run(client, lambda: stripe_api.create_checkout_session(
            settings, amount_cents=100, name="x", method="debit", metadata={}, success_url="s",
            cancel_url="c", client_reference_id="r"))
    assert run(client, lambda: stripe_api.payment_method_kind(settings, "pi_1")) is None
