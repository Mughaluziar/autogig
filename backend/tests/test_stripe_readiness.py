"""Stripe integration readiness: refunds and disputes on pay links, credit-pack refunds, failed renewals, the
webhook event log (dedupe by event id) and the owner-only readiness check."""
import json
import re
import time
from pathlib import Path

import httpx
import pytest

from conftest import bearer, signup
from app import repo
from app.config import get_settings
from app.payments import readiness, subscriptions
from app.routers import billing as billing_router, payments as payments_router
from test_payments import create_link, event, invoice, notifications, post_event, stripe  # noqa: F401  (the fixture)


@pytest.fixture(autouse=True)
def clean_subscriptions():
    subscriptions.reset_memory()
    yield
    subscriptions.reset_memory()


@pytest.fixture
def maker(client):
    data = signup(client, email="maker@example.com", role="admin", name="Sam Rivera", company="Pixel Forge")
    return {"headers": bearer(data["token"]), "id": data["user"]["id"]}


@pytest.fixture
def platform_owner(client):
    return {"headers": bearer(signup(client, email="owner@example.com", role="admin")["token"])}


def links(client, who) -> dict:
    return client.get("/api/pay-links", headers=who["headers"]).json()["links"][0]


def pay(client, token, milestone="m1", amount=50_000, session="cs_a"):
    res = post_event(client, event(token, milestone, amount, session_id=session))
    assert res.status_code == 200, res.text
    return res.json()


def charge_refunded(pi, amount, refunded, *, meta=None, event_id=None) -> bytes:
    return json.dumps({"id": event_id or f"evt_rf_{pi}_{refunded}", "type": "charge.refunded", "data": {"object": {
        "id": f"ch_{pi}", "object": "charge", "amount": amount, "amount_refunded": refunded,
        "refunded": refunded >= amount, "currency": "usd", "payment_intent": pi, "metadata": meta or {},
    }}}).encode()


def dispute(etype, pi, status, *, amount=50_000, dispute_id="dp_1", reason="product_not_received", event_id=None) -> bytes:
    return json.dumps({"id": event_id or f"evt_{etype}_{status}_{pi}", "type": etype, "data": {"object": {
        "id": dispute_id, "object": "dispute", "amount": amount, "charge": f"ch_{pi}", "payment_intent": pi,
        "status": status, "reason": reason, "evidence_details": {"due_by": int(time.time()) + 7 * 86400},
    }}}).encode()


def meta(token, milestone="m1"):
    return {"pay_token": token, "milestone_id": milestone, "method": "credit"}


# --------------------------------------------------------------------------- #
# Pay-link refunds
# --------------------------------------------------------------------------- #
def test_partial_refund_keeps_the_milestone_paid_and_records_the_amount(client, maker, stripe):
    token = create_link(client, maker)["token"]
    pay(client, token)
    body = charge_refunded("pi_cs_a", 50_000, 10_000, meta=meta(token))
    assert post_event(client, body).json() == {"received": True, "refunded": 10_000}
    link = links(client, maker)
    m1 = link["milestones"][0]
    assert m1["status"] == "paid" and m1["refunded"] == 100 and m1["refundedOn"]
    assert link["paid"] == 500 and link["refunded"] == 100 and link["remaining"] == 1250.5
    page = client.get(f"/api/pay/{token}").json()
    assert page["milestones"][0]["refunded"] == 100 and page["milestones"][0]["disputed"] is False
    assert "pi_cs_a" not in json.dumps(link) and "pi_cs_a" not in json.dumps(page)
    # A replay, and a different event carrying the same cumulative amount, change nothing.
    assert post_event(client, body).json() == {"received": True, "duplicate": True}
    assert post_event(client, charge_refunded("pi_cs_a", 50_000, 10_000, event_id="evt_x")).json()["duplicate"] is True
    assert len(notifications(client, maker["id"], "Partial refund")) == 1


def test_full_refund_makes_the_milestone_refunded_and_not_payable_online(client, maker, stripe):
    token = create_link(client, maker)["token"]
    pay(client, token)
    post_event(client, charge_refunded("pi_cs_a", 50_000, 10_000, meta=meta(token)))
    # No metadata on the charge: the PaymentIntent stored on the milestone finds it.
    assert post_event(client, charge_refunded("pi_cs_a", 50_000, 50_000)).json()["refunded"] == 40_000
    link = links(client, maker)
    m1 = link["milestones"][0]
    assert m1["status"] == "refunded" and m1["refunded"] == 500
    assert link["paid"] == 0 and link["remaining"] == 1750.5 and link["refunded"] == 500
    # An older state arriving late can't undo it.
    assert post_event(client, charge_refunded("pi_cs_a", 50_000, 10_000, event_id="evt_late")).json()["duplicate"] is True
    assert links(client, maker)["milestones"][0]["status"] == "refunded"
    assert len(notifications(client, maker["id"], "Payment refunded")) == 1

    res = client.post(f"/api/pay/{token}/checkout", json={"method": "debit", "milestoneId": "m1"})
    assert res.status_code == 409 and "refunded" in res.json()["detail"] and "Pixel Forge" in res.json()["detail"]
    client.post(f"/api/pay/{token}/checkout", json={"method": "debit"})
    assert stripe["calls"][-1]["metadata"]["milestone_id"] == "m2"
    assert client.get(f"/api/pay/{token}").json()["milestones"][0]["status"] == "refunded"


def test_only_refunded_parts_left_says_so(client, maker, stripe):
    token = create_link(client, maker, milestones=[{"id": "full", "title": "Website", "amount": 500}])["token"]
    pay(client, token, milestone="full")
    post_event(client, charge_refunded("pi_cs_a", 50_000, 50_000))
    res = client.post(f"/api/pay/{token}/checkout", json={"method": "credit"})
    assert res.status_code == 409 and "Nothing on this invoice can be paid online" in res.json()["detail"]


def test_a_refunded_milestone_stays_refunded_until_the_owner_reopens_it(client, maker, stripe):
    token = create_link(client, maker)["token"]
    pay(client, token)
    post_event(client, charge_refunded("pi_cs_a", 50_000, 50_000))
    # The dashboard re-sends the same snapshot: still refunded. Changing its amount needs a re-open first.
    assert create_link(client, maker)["milestones"][0]["status"] == "refunded"
    changed = invoice(milestones=[{"id": "m1", "title": "Deposit", "amount": 450}, {"id": "m2", "title": "Final", "amount": 1250.5}])
    assert client.post("/api/pay-links", json=changed, headers=maker["headers"]).status_code == 409

    reopened = create_link(client, maker, reopen=["m1"])
    assert reopened["milestones"][0]["status"] == "due" and reopened["milestones"][0]["refunded"] == 0
    assert reopened["extraPayments"] == 0 and reopened["paid"] == 0 and reopened["refunded"] == 0
    assert client.post(f"/api/pay/{token}/checkout", json={"method": "credit", "milestoneId": "m1"}).status_code == 200

    # Paid again with a new charge; a dispute on the OLD (refunded) charge finds the retired record, not the milestone.
    pay(client, token, session="cs_b")
    post_event(client, dispute("charge.dispute.created", "pi_cs_a", "needs_response"))
    link = links(client, maker)
    assert link["milestones"][0]["status"] == "paid" and link["milestones"][0]["dispute"] is None
    assert link["paid"] == 500


def test_a_refunded_milestone_can_be_marked_paid_by_hand_or_removed(client, maker, stripe):
    token = create_link(client, maker)["token"]
    pay(client, token)
    post_event(client, charge_refunded("pi_cs_a", 50_000, 50_000))
    manual = invoice(milestones=[{"id": "m1", "title": "Deposit", "amount": 500, "paidManually": True},
                                 {"id": "m2", "title": "Final delivery", "amount": 1250.5}])
    link = create_link(client, maker, milestones=manual["milestones"])
    assert link["milestones"][0]["status"] == "paid" and link["milestones"][0]["paidVia"] == "manual"
    # A later dispute on the refunded charge still finds its (retired) record and doesn't touch the milestone.
    assert post_event(client, dispute("charge.dispute.created", "pi_cs_a", "needs_response")).json()["dispute"] == "needs_response"
    assert links(client, maker)["milestones"][0]["dispute"] is None

    token2 = create_link(client, maker, invoiceId="inv-2")["token"]
    pay(client, token2, session="cs_c")
    post_event(client, charge_refunded("pi_cs_c", 50_000, 50_000))
    only_m2 = invoice(invoiceId="inv-2", milestones=[{"id": "m2", "title": "Final delivery", "amount": 1250.5}])
    res = client.post("/api/pay-links", json=only_m2, headers=maker["headers"])
    assert res.status_code == 200 and [m["id"] for m in res.json()["milestones"]] == ["m2"]


def test_refunding_a_duplicate_payment_leaves_the_milestone_paid(client, maker, stripe):
    token = create_link(client, maker)["token"]
    pay(client, token, session="cs_a")
    second = pay(client, token, session="cs_b")
    assert second["extra"] is True and links(client, maker)["extraPayments"] == 1
    assert post_event(client, charge_refunded("pi_cs_b", 50_000, 50_000, meta=meta(token))).json()["refunded"] == 50_000
    link = links(client, maker)
    assert link["extraPayments"] == 0 and link["milestones"][0]["status"] == "paid" and link["paid"] == 500
    assert link["refunded"] == 0
    assert len(notifications(client, maker["id"], "Duplicate payment refunded")) == 1
    assert notifications(client, maker["id"], "Payment refunded") == []


# --------------------------------------------------------------------------- #
# Pay-link disputes
# --------------------------------------------------------------------------- #
def test_dispute_opened_updated_and_won(client, maker, stripe):
    token = create_link(client, maker)["token"]
    pay(client, token)
    assert post_event(client, dispute("charge.dispute.created", "pi_cs_a", "needs_response")).json()["dispute"] == "needs_response"
    m1 = links(client, maker)["milestones"][0]
    assert m1["status"] == "paid"
    assert m1["dispute"]["status"] == "needs_response" and m1["dispute"]["reason"] == "product_not_received"
    assert m1["dispute"]["amount"] == 500 and m1["dispute"]["respondBy"] and m1["dispute"]["closedOn"] is None
    page = client.get(f"/api/pay/{token}")
    assert page.json()["milestones"][0]["disputed"] is True and "product_not_received" not in page.text
    opened = notifications(client, maker["id"], "Payment disputed")
    assert len(opened) == 1 and "Stripe Dashboard" in opened[0]["body"] and "work not received" in opened[0]["body"]

    post_event(client, dispute("charge.dispute.updated", "pi_cs_a", "under_review"))
    assert links(client, maker)["milestones"][0]["dispute"]["status"] == "under_review"
    closed = dispute("charge.dispute.closed", "pi_cs_a", "won")
    post_event(client, closed)
    m1 = links(client, maker)["milestones"][0]
    assert m1["status"] == "paid" and m1["dispute"]["status"] == "won" and m1["dispute"]["closedOn"]
    assert client.get(f"/api/pay/{token}").json()["milestones"][0]["disputed"] is False
    assert len(notifications(client, maker["id"], "Dispute won")) == 1
    # Replays and an update that arrives after the close change nothing.
    assert post_event(client, closed).json() == {"received": True, "duplicate": True}
    late = dispute("charge.dispute.updated", "pi_cs_a", "under_review", event_id="evt_late_update")
    assert post_event(client, late).json()["duplicate"] is True
    assert links(client, maker)["milestones"][0]["dispute"]["status"] == "won"
    assert len(notifications(client, maker["id"], "Payment disputed")) == 1


def test_a_lost_dispute_counts_as_a_full_refund(client, maker, stripe):
    token = create_link(client, maker)["token"]
    pay(client, token)
    post_event(client, dispute("charge.dispute.created", "pi_cs_a", "needs_response"))
    post_event(client, dispute("charge.dispute.closed", "pi_cs_a", "lost"))
    link = links(client, maker)
    m1 = link["milestones"][0]
    assert m1["status"] == "refunded" and m1["refunded"] == 500 and m1["dispute"]["status"] == "lost"
    assert link["paid"] == 0 and link["remaining"] == 1750.5
    assert len(notifications(client, maker["id"], "Dispute lost")) == 1
    assert client.post(f"/api/pay/{token}/checkout", json={"method": "debit", "milestoneId": "m1"}).status_code == 409
    # A refund event for the same charge afterwards changes nothing.
    assert post_event(client, charge_refunded("pi_cs_a", 50_000, 50_000)).json()["duplicate"] is True


def test_events_for_unknown_payments_are_ignored(client, maker, platform_owner, stripe):
    create_link(client, maker)
    assert post_event(client, dispute("charge.dispute.created", "pi_nobody", "needs_response")).json() == {"received": True}
    assert post_event(client, charge_refunded("pi_nobody", 100, 100)).json() == {"received": True}
    rows = client.get("/api/payments/stripe/events", headers=platform_owner["headers"]).json()["events"]
    assert {r["outcome"] for r in rows} == {"ignored"}


# --------------------------------------------------------------------------- #
# Credit-pack refunds and failed renewals (billing)
# --------------------------------------------------------------------------- #
def pack_paid(user_id, *, pi="pi_pack_1", session="cs_pack_1", amount=990) -> bytes:
    return json.dumps({"id": f"evt_{session}", "type": "checkout.session.completed", "data": {"object": {
        "id": session, "object": "checkout.session", "mode": "payment", "payment_status": "paid",
        "amount_total": amount, "currency": "usd", "client_reference_id": user_id, "payment_intent": pi,
        "metadata": {"user_id": user_id, "kind": "pack", "pack": "bids"},
    }}}).encode()


def pack_meta(user_id):
    return {"user_id": user_id, "kind": "pack", "pack": "bids"}


def monetization(client, who):
    return client.get("/api/user-monetization", headers=who["headers"]).json()


def test_pack_refund_partial_keeps_credits_and_full_takes_back_unused(client, maker, stripe):
    start = monetization(client, maker)["bidCredits"]
    post_event(client, pack_paid(maker["id"]))
    assert monetization(client, maker)["bidCredits"] == start + 10

    assert post_event(client, charge_refunded("pi_pack_1", 990, 400, meta=pack_meta(maker["id"]))).json()["refunded"] == 400
    mon = monetization(client, maker)
    assert mon["bidCredits"] == start + 10
    assert mon["purchases"][0]["status"] == "Refunded" and mon["purchases"][0]["amount"] == -4.0
    assert "partial" in mon["purchases"][0]["item"]

    # No metadata: the recorded pack payment finds the user.
    full = charge_refunded("pi_pack_1", 990, 990)
    assert post_event(client, full).json()["refunded"] == 590
    mon = monetization(client, maker)
    assert mon["bidCredits"] == start and mon["purchases"][0]["amount"] == -5.9
    assert "10 bid credits removed" in mon["purchases"][0]["item"]
    assert post_event(client, full).json()["duplicate"] is True
    assert post_event(client, charge_refunded("pi_pack_1", 990, 990, event_id="evt_again")).json()["duplicate"] is True
    assert monetization(client, maker)["bidCredits"] == start
    assert len(notifications(client, maker["id"], "Refund issued")) == 2

    receipt = client.get(f"/api/billing/receipts/{mon['purchases'][0]['id']}", headers=maker["headers"]).json()
    assert receipt["status"] == "Refunded" and receipt["charged"] is False and "Refunded" in receipt["note"]


def test_pack_refund_never_makes_a_balance_negative(client, maker, stripe):
    post_event(client, pack_paid(maker["id"]))
    balance = monetization(client, maker)["bidCredits"]
    # Most of the credits were spent before the refund.
    client.portal.call(lambda: repo.record_purchase(maker["id"], {"id": "po-y", "item": "spent", "amount": 0, "status": "Paid"},
                                                    add_credits={"bidCredits": 3 - balance}))
    assert monetization(client, maker)["bidCredits"] == 3
    post_event(client, charge_refunded("pi_pack_1", 990, 990, meta=pack_meta(maker["id"])))
    mon = monetization(client, maker)
    assert mon["bidCredits"] == 0 and "3 bid credits removed" in mon["purchases"][0]["item"]


def test_a_refund_for_a_pack_bought_before_payments_were_recorded(client, maker, stripe):
    start = monetization(client, maker)["bidCredits"]
    assert post_event(client, charge_refunded("pi_old", 990, 990, meta=pack_meta(maker["id"]))).json()["refunded"] == 990
    assert monetization(client, maker)["bidCredits"] == max(0, start - 10)


def plan_paid(user_id) -> bytes:
    return json.dumps({"id": "evt_plan", "type": "checkout.session.completed", "data": {"object": {
        "id": "cs_sub_1", "object": "checkout.session", "mode": "subscription", "status": "complete",
        "payment_status": "paid", "customer": "cus_1", "subscription": "sub_1", "client_reference_id": user_id,
        "metadata": {"user_id": user_id, "kind": "plan", "plan": "plus", "trial_days": "0"},
    }}}).encode()


def invoice_event(etype, user_id, *, attempt=1, event_id=None, sub_id="sub_1") -> bytes:
    return json.dumps({"id": event_id or f"evt_{etype}_{attempt}_{sub_id}", "type": etype, "data": {"object": {
        "id": f"in_{sub_id}", "object": "invoice", "subscription": sub_id, "amount_due": 1900, "amount_paid": 1900,
        "attempt_count": attempt, "billing_reason": "subscription_cycle",
        "next_payment_attempt": int(time.time()) + 3 * 86400, "subscription_details": {"metadata": {"user_id": user_id}},
    }}}).encode()


def test_failed_renewal_sets_past_due_and_tells_the_user_to_update_the_card(client, maker, stripe):
    post_event(client, plan_paid(maker["id"]))
    failed = invoice_event("invoice.payment_failed", maker["id"])
    assert post_event(client, failed).json() == {"received": True, "pastDue": True}
    sub = client.get("/api/billing/checkout-config", headers=maker["headers"]).json()["subscription"]
    assert sub["status"] == "past_due" and sub["plan"] == "plus"
    sent = notifications(client, maker["id"], "Payment failed")
    assert len(sent) == 1 and "Manage billing" in sent[0]["body"] and "$19.00" in sent[0]["body"]
    # Replays (same event, or another event for the same attempt) don't notify again; a new attempt does.
    assert post_event(client, failed).json()["duplicate"] is True
    assert post_event(client, invoice_event("invoice.payment_failed", maker["id"], event_id="evt_y")).json()["duplicate"] is True
    post_event(client, invoice_event("invoice.payment_failed", maker["id"], attempt=2))
    assert len(notifications(client, maker["id"], "Payment failed")) == 2
    assert monetization(client, maker)["plan"] == "plus"
    post_event(client, invoice_event("invoice.paid", maker["id"], attempt=3))
    assert client.get("/api/billing/checkout-config", headers=maker["headers"]).json()["subscription"]["status"] == "active"
    # A failure on an older (replaced) subscription neither changes the plan nor asks for a card.
    assert post_event(client, invoice_event("invoice.payment_failed", maker["id"], sub_id="sub_old")).json() == {"received": True}
    assert client.get("/api/billing/checkout-config", headers=maker["headers"]).json()["subscription"]["status"] == "active"
    assert len(notifications(client, maker["id"], "Payment failed")) == 2


# --------------------------------------------------------------------------- #
# Webhook event log
# --------------------------------------------------------------------------- #
def test_event_log_dedupes_by_id_and_records_outcomes_without_personal_data(client, maker, platform_owner, stripe):
    token = create_link(client, maker)["token"]
    paid = event(token, "m1", 50_000, session_id="cs_a")
    post_event(client, paid)
    post_event(client, paid)
    post_event(client, event(token, "m2", 100, session_id="cs_short"))
    post_event(client, json.dumps({"id": "evt_other", "type": "customer.created", "data": {"object": {"id": "cus_9"}}}).encode())
    rows = {r["id"]: r for r in client.get("/api/payments/stripe/events", headers=platform_owner["headers"]).json()["events"]}
    first = rows["evt_cs_a_checkout.session.completed_paid"]
    assert first["outcome"] == "applied" and first["duplicates"] == 1 and first["attempts"] == 1
    assert first["type"] == "checkout.session.completed" and first["livemode"] is False and first["receivedAt"]
    assert first["refs"] == {"object": "cs_a", "payment_intent": "pi_cs_a"}
    assert rows["evt_cs_short_checkout.session.completed_paid"]["outcome"] == "rejected-amount"
    assert rows["evt_other"]["outcome"] == "ignored"
    text = json.dumps(rows)
    assert "maker@example.com" not in text and maker["id"] not in text and token not in text and "Acme" not in text
    assert len(client.get("/api/payments/stripe/events?limit=1", headers=platform_owner["headers"]).json()["events"]) == 1


def test_a_failed_event_is_retried_not_treated_as_a_duplicate(client, maker, platform_owner, stripe, monkeypatch):
    token = create_link(client, maker)["token"]
    real = billing_router.handle_stripe_event
    calls = {"n": 0}

    async def flaky(event):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("database hiccup")
        return await real(event)

    monkeypatch.setattr(billing_router, "handle_stripe_event", flaky)
    body = event(token, "m1", 50_000)
    assert post_event(client, body).status_code == 500
    row = client.get("/api/payments/stripe/events", headers=platform_owner["headers"]).json()["events"][0]
    assert row["outcome"] == "error"
    assert post_event(client, body).json()["paid"] is True
    row = client.get("/api/payments/stripe/events", headers=platform_owner["headers"]).json()["events"][0]
    assert row["outcome"] == "applied" and row["attempts"] == 2


# --------------------------------------------------------------------------- #
# Readiness check
# --------------------------------------------------------------------------- #
def checks_by_id(res) -> dict:
    return {c["id"]: c for c in res.json()["checks"]}


def test_readiness_and_event_log_are_for_platform_owners_only(client, maker, platform_owner):
    for path in ("/api/payments/stripe/readiness", "/api/payments/stripe/readiness?probe=true", "/api/payments/stripe/events"):
        assert client.get(path).status_code == 401
        assert client.get(path, headers=maker["headers"]).status_code == 403
        assert client.get(path, headers=platform_owner["headers"]).status_code == 200


def test_readiness_without_stripe_fails_clearly(client, platform_owner):
    res = client.get("/api/payments/stripe/readiness?probe=true", headers=platform_owner["headers"])
    data = res.json()
    assert data["summary"] == "fail" and data["mode"] == "off" and data["probed"] is False and data["account"] is None
    checks = checks_by_id(res)
    assert checks["secret_key"]["status"] == "fail" and checks["webhook_secret"]["status"] == "fail"
    assert checks["crypto"]["status"] == "pass"
    assert data["requiredEvents"] == list(readiness.REQUIRED_EVENTS)


KEY = "sk_test_51AbCdEfGhIjKlMnOpQrStUvWxYz0123456789WXYZ"
WHSEC = "whsec_abcdefghijklmnopqrstuvwxyz0123456789"


def configure(monkeypatch, **over):
    settings = get_settings()
    values = {"stripe_secret_key": KEY, "stripe_webhook_secret": WHSEC, "public_site_url": "https://app.example.com",
              "public_api_url": "https://api.example.com", "payments_crypto_enabled": False, **over}
    for k, v in values.items():
        monkeypatch.setattr(settings, k, v)


def test_readiness_config_checks_never_return_secrets(client, platform_owner, monkeypatch):
    configure(monkeypatch)
    res = client.get("/api/payments/stripe/readiness", headers=platform_owner["headers"])
    data, checks = res.json(), checks_by_id(res)
    assert data["summary"] == "pass" and data["mode"] == "test" and data["key"] == "sk_test_…WXYZ"
    assert data["webhookUrl"] == "https://api.example.com/api/payments/stripe/webhook"
    assert all(c["status"] == "pass" for c in checks.values()), checks
    assert KEY not in res.text and WHSEC not in res.text and "51AbCd" not in res.text and "abcdefghij" not in res.text

    configure(monkeypatch, stripe_secret_key="sk_live_" + "x" * 40, stripe_webhook_secret="sk_test_wrong",
              public_site_url="http://app.example.com", payments_crypto_enabled=True, public_api_url="")
    res = client.get("/api/payments/stripe/readiness", headers=platform_owner["headers"])
    checks = checks_by_id(res)
    assert res.json()["mode"] == "live" and res.json()["summary"] == "fail"
    assert checks["mode"]["status"] == "fail" and "production guard" in checks["mode"]["detail"]
    assert checks["webhook_secret"]["status"] == "fail" and "whsec_" in checks["webhook_secret"]["detail"]
    assert checks["site_url"]["status"] == "fail"
    assert checks["crypto"]["status"] == "fail"
    assert checks["webhook_url"]["status"] == "warn"
    assert "x" * 20 not in res.text

    configure(monkeypatch, stripe_secret_key="pk_test_123")
    assert checks_by_id(client.get("/api/payments/stripe/readiness", headers=platform_owner["headers"]))["secret_key"]["status"] == "fail"
    configure(monkeypatch, stripe_secret_key="rk_test_" + "r" * 30)
    checks = checks_by_id(client.get("/api/payments/stripe/readiness", headers=platform_owner["headers"]))
    assert checks["mode"]["status"] == "warn" and "restricted" in checks["mode"]["detail"].lower()


def fake_stripe(monkeypatch, *, account=None, endpoints=None, status=200):
    sent = []

    async def send(self, request, **kwargs):
        sent.append(request)
        if status != 200:
            return httpx.Response(status, json={"error": {"message": f"Invalid API Key provided: {KEY}"}}, request=request)
        if request.url.path == "/v1/account":
            return httpx.Response(200, json=account or {}, request=request)
        if request.url.path == "/v1/webhook_endpoints":
            return httpx.Response(200, json={"object": "list", "data": endpoints or []}, request=request)
        return httpx.Response(404, json={}, request=request)

    monkeypatch.setattr(httpx.AsyncClient, "send", send)
    return sent


ACCOUNT = {"id": "acct_1", "email": "boss@example.com", "charges_enabled": True, "payouts_enabled": False,
           "details_submitted": True, "country": "US", "default_currency": "usd"}


def endpoint(url="https://api.example.com/api/payments/stripe/webhook", events=None, status="enabled", eid="we_1"):
    return {"id": eid, "url": url, "status": status, "livemode": False, "secret": "whsec_never_listed",
            "enabled_events": list(readiness.REQUIRED_EVENTS) if events is None else events}


def test_live_probe_reads_the_account_and_the_webhook_endpoint(client, platform_owner, monkeypatch):
    configure(monkeypatch)
    missing = [e for e in readiness.REQUIRED_EVENTS if not e.startswith("charge.dispute")]
    sent = fake_stripe(monkeypatch, account=ACCOUNT, endpoints=[
        endpoint(url="https://other.example.com/hooks", eid="we_other"), endpoint(events=missing)])
    res = client.get("/api/payments/stripe/readiness?probe=true", headers=platform_owner["headers"])
    data, checks = res.json(), checks_by_id(res)
    assert data["probed"] is True
    assert data["account"] == {"chargesEnabled": True, "payoutsEnabled": False, "detailsSubmitted": True,
                               "country": "US", "defaultCurrency": "usd"}
    assert checks["charges"]["status"] == "pass" and checks["payouts"]["status"] == "warn"
    assert checks["endpoint"]["status"] == "pass"
    assert checks["events"]["status"] == "fail" and "charge.dispute.created" in checks["events"]["detail"]
    assert [e["id"] for e in data["endpoints"]] == ["we_1"]
    assert "boss@example.com" not in res.text and "whsec_never_listed" not in res.text and "acct_1" not in res.text
    assert {r.url.path for r in sent} == {"/v1/account", "/v1/webhook_endpoints"}
    assert all(r.method == "GET" and r.headers["authorization"] == f"Bearer {KEY}" for r in sent)

    fake_stripe(monkeypatch, account=ACCOUNT, endpoints=[endpoint(), endpoint(eid="we_2", status="disabled")])
    checks = checks_by_id(client.get("/api/payments/stripe/readiness?probe=true", headers=platform_owner["headers"]))
    assert checks["events"]["status"] == "pass" and checks["endpoint_count"]["status"] == "warn"

    fake_stripe(monkeypatch, account={**ACCOUNT, "charges_enabled": False}, endpoints=[endpoint(events=["*"], status="disabled")])
    checks = checks_by_id(client.get("/api/payments/stripe/readiness?probe=true", headers=platform_owner["headers"]))
    assert checks["charges"]["status"] == "warn"  # test mode: test payments still work
    assert checks["endpoint"]["status"] == "fail" and checks["events"]["status"] == "pass"

    fake_stripe(monkeypatch, account=ACCOUNT, endpoints=[])
    checks = checks_by_id(client.get("/api/payments/stripe/readiness?probe=true", headers=platform_owner["headers"]))
    assert checks["endpoint"]["status"] == "fail" and "events" not in checks


def test_live_probe_reports_a_rejected_key_without_echoing_it(client, platform_owner, monkeypatch):
    configure(monkeypatch)
    fake_stripe(monkeypatch, status=401)
    res = client.get("/api/payments/stripe/readiness?probe=true", headers=platform_owner["headers"])
    checks = checks_by_id(res)
    assert res.json()["summary"] == "fail"
    assert checks["account"]["status"] == "fail" and "rejected the secret key" in checks["account"]["detail"]
    assert checks["endpoint"]["status"] == "fail"
    assert KEY not in res.text and "WXYZ" not in res.text.replace("sk_test_…WXYZ", "")


def test_required_events_cover_everything_the_webhook_handles_and_the_docs_list_them():
    handled = set(billing_router.BILLING_EVENTS) | set(payments_router.PAY_LINK_EVENTS)
    assert handled <= set(readiness.REQUIRED_EVENTS)
    doc = (Path(__file__).resolve().parents[2] / "docs" / "payments.md").read_text()
    listed = set(re.findall(r"`([a-z_]+\.[a-z_.]+)`", doc))
    assert set(readiness.REQUIRED_EVENTS) <= listed
