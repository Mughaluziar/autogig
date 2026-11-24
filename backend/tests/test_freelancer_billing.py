"""Freelancer billing: pool bids spend bid credits from the plan (Pro is unlimited), refunds when a spec closes
without a hire, the switch that turns it off, the freelancer's view of plans and packs, and receipts."""
from datetime import date, timedelta

import pytest

from app import repo
from app.config import get_settings
from app.payments import subscriptions
from conftest import bearer, run, signup
from test_billing_checkout import plan_completed, stripe  # noqa: F401  (the fixture)
from test_payments import post_event

FUTURE = (date.today() + timedelta(days=30)).isoformat()


@pytest.fixture(autouse=True)
def clean_subscriptions():
    subscriptions.reset_memory()
    yield
    subscriptions.reset_memory()


@pytest.fixture
def people(client):
    def make(email, role, name):
        data = signup(client, email=email, role=role, name=name)
        return {"h": bearer(data["token"]), "id": data["user"]["id"]}
    return {"agency": make("agency@example.com", "admin", "Ada"), "ann": make("ann@example.com", "freelancer", "Ann"),
            "bob": make("bob@example.com", "freelancer", "Bob")}


def spec(client, agency, title="Build a dashboard"):
    res = client.post("/api/pool/admin/specs", headers=agency["h"], json={"title": title, "estHours": 10, "deadline": FUTURE})
    assert res.status_code == 200, res.text
    return res.json()["id"]


def bid(client, who, spec_id, hours=10):
    return client.post(f"/api/pool/specs/{spec_id}/bid", headers=who["h"], json={"hours": hours, "rate": 30})


def credits(client, who):
    return client.get("/api/pool/bid-credits", headers=who["h"]).json()


def set_credits(client, who, n):
    async def go():
        await repo._ensure_billing(who["id"])
        if repo.db.enabled():
            await repo.db._get_db().billing.update_one({"_id": who["id"]}, {"$set": {"bidCredits": n}})
        else:
            repo._mem_docs["billing"][who["id"]]["bidCredits"] = n
    run(client, go)


# --------------------------------------------------------------------------- #
# Bid credits in the pool
# --------------------------------------------------------------------------- #
def test_first_bid_on_a_spec_spends_one_credit_and_edits_are_free(client, people):
    agency, ann = people["agency"], people["ann"]
    s = spec(client, agency)
    assert credits(client, ann)["left"] == 10
    assert bid(client, ann, s).status_code == 200
    assert credits(client, ann)["left"] == 9
    assert bid(client, ann, s, hours=12).status_code == 200                     # edit
    client.delete(f"/api/pool/specs/{s}/bid", headers=ann["h"])                 # withdraw...
    assert bid(client, ann, s, hours=8).status_code == 200                      # ...and bid again
    info = credits(client, ann)
    assert info["left"] == 9 and info["enabled"] is True and info["unlimited"] is False
    assert [(u["spec"], u["credit"]) for u in info["used"]] == [("Build a dashboard", "spent")]


def test_out_of_credits_is_refused_until_topped_up(client, people):
    agency, ann = people["agency"], people["ann"]
    s1, s2 = spec(client, agency, "One"), spec(client, agency, "Two")
    set_credits(client, ann, 1)
    assert bid(client, ann, s1).status_code == 200
    res = bid(client, ann, s2)
    assert res.status_code == 402 and "Billing & Plan" in res.json()["detail"]
    assert client.get("/api/pool/my-bids", headers=ann["h"]).json()[0]["spec"] == "One"
    # Development top-up (simulated, no Stripe): ten more.
    assert client.post("/api/billing/credits", headers=ann["h"], json={"kind": "bids"}).status_code == 200
    assert bid(client, ann, s2).status_code == 200
    assert credits(client, ann)["left"] == 9


def test_pro_bids_without_spending(client, people):
    agency, ann = people["agency"], people["ann"]
    s = spec(client, agency)
    assert client.post("/api/billing/upgrade", headers=ann["h"]).status_code == 200         # simulated Pro
    set_credits(client, ann, 0)
    assert bid(client, ann, s).status_code == 200
    info = credits(client, ann)
    assert info["unlimited"] is True and info["left"] == 0 and info["used"][0]["credit"] == "plan"


def test_closing_a_spec_without_hiring_refunds_but_losing_to_another_bid_does_not(client, people):
    agency, ann, bob = people["agency"], people["ann"], people["bob"]
    closed, awarded = spec(client, agency, "Closed"), spec(client, agency, "Awarded")
    bid(client, ann, closed)
    bid(client, ann, awarded)
    bob_bid = bid(client, bob, awarded).json()
    assert credits(client, ann)["left"] == 8
    res = client.post(f"/api/pool/admin/specs/{closed}/close", headers=agency["h"])
    assert res.json()["creditsRefunded"] == 1
    client.post(f"/api/pool/admin/specs/{awarded}/award", headers=agency["h"], json={"bidId": bob_bid["id"]})
    info = credits(client, ann)
    assert info["left"] == 9
    assert {u["spec"]: u["credit"] for u in info["used"]} == {"Closed": "refunded", "Awarded": "spent"}
    # A second close is refused, so the refund can't repeat.
    assert client.post(f"/api/pool/admin/specs/{closed}/close", headers=agency["h"]).status_code == 409
    assert credits(client, ann)["left"] == 9


def test_interrupted_refund_repairs_without_a_second_credit(client, people, monkeypatch):
    from app.pool import store

    agency, ann = people["agency"], people["ann"]
    s = spec(client, agency, "Interrupted close")
    assert bid(client, ann, s).status_code == 200
    assert credits(client, ann)["left"] == 9
    original_update = store.update
    interrupted = False

    async def fail_after_refund(coll, item_id, fields, *, expect=None):
        nonlocal interrupted
        if coll == "bids" and fields.get("credit") == "refunded" and not interrupted:
            interrupted = True
            raise RuntimeError("simulated interruption after billing refund")
        return await original_update(coll, item_id, fields, expect=expect)

    with monkeypatch.context() as patch:
        patch.setattr(store, "update", fail_after_refund)
        assert client.post(f"/api/pool/admin/specs/{s}/close", headers=agency["h"]).status_code == 500
    assert credits(client, ann)["left"] == 10
    assert client.get("/api/pool/admin/specs", headers=agency["h"]).status_code == 200
    assert client.get("/api/pool/admin/specs", headers=agency["h"]).status_code == 200
    info = credits(client, ann)
    assert info["left"] == 10 and info["used"][0]["credit"] == "refunded"


def test_deleting_the_agency_refunds_bids_on_its_open_specs(client, people):
    from app import datarights, db
    agency, ann = people["agency"], people["ann"]
    s = spec(client, agency)
    bid(client, ann, s)
    assert credits(client, ann)["left"] == 9
    run(client, datarights.execute_deletion, run(client, db.find_user_by_id, agency["id"]))
    assert credits(client, ann)["left"] == 10


def test_the_switch_makes_pool_bidding_free(client, people, monkeypatch):
    monkeypatch.setattr(get_settings(), "pool_bid_credits", False)
    agency, ann = people["agency"], people["ann"]
    set_credits(client, ann, 0)
    assert bid(client, ann, spec(client, agency)).status_code == 200
    info = credits(client, ann)
    assert info["enabled"] is False and info["left"] == 0 and info["used"] == []


def test_bid_credits_endpoint_is_for_freelancers(client, people):
    assert client.get("/api/pool/bid-credits", headers=people["agency"]["h"]).status_code == 403
    assert client.get("/api/pool/bid-credits").status_code == 401


# --------------------------------------------------------------------------- #
# Plans and packs as a freelancer sees them
# --------------------------------------------------------------------------- #
def test_checkout_config_describes_plans_for_the_account_type(client, people):
    fl = client.get("/api/billing/checkout-config", headers=people["ann"]["h"]).json()
    ag = client.get("/api/billing/checkout-config", headers=people["agency"]["h"]).json()
    assert fl["planPage"] == "/freelancer/billing" and ag["planPage"] == "/dashboard/money/plan"
    fl_pro = next(p for p in fl["plans"] if p["id"] == "pro")
    ag_pro = next(p for p in ag["plans"] if p["id"] == "pro")
    assert "Unlimited spec bids" in fl_pro["features"] and fl_pro["price"] == ag_pro["price"] == 19
    assert "Unlimited bids & profiles" in ag_pro["features"]
    assert [p["id"] for p in fl["packs"]] == ["bids"] and [p["id"] for p in ag["packs"]] == ["bids", "profiles"]


def test_freelancers_are_not_sold_profile_slots(client, people, stripe):  # noqa: F811
    ann = people["ann"]
    assert client.post("/api/billing/checkout", headers=ann["h"], json={"pack": "profiles"}).status_code == 422
    assert stripe["payments"] == []
    assert client.post("/api/billing/checkout", headers=ann["h"], json={"pack": "bids"}).status_code == 200


def test_simulated_profile_pack_is_refused_for_freelancers(client, people):
    assert client.post("/api/billing/credits", headers=people["ann"]["h"], json={"kind": "profiles"}).status_code == 422
    assert client.post("/api/billing/credits", headers=people["agency"]["h"], json={"kind": "profiles"}).status_code == 200


def test_billing_portal_returns_a_freelancer_to_their_billing_page(client, people, stripe):  # noqa: F811
    ann = people["ann"]
    post_event(client, plan_completed(ann["id"]))
    assert client.post("/api/billing/portal", headers=ann["h"]).status_code == 200
    assert stripe["portal"][0]["return_url"].endswith("/freelancer/billing")


# --------------------------------------------------------------------------- #
# Receipts
# --------------------------------------------------------------------------- #
def test_receipts_come_from_the_servers_record_and_only_your_own(client, people):
    ann, bob = people["ann"], people["bob"]
    purchase = client.post("/api/billing/credits", headers=ann["h"], json={"kind": "bids"}).json()["purchase"]
    res = client.get(f"/api/billing/receipts/{purchase['id']}", headers=ann["h"])
    assert res.status_code == 200
    r = res.json()
    assert r["item"] == "10 Job Bids" and r["amount"] == 9.9 and r["status"] == "Simulated" and r["charged"] is False
    assert "no money moved" in r["note"] and r["billedTo"] == {"name": "Ann", "email": "ann@example.com", "company": ""}
    assert r["number"].startswith("AP-") and r["currency"] == "USD"
    assert client.get(f"/api/billing/receipts/{purchase['id']}", headers=bob["h"]).status_code == 404
    assert client.get("/api/billing/receipts/po-nope", headers=ann["h"]).status_code == 404


def test_a_paid_plan_receipt_says_it_was_charged(client, people, stripe):  # noqa: F811
    ann = people["ann"]
    post_event(client, plan_completed(ann["id"], trial=0))
    paid = client.get("/api/user-monetization", headers=ann["h"]).json()["purchases"][0]
    r = client.get(f"/api/billing/receipts/{paid['id']}", headers=ann["h"]).json()
    assert r["status"] == "Paid" and r["charged"] is True and r["amount"] == 19 and "Stripe" in r["note"]
