"""Plan trials and credit packs through Stripe Checkout, invoice breakdowns on
pay links, and emailing a pay link to the client."""
import json

import pytest

from conftest import bearer, run, signup
from app import email as mail, repo
from app.config import get_settings
from app.payments import stripe_api, subscriptions
from app.routers import payments as payments_router
from test_payments import SECRET, create_link, invoice, notifications, post_event


@pytest.fixture(autouse=True)
def clean_state():
    subscriptions.reset_memory()
    payments_router._send_hits.clear()
    yield
    subscriptions.reset_memory()


@pytest.fixture
def user(client):
    data = signup(client, email="maker@example.com", role="admin", name="Sam Rivera", company="Pixel Forge")
    return {"headers": bearer(data["token"]), "id": data["user"]["id"]}


@pytest.fixture
def stripe(monkeypatch):
    """Stripe is configured; API calls are recorded instead of sent."""
    settings = get_settings()
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")
    monkeypatch.setattr(settings, "stripe_webhook_secret", SECRET)
    state = {"subs": [], "payments": [], "portal": [], "cancel": []}

    async def create_sub(settings, **kwargs):
        state["subs"].append(kwargs)
        return {"id": f"cs_sub_{len(state['subs'])}", "url": "https://checkout.stripe.com/c/pay/sub"}

    async def create_payment(settings, **kwargs):
        state["payments"].append(kwargs)
        return {"id": f"cs_pay_{len(state['payments'])}", "url": "https://checkout.stripe.com/c/pay/pack"}

    async def portal(settings, **kwargs):
        state["portal"].append(kwargs)
        return "https://billing.stripe.com/p/session/abc"

    async def cancel(settings, subscription_id, flag):
        state["cancel"].append((subscription_id, flag))
        return {"id": subscription_id, "cancel_at_period_end": flag}

    monkeypatch.setattr(stripe_api, "create_subscription_session", create_sub)
    monkeypatch.setattr(stripe_api, "create_checkout_session", create_payment)
    monkeypatch.setattr(stripe_api, "create_portal_session", portal)
    async def kind(settings, payment_intent_id):
        return None

    monkeypatch.setattr(stripe_api, "set_cancel_at_period_end", cancel)
    monkeypatch.setattr(stripe_api, "payment_method_kind", kind)
    return state


def billing(client, user):
    return client.get("/api/user-monetization", headers=user["headers"]).json()


def plan_completed(user_id, plan="pro", *, trial=3, session_id="cs_sub_1", sub_id="sub_1") -> bytes:
    return json.dumps({"id": f"evt_{session_id}", "type": "checkout.session.completed", "data": {"object": {
        "id": session_id, "object": "checkout.session", "mode": "subscription", "status": "complete",
        "payment_status": "no_payment_required" if trial else "paid", "customer": "cus_1", "subscription": sub_id,
        "client_reference_id": user_id,
        "metadata": {"user_id": user_id, "kind": "plan", "plan": plan, "trial_days": str(trial)},
    }}}).encode()


def pack_completed(user_id, pack="bids", amount=990, *, status="paid", session_id="cs_pay_1",
                   etype="checkout.session.completed") -> bytes:
    return json.dumps({"id": f"evt_{session_id}_{etype}", "type": etype, "data": {"object": {
        "id": session_id, "object": "checkout.session", "mode": "payment", "payment_status": status,
        "amount_total": amount, "currency": "usd", "client_reference_id": user_id,
        "metadata": {"user_id": user_id, "kind": "pack", "pack": pack},
    }}}).encode()


def sub_event(user_id, status, *, sub_id="sub_1", event_id="evt_s1", deleted=False, **extra) -> bytes:
    obj = {"id": sub_id, "object": "subscription", "status": status, "customer": "cus_1",
           "metadata": {"user_id": user_id}, "trial_end": None, "current_period_end": 1_900_000_000,
           "cancel_at_period_end": False, **extra}
    etype = "customer.subscription.deleted" if deleted else "customer.subscription.updated"
    return json.dumps({"id": event_id, "type": etype, "data": {"object": obj}}).encode()


def invoice_paid(user_id, amount, *, sub_id="sub_1", invoice_id="in_1", reason="subscription_cycle") -> bytes:
    return json.dumps({"id": f"evt_{invoice_id}", "type": "invoice.paid", "data": {"object": {
        "id": invoice_id, "object": "invoice", "subscription": sub_id, "amount_paid": amount,
        "billing_reason": reason, "subscription_details": {"metadata": {"user_id": user_id}},
    }}}).encode()


# --------------------------------------------------------------------------- #
# Checkout config and simulated purchases
# --------------------------------------------------------------------------- #
def test_config_without_stripe_says_checkout_is_off(client, user):
    cfg = client.get("/api/billing/checkout-config", headers=user["headers"]).json()
    assert cfg["live"] is False and cfg["simulated"] is True
    assert cfg["trialDays"] == 3 and cfg["trialAvailable"] is True and cfg["subscription"] is None
    assert {p["id"] for p in cfg["plans"]} >= {"free", "plus", "pro"}
    res = client.post("/api/billing/checkout", json={"plan": "pro"}, headers=user["headers"])
    assert res.status_code == 503 and "nothing was charged" in res.json()["detail"]


def test_checkout_needs_a_session_and_one_choice(client, user):
    assert client.post("/api/billing/checkout", json={"plan": "pro"}).status_code == 401
    for body in ({}, {"plan": "pro", "pack": "bids"}, {"plan": "gold"}, {"plan": "pro", "method": "crypto"}):
        assert client.post("/api/billing/checkout", json=body, headers=user["headers"]).status_code == 422


def test_simulated_purchases_are_refused_once_stripe_is_on(client, user, stripe):
    assert client.post("/api/billing/upgrade", headers=user["headers"]).status_code == 409
    assert client.post("/api/billing/credits", json={"kind": "bids"}, headers=user["headers"]).status_code == 409
    assert billing(client, user)["plan"] == "free"


def test_simulated_purchases_are_refused_in_production(client, user, monkeypatch):
    monkeypatch.setattr(get_settings(), "environment", "production")
    assert client.post("/api/billing/upgrade", headers=user["headers"]).status_code == 403
    assert client.post("/api/billing/credits", json={"kind": "bids"}, headers=user["headers"]).status_code == 403
    assert billing(client, user)["plan"] == "free"


# --------------------------------------------------------------------------- #
# Plans: trial checkout and the webhook
# --------------------------------------------------------------------------- #
def test_plan_checkout_starts_a_trial_session(client, user, stripe):
    res = client.post("/api/billing/checkout", json={"plan": "pro"}, headers=user["headers"])
    assert res.status_code == 200 and res.json()["url"].startswith("https://checkout.stripe.com/")
    call = stripe["subs"][0]
    assert call["amount_cents"] == 1900 and call["interval"] == "month" and call["trial_days"] == 3
    assert call["metadata"] == {"user_id": user["id"], "kind": "plan", "plan": "pro", "trial_days": 3}
    assert call["customer_email"] == "maker@example.com"
    assert "/checkout/success?plan=pro" in call["success_url"] and "{CHECKOUT_SESSION_ID}" in call["success_url"]
    # Nothing changes until Stripe confirms.
    assert billing(client, user)["plan"] == "free"


def test_completed_trial_switches_the_plan_once(client, user, stripe):
    body = plan_completed(user["id"])
    assert post_event(client, body).json()["plan"] == "pro"
    assert post_event(client, body).json().get("duplicate") is True
    b = billing(client, user)
    assert b["plan"] == "pro"
    trials = [p for p in b["purchases"] if p["status"] == "Trial"]
    assert len(trials) == 1 and trials[0]["amount"] == 0
    cfg = client.get("/api/billing/checkout-config", headers=user["headers"]).json()
    assert cfg["trialAvailable"] is False and cfg["subscription"]["status"] == "trialing"
    assert len(notifications(client, user["id"], "Welcome to Pro")) == 1
    # Already on Pro: no second checkout.
    assert client.post("/api/billing/checkout", json={"plan": "pro"}, headers=user["headers"]).status_code == 409


def test_one_free_trial_per_account(client, user, stripe):
    post_event(client, plan_completed(user["id"]))
    post_event(client, sub_event(user["id"], "canceled", deleted=True))
    assert billing(client, user)["plan"] == "free"
    client.post("/api/billing/checkout", json={"plan": "pro"}, headers=user["headers"])
    assert stripe["subs"][-1]["trial_days"] == 0


def test_plus_adds_bids_at_start_and_each_renewal(client, user, stripe):
    start = billing(client, user)["bidCredits"]
    post_event(client, plan_completed(user["id"], "plus"))
    assert billing(client, user)["bidCredits"] == start + 50
    post_event(client, invoice_paid(user["id"], 900))
    post_event(client, invoice_paid(user["id"], 900))  # retried delivery
    b = billing(client, user)
    assert b["bidCredits"] == start + 100 and b["plan"] == "plus"
    assert sum(1 for p in b["purchases"] if p["status"] == "Paid" and p["amount"] == 9) == 1


def test_first_invoice_of_a_trial_adds_nothing(client, user, stripe):
    post_event(client, plan_completed(user["id"], "plus"))
    before = billing(client, user)
    post_event(client, invoice_paid(user["id"], 0, invoice_id="in_0", reason="subscription_create"))
    assert billing(client, user) == before


def test_cancelled_subscription_ends_the_plan(client, user, stripe):
    post_event(client, plan_completed(user["id"]))
    post_event(client, sub_event(user["id"], "active", event_id="evt_a", cancel_at_period_end=True))
    sub = client.get("/api/billing/checkout-config", headers=user["headers"]).json()["subscription"]
    assert sub["cancelAtPeriodEnd"] is True and billing(client, user)["plan"] == "pro"
    post_event(client, sub_event(user["id"], "canceled", event_id="evt_b", deleted=True))
    assert billing(client, user)["plan"] == "free"
    assert len(notifications(client, user["id"], "Your plan ended")) == 1


def test_an_old_subscription_ending_keeps_the_new_plan(client, user, stripe):
    post_event(client, plan_completed(user["id"], sub_id="sub_new"))
    post_event(client, sub_event(user["id"], "canceled", sub_id="sub_old", event_id="evt_old", deleted=True))
    assert billing(client, user)["plan"] == "pro"


def test_portal_and_cancel(client, user, stripe):
    assert client.post("/api/billing/portal", headers=user["headers"]).status_code == 404
    assert client.post("/api/billing/subscription/cancel", json={}, headers=user["headers"]).status_code == 404
    post_event(client, plan_completed(user["id"]))
    res = client.post("/api/billing/portal", headers=user["headers"])
    assert res.status_code == 200 and res.json()["url"].startswith("https://billing.stripe.com/")
    assert stripe["portal"][0]["customer_id"] == "cus_1"
    res = client.post("/api/billing/subscription/cancel", json={"cancel": True}, headers=user["headers"])
    assert res.status_code == 200 and res.json()["subscription"]["cancelAtPeriodEnd"] is True
    assert stripe["cancel"] == [("sub_1", True)]


# --------------------------------------------------------------------------- #
# Credit packs
# --------------------------------------------------------------------------- #
def test_pack_checkout_and_webhook_add_credits_once(client, user, stripe):
    res = client.post("/api/billing/checkout", json={"pack": "bids"}, headers=user["headers"])
    assert res.status_code == 200
    call = stripe["payments"][0]
    assert call["amount_cents"] == 990 and call["method"] == "card"
    assert call["metadata"] == {"user_id": user["id"], "kind": "pack", "pack": "bids"}
    start = billing(client, user)["bidCredits"]
    body = pack_completed(user["id"])
    post_event(client, body)
    post_event(client, body)
    assert billing(client, user)["bidCredits"] == start + 10


def test_short_or_unsettled_pack_payments_add_nothing(client, user, stripe):
    start = billing(client, user)["bidCredits"]
    post_event(client, pack_completed(user["id"], amount=100, session_id="cs_short"))
    post_event(client, pack_completed(user["id"], status="unpaid", session_id="cs_crypto"))
    assert billing(client, user)["bidCredits"] == start
    post_event(client, pack_completed(user["id"], session_id="cs_crypto", etype="checkout.session.async_payment_succeeded"))
    assert billing(client, user)["bidCredits"] == start + 10


def test_pro_does_not_need_packs_and_crypto_needs_its_switch(client, user, stripe):
    res = client.post("/api/billing/checkout", json={"pack": "bids", "method": "crypto"}, headers=user["headers"])
    assert res.status_code == 503
    post_event(client, plan_completed(user["id"]))
    assert client.post("/api/billing/checkout", json={"pack": "bids"}, headers=user["headers"]).status_code == 409


def test_pay_link_events_still_reach_pay_links(client, user, stripe):
    """Billing only takes sessions it created; invoice payments pass through."""
    token = create_link(client, user)["token"]
    body = json.dumps({"id": "evt_pl", "type": "checkout.session.completed", "data": {"object": {
        "id": "cs_pl", "payment_status": "paid", "amount_total": 50_000, "currency": "usd",
        "metadata": {"pay_token": token, "milestone_id": "m1", "method": "credit"},
    }}}).encode()
    assert post_event(client, body).json()["paid"] is True


# --------------------------------------------------------------------------- #
# Pay-link breakdown and emailing the link
# --------------------------------------------------------------------------- #
ITEMS = [{"description": "Design", "quantity": 2, "unitPrice": 400}, {"description": "Build", "quantity": 1, "unitPrice": 1000}]


def test_breakdown_is_stored_and_shown_to_the_client(client, user):
    # 1800 - 100 discount = 1700, + 10% tax = 1870
    link = create_link(client, user, lineItems=ITEMS, discount=100, taxRate=10, notes="Thanks!", issued="2026-11-12",
                       due="2026-12-01", milestones=[{"id": "m1", "title": "Deposit", "amount": 935, "due": "2026-11-20"},
                                                     {"id": "m2", "title": "Final", "amount": 935, "due": "2026-12-01"}])
    page = client.get(f"/api/pay/{link['token']}").json()
    assert [i["amount"] for i in page["lineItems"]] == [800, 1000]
    assert page["subtotal"] == 1800 and page["discount"] == 100 and page["taxRate"] == 10 and page["tax"] == 170
    assert page["notes"] == "Thanks!" and page["issued"] == "2026-11-12" and page["due"] == "2026-12-01"
    assert page["total"] == 1870


def test_breakdown_must_match_what_is_charged(client, user):
    bad = invoice(lineItems=ITEMS)  # milestones add up to 1750.50, items to 1800
    res = client.post("/api/pay-links", json=bad, headers=user["headers"])
    assert res.status_code == 422 and "invoice total" in res.json()["detail"]
    res = client.post("/api/pay-links", json=invoice(lineItems=ITEMS, discount=5000), headers=user["headers"])
    assert res.status_code == 422
    plain = client.get(f"/api/pay/{create_link(client, user)['token']}").json()
    assert plain["lineItems"] == [] and plain["subtotal"] is None


def test_send_needs_email_configured(client, user):
    create_link(client, user)
    res = client.post("/api/pay-links/inv-1/send", json={"email": "client@acme.co"}, headers=user["headers"])
    assert res.status_code == 503
    assert client.post("/api/pay-links/nope/send", json={"email": "client@acme.co"}, headers=user["headers"]).status_code == 404


def test_send_emails_the_link_escaped_and_rate_limited(client, user, monkeypatch):
    sent = []

    async def fake_send(to, subject, html):
        sent.append((to, subject, html))
        return True

    monkeypatch.setattr(mail, "enabled", lambda: True)
    monkeypatch.setattr(mail, "send_email", fake_send)
    res = client.post("/api/pay-links", json=invoice(client="<b>Acme</b>"), headers=user["headers"])
    token = res.json()["token"]
    res = client.post("/api/pay-links/inv-1/send", json={"email": "Client@Acme.co", "message": "<script>x</script>"},
                      headers=user["headers"])
    assert res.status_code == 200 and res.json()["to"] == "client@acme.co"
    to, subject, html = sent[0]
    assert to == "client@acme.co" and "INV-0001" in subject
    assert f"/pay/{token}" in html and "<script>" not in html and "&lt;script&gt;" in html
    assert client.post("/api/pay-links/inv-1/send", json={"email": "bad"}, headers=user["headers"]).status_code == 422
    for _ in range(4):
        client.post("/api/pay-links/inv-1/send", json={"email": "client@acme.co"}, headers=user["headers"])
    res = client.post("/api/pay-links/inv-1/send", json={"email": "client@acme.co"}, headers=user["headers"])
    assert res.status_code == 429 and len(sent) == 5


def test_stripe_subscription_helper_builds_the_request(client, monkeypatch):
    seen = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"id": "cs_1", "url": "https://checkout.stripe.com/x"}

    async def fake_post(self, url, data=None, headers=None):
        seen.update(url=url, data=data)
        return FakeResponse()

    import httpx
    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    settings = get_settings()
    out = run(client, lambda: stripe_api.create_subscription_session(
        settings, amount_cents=900, name="Autopilot Plus", interval="month", trial_days=3,
        metadata={"user_id": "u1", "plan": "plus"}, success_url="https://x/s", cancel_url="https://x/c",
        client_reference_id="u1", customer_email="a@b.co"))
    assert out["url"].startswith("https://checkout.stripe.com/")
    d = seen["data"]
    assert seen["url"].endswith("/checkout/sessions") and d["mode"] == "subscription"
    assert d["line_items[0][price_data][recurring][interval]"] == "month"
    assert d["subscription_data[trial_period_days]"] == "3"
    assert d["subscription_data[metadata][plan]"] == "plus" and d["customer_email"] == "a@b.co"
