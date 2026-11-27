"""AutoGig credit prototype: contribution withdrawals (request, owner review, liquidity, loss share, crash repair) and the
notifications applicants, borrowers and operators receive. Simulated: the ledger and the treasury check must stay exact."""
from datetime import timedelta

import pytest

from conftest import bearer, run, signup
from app.capital import ledger, store as cstore
from app.credit import service
from test_credit import APP, contribute, freelancer, funded_agreement, key, offer, treasury


@pytest.fixture
def owner(client):
    return bearer(signup(client, email="owner@example.com")["token"])


def investor(client, email="inv@example.com", cents=500_000):
    headers = bearer(signup(client, email=email, role="investor")["token"])
    if cents:
        contribute(client, headers, cents)
    return headers


def ask(client, headers, cents, **body):
    return client.post("/api/credit/withdrawals", headers=headers, json={"amountCents": cents, "idempotencyKey": key(), **body})


def review(client, owner, wid, approve=True, note=""):
    return client.post(f"/api/credit/admin/withdrawals/{wid}", headers=owner, json={"approve": approve, "note": note})


def titles(client, headers):
    return [n["title"] for n in client.get("/api/notifications", headers=headers).json()]


# --------------------------------------------------------------------------------------------------- withdrawals
def test_withdrawal_is_requested_then_paid_and_the_books_stay_exact(client, owner):
    inv = investor(client)
    k = key()
    first = client.post("/api/credit/withdrawals", headers=inv, json={"amountCents": 200_000, "idempotencyKey": k, "note": "rent"})
    again = client.post("/api/credit/withdrawals", headers=inv, json={"amountCents": 200_000, "idempotencyKey": k})
    assert first.status_code == 200 and first.json()["id"] == again.json()["id"] and first.json()["status"] == "requested"
    assert client.post("/api/credit/withdrawals", headers=inv, json={"amountCents": 1_000, "idempotencyKey": k}).status_code == 409
    mine = client.get("/api/credit/withdrawals", headers=inv).json()
    assert mine["position"]["pendingCents"] == 200_000 and mine["position"]["withdrawableCents"] == 300_000
    assert "Contribution withdrawal request" in titles(client, owner)

    queue = client.get("/api/credit/admin/withdrawals", headers=owner).json()
    assert queue[0]["contributorId"] and queue[0]["position"]["withdrawableCents"] == 500_000
    paid = review(client, owner, first.json()["id"])
    assert paid.status_code == 200, paid.text
    assert paid.json()["status"] == "paid" and paid.json()["ledgerSeq"]
    assert review(client, owner, first.json()["id"]).status_code == 409
    assert "Withdrawal paid" in titles(client, inv)

    st = client.get("/api/credit/statement", headers=inv).json()
    assert (st["contributedCents"], st["withdrawnCents"], st["netContributedCents"]) == (500_000, 200_000, 300_000)
    assert st["shareBps"] == 10_000 and st["withdrawableCents"] == 300_000
    t = treasury(client, owner)
    assert t["contributionsCents"] == 300_000 and t["cashCents"] == 300_000 and t["ledgerCheck"]


def test_withdrawals_are_limited_to_own_net_contributions_and_free_cash(client, owner):
    inv = investor(client, cents=200_000)
    assert ask(client, inv, 250_000).status_code == 422
    assert ask(client, inv, 500).status_code == 422                          # below the minimum
    assert ask(client, investor(client, "none@example.com", cents=0), 1_000).status_code == 422

    # Most of the pool is out in credit: the request waits until repayments bring cash back.
    fl = freelancer(client, owner)
    agr = funded_agreement(client, owner, fl)                                # 100,000 disbursed of 200,000
    req = ask(client, inv, 150_000).json()
    blocked = review(client, owner, req["id"])
    assert blocked.status_code == 409 and "cash" in blocked.json()["detail"]
    assert client.get("/api/credit/withdrawals", headers=inv).json()["withdrawals"][0]["status"] == "requested"
    client.post(f"/api/credit/agreements/{agr['id']}/repay", headers=fl, json={"amountCents": 110_000, "idempotencyKey": key()})
    assert review(client, owner, req["id"]).json()["status"] == "paid"
    assert treasury(client, owner)["ledgerCheck"]


def test_a_contributor_carries_their_share_of_losses(client, owner):
    a = investor(client, "a@example.com", cents=300_000)
    investor(client, "b@example.com", cents=100_000)
    fl = freelancer(client, owner)
    funded_agreement(client, owner, fl)
    run(client, service.run_jobs, None, cstore.now() + timedelta(days=130))   # 100,000 written off
    position = client.get("/api/credit/withdrawals", headers=a).json()["position"]
    assert position["lossShareCents"] == 75_000 and position["withdrawableCents"] == 225_000
    assert ask(client, a, 225_001).status_code == 422
    assert ask(client, a, 225_000).status_code == 200


def test_cancel_decline_and_owner_rules(client, owner):
    inv = investor(client)
    req = ask(client, inv, 50_000).json()
    other = investor(client, "other@example.com")
    assert client.post(f"/api/credit/withdrawals/{req['id']}/cancel", headers=other).status_code == 404
    assert client.post(f"/api/credit/withdrawals/{req['id']}/cancel", headers=inv).json()["status"] == "cancelled"
    assert review(client, owner, req["id"]).status_code == 409
    req2 = ask(client, inv, 60_000).json()
    declined = review(client, owner, req2["id"], approve=False, note="Pool is closing")
    assert declined.json()["status"] == "declined" and "Withdrawal request declined" in titles(client, inv)
    assert client.get("/api/credit/admin/withdrawals", headers=inv).status_code == 403
    # An owner's own contributions are reviewed by another owner, never by themselves.
    contribute(client, owner, 50_000)
    own = ask(client, owner, 10_000).json()
    assert review(client, owner, own["id"]).status_code == 403


def test_a_withdrawal_interrupted_after_approval_is_finished_by_the_jobs(client, owner):
    inv = investor(client)
    req = ask(client, inv, 100_000).json()
    rec = run(client, cstore.get, "credit_withdrawals", req["id"])

    async def crash_after_intent():                                   # approved, but stopped before the ledger entry
        return await cstore.update("credit_withdrawals", req["id"], {"status": "paying"}, expect_version=rec["version"])
    assert run(client, crash_after_intent)
    summary = run(client, service.run_jobs, None, None)
    assert summary["withdrawalsRepaired"] == 1
    assert run(client, service.run_jobs, None, None)["withdrawalsRepaired"] == 0
    assert client.get("/api/credit/withdrawals", headers=inv).json()["withdrawals"][0]["status"] == "paid"
    entries = [e for e in run(client, ledger.entries) if e["kind"] == "credit_withdrawal"]
    assert len(entries) == 1 and treasury(client, owner)["ledgerCheck"]


def test_a_waiting_withdrawal_blocks_account_deletion(client):
    from app import datarights, db
    inv = investor(client)
    req = ask(client, inv, 10_000).json()
    user = run(client, db.find_user, "inv@example.com")
    assert any("withdrawal" in b for b in run(client, datarights.blockers, user))
    client.post(f"/api/credit/withdrawals/{req['id']}/cancel", headers=inv)
    assert not any("withdrawal" in b for b in run(client, datarights.blockers, user))


# ------------------------------------------------------------------------------------------------- notifications
def test_applicants_and_borrowers_are_told_about_every_step(client, owner):
    investor(client)
    fl = freelancer(client, owner)
    app = client.post("/api/credit/applications", headers=fl, json=APP).json()
    assert "Project credit application" in titles(client, owner)
    assert offer(client, owner, app["id"]).status_code == 200
    assert "You have a credit offer" in titles(client, fl)
    agr = client.post(f"/api/credit/applications/{app['id']}/accept", headers=fl, json={"acceptTerms": True}).json()
    assert "Credit funds sent" in titles(client, fl)
    client.post(f"/api/credit/agreements/{agr['id']}/repay", headers=fl, json={"amountCents": 10_000, "idempotencyKey": key()})
    assert "Repayment received" in titles(client, fl)

    start = cstore.now()
    assert run(client, service.run_jobs, None, start + timedelta(days=28))["reminders"] == 1
    assert run(client, service.run_jobs, None, start + timedelta(days=29))["reminders"] == 0     # once per installment
    assert titles(client, fl).count("Credit installment due soon") == 1
    run(client, service.run_jobs, None, start + timedelta(days=31))
    assert "Credit repayment overdue" in titles(client, fl)
    run(client, service.run_jobs, None, start + timedelta(days=95))
    assert "Credit agreement in default" in titles(client, fl)
    assert all("Simulated" in n["body"] for n in client.get("/api/notifications", headers=fl).json()
               if n["title"].startswith(("Credit", "You have", "Repayment")))


def test_declines_and_expired_offers_are_notified(client, owner):
    investor(client)
    fl = freelancer(client, owner)
    app = client.post("/api/credit/applications", headers=fl, json=APP).json()
    client.post(f"/api/credit/admin/applications/{app['id']}/decision", headers=owner, json={"approve": False, "note": "Too early"})
    assert "Credit application not approved" in titles(client, fl)
    app2 = client.post("/api/credit/applications", headers=fl, json=APP).json()
    offer(client, owner, app2["id"])
    run(client, service.run_jobs, None, cstore.now() + timedelta(days=service.OFFER_VALID_DAYS + 1))
    assert "Credit offer expired" in titles(client, fl)


def test_a_full_repayment_says_so(client, owner):
    investor(client)
    fl = freelancer(client, owner)
    agr = funded_agreement(client, owner, fl)
    client.post(f"/api/credit/agreements/{agr['id']}/repay", headers=fl, json={"amountCents": agr["openCents"], "idempotencyKey": key()})
    assert "Credit repaid in full" in titles(client, fl)
