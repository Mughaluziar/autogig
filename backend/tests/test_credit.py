"""AutoGig project-credit prototype (simulated): contributions, applications, offers, agreements, repayments, defaults."""
import random
from datetime import timedelta
from uuid import uuid4

import pytest

from conftest import bearer, run, signup
from app import db
from app.capital import ledger, store as cstore
from app.credit import service


def key():
    return uuid4().hex


def uid(client, email):
    return run(client, db.find_user, email)["id"]


@pytest.fixture
def owner(client):
    return bearer(signup(client, email="owner@example.com")["token"])


def verify(client, owner, headers, email, roles=("freelancer",)):
    body = {"legalName": "Test Person", "country": "US", "roles": list(roles)}
    assert client.post("/api/capital/verification", headers=headers, json=body).status_code == 200
    assert client.post(f"/api/capital/admin/verifications/{uid(client, email)}", headers=owner, json={"approve": True}).status_code == 200


def freelancer(client, owner, email="fl@example.com", verified=True):
    headers = bearer(signup(client, email=email)["token"])
    if verified:
        verify(client, owner, headers, email)
    return headers


def contribute(client, headers, cents=500_000):
    res = client.post("/api/credit/contributions", headers=headers, json={"amountCents": cents, "idempotencyKey": key(), "acceptRisk": True})
    assert res.status_code == 200, res.text
    return res.json()


def pool(client, owner, cents=500_000):
    contribute(client, bearer(signup(client, email="inv@example.com", role="investor")["token"]), cents)


APP = {"title": "Brand site for a client", "description": "Fixed-price website project; need software licences up front.",
       "requestedCents": 100_000, "installments": 3}


def offer(client, owner, app_id, **kw):
    body = {"approve": True, "grade": "B", "feeBps": 1000, "installments": 3, "principalCents": 100_000, "note": "ok"}
    body.update(kw)
    return client.post(f"/api/credit/admin/applications/{app_id}/decision", headers=owner, json=body)


def funded_agreement(client, owner, fl):
    app = client.post("/api/credit/applications", headers=fl, json=APP).json()
    assert offer(client, owner, app["id"]).status_code == 200
    res = client.post(f"/api/credit/applications/{app['id']}/accept", headers=fl, json={"acceptTerms": True})
    assert res.status_code == 200, res.text
    return res.json()


def treasury(client, owner):
    return client.get("/api/credit/admin/treasury", headers=owner).json()


# --------------------------------------------------------------------------------------------------- arithmetic
def test_split_evenly_always_adds_up_and_stays_balanced():
    rng = random.Random(7)
    for _ in range(500):
        total, parts = rng.randint(0, 10**9), rng.randint(1, 6)
        pieces = service.split_evenly(total, parts)
        assert sum(pieces) == total and max(pieces) - min(pieces) <= 1 and all(isinstance(p, int) for p in pieces)


def test_schedule_fee_and_principal_are_exact_integers():
    sched = service.build_schedule(100_001, 1_234, 3, cstore.now())
    assert sum(i["principal_cents"] for i in sched) == 100_001
    assert sum(i["fee_cents"] for i in sched) == 100_001 * 1_234 // 10_000


def test_payment_goes_to_the_oldest_installment_fee_first():
    sched = service.build_schedule(30_000, 1_000, 3, cstore.now())      # 10_000 + 1_000 fee each
    after, prin, fee = service.apply_payment(sched, 1_500)
    assert (fee, prin) == (1_000, 500) and after[0]["principal_paid_cents"] == 500 and after[1]["principal_paid_cents"] == 0


# ------------------------------------------------------------------------------------------------ contributions
def test_contribution_rules_and_idempotency(client, owner):
    inv = bearer(signup(client, email="inv@example.com", role="investor")["token"])
    k = key()
    body = {"amountCents": 20_000, "idempotencyKey": k, "acceptRisk": True}
    assert client.post("/api/credit/contributions", headers=inv, json={**body, "acceptRisk": False}).status_code == 422
    assert client.post("/api/credit/contributions", headers=inv, json={**body, "amountCents": 500}).status_code == 422
    assert client.post("/api/credit/contributions", headers=inv, json={**body, "amountCents": 10**9}).status_code == 422
    first = client.post("/api/credit/contributions", headers=inv, json=body)
    again = client.post("/api/credit/contributions", headers=inv, json=body)
    assert first.status_code == again.status_code == 200 and first.json()["contribution"]["id"] == again.json()["contribution"]["id"]
    assert first.json()["settlement"] == "simulated"
    assert treasury(client, owner)["contributionsCents"] == 20_000
    assert client.get("/api/credit/statement", headers=inv).json()["contributedCents"] == 20_000


def test_contribution_endpoint_rejects_bad_keys_and_floats(client, owner):
    inv = bearer(signup(client, email="inv@example.com", role="investor")["token"])
    assert client.post("/api/credit/contributions", headers=inv, json={"amountCents": 20_000.5, "idempotencyKey": key(), "acceptRisk": True}).status_code == 422
    assert client.post("/api/credit/contributions", headers=inv, json={"amountCents": 20_000, "idempotencyKey": "bad key!", "acceptRisk": True}).status_code == 422


# -------------------------------------------------------------------------------------------------- eligibility
def test_only_verified_freelancers_and_agencies_can_apply(client, owner):
    pool(client, owner)
    assert client.post("/api/credit/applications", headers=freelancer(client, owner, "raw@example.com", verified=False), json=APP).status_code == 403
    inv = bearer(signup(client, email="inv2@example.com", role="investor")["token"])
    assert client.post("/api/credit/applications", headers=inv, json=APP).status_code == 403
    assert client.post("/api/credit/applications", headers=owner, json=APP).status_code == 403


def test_application_validation(client, owner):
    fl = freelancer(client, owner)
    for bad in ({"requestedCents": 5_000}, {"requestedCents": 10**8}, {"title": "x"}, {"description": "short"}, {"installments": 9}):
        res = client.post("/api/credit/applications", headers=fl, json={**APP, **bad})
        assert res.status_code in (422,), (bad, res.status_code)
    assert client.post("/api/credit/applications", headers=fl, json=APP).status_code == 200
    assert client.post("/api/credit/applications", headers=fl, json=APP).status_code == 409        # one open at a time


# ---------------------------------------------------------------------------------------------------- lifecycle
def test_full_lifecycle_books_balance(client, owner):
    pool(client, owner, 500_000)
    fl = freelancer(client, owner)
    agr = funded_agreement(client, owner, fl)
    assert agr["principalCents"] == 100_000 and agr["feeTotalCents"] == 10_000 and agr["settlement"] == "simulated"
    t = treasury(client, owner)
    assert (t["cashCents"], t["outstandingCents"], t["committedCents"], t["availableCents"]) == (400_000, 100_000, 0, 400_000) and t["ledgerCheck"]
    # partial, then the rest, each with its own idempotency key
    k = key()
    r1 = client.post(f"/api/credit/agreements/{agr['id']}/repay", headers=fl, json={"amountCents": 40_000, "idempotencyKey": k})
    assert r1.status_code == 200, r1.text
    same = client.post(f"/api/credit/agreements/{agr['id']}/repay", headers=fl, json={"amountCents": 40_000, "idempotencyKey": k})
    assert same.json()["openCents"] == r1.json()["openCents"] == 70_000                # the repeat did not charge twice
    assert client.post(f"/api/credit/agreements/{agr['id']}/repay", headers=fl, json={"amountCents": 70_001, "idempotencyKey": key()}).status_code == 422
    done = client.post(f"/api/credit/agreements/{agr['id']}/repay", headers=fl, json={"amountCents": 70_000, "idempotencyKey": key()}).json()
    assert done["status"] == "repaid" and done["openCents"] == 0
    t = treasury(client, owner)
    assert (t["cashCents"], t["outstandingCents"], t["feesCents"], t["repaymentsCents"]) == (510_000, 0, 10_000, 110_000) and t["ledgerCheck"]
    again = client.post("/api/credit/applications", headers=fl, json=APP)       # a repaid borrower can apply again
    assert again.status_code == 200


def test_offer_cannot_exceed_uncommitted_pool_funds(client, owner):
    pool(client, owner, 150_000)
    a, b = freelancer(client, owner, "a@example.com"), freelancer(client, owner, "b@example.com")
    app_a = client.post("/api/credit/applications", headers=a, json=APP).json()
    app_b = client.post("/api/credit/applications", headers=b, json=APP).json()
    assert offer(client, owner, app_a["id"]).status_code == 200
    assert treasury(client, owner)["committedCents"] == 100_000
    assert offer(client, owner, app_b["id"]).status_code == 409                       # only 50_000 left uncommitted
    assert offer(client, owner, app_b["id"], principalCents=50_000).status_code == 200


def test_offer_limits_and_owner_cannot_review_own_application(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    app = client.post("/api/credit/applications", headers=fl, json=APP).json()
    for bad in ({"grade": "Z"}, {"feeBps": 50}, {"feeBps": 5_000}, {"installments": 0}, {"installments": 12}, {"principalCents": 500_000}, {"principalCents": 10}):
        assert offer(client, owner, app["id"], **bad).status_code == 422, bad
    assert client.post(f"/api/credit/admin/applications/{app['id']}/decision", headers=fl, json={"approve": True}).status_code == 403


def test_reject_withdraw_decline_and_expiry(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    app = client.post("/api/credit/applications", headers=fl, json=APP).json()
    assert client.post(f"/api/credit/admin/applications/{app['id']}/decision", headers=owner, json={"approve": False, "note": "no"}).json()["status"] == "declined"
    assert client.post(f"/api/credit/applications/{app['id']}/accept", headers=fl, json={"acceptTerms": True}).status_code == 404
    app2 = client.post("/api/credit/applications", headers=fl, json=APP).json()
    assert client.post(f"/api/credit/applications/{app2['id']}/withdraw", headers=fl).json()["status"] == "withdrawn"
    app3 = client.post("/api/credit/applications", headers=fl, json=APP).json()
    offer(client, owner, app3["id"])
    assert client.post(f"/api/credit/applications/{app3['id']}/accept", headers=fl, json={"acceptTerms": False}).status_code == 422
    assert client.post(f"/api/credit/applications/{app3['id']}/reject", headers=fl).json()["status"] == "rejected"
    app4 = client.post("/api/credit/applications", headers=fl, json=APP).json()
    offer(client, owner, app4["id"])
    run(client, service.run_jobs, None, cstore.now() + timedelta(days=8))
    assert client.post(f"/api/credit/applications/{app4['id']}/accept", headers=fl, json={"acceptTerms": True}).status_code == 404
    assert treasury(client, owner)["committedCents"] == 0


def test_a_second_accept_cannot_create_a_second_agreement(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    app = client.post("/api/credit/applications", headers=fl, json=APP).json()
    offer(client, owner, app["id"])
    assert client.post(f"/api/credit/applications/{app['id']}/accept", headers=fl, json={"acceptTerms": True}).status_code == 200
    assert client.post(f"/api/credit/applications/{app['id']}/accept", headers=fl, json={"acceptTerms": True}).status_code == 404
    assert len(client.get("/api/credit/agreements", headers=fl).json()) == 1
    assert treasury(client, owner)["outstandingCents"] == 100_000


# ---------------------------------------------------------------------------------------------- late and default
def test_late_then_default_writes_off_only_unpaid_principal(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    agr = funded_agreement(client, owner, fl)
    client.post(f"/api/credit/agreements/{agr['id']}/repay", headers=fl, json={"amountCents": 36_668, "idempotencyKey": key()})  # first installment (33,334 + 3,334 fee)
    start = cstore.now()
    assert run(client, service.run_jobs, None, start + timedelta(days=31 + 5))["late"] == 0       # installment 1 is paid; installment 2 not yet due
    assert run(client, service.run_jobs, None, start + timedelta(days=61))["late"] == 1
    assert client.get("/api/credit/agreements", headers=fl).json()[0]["status"] == "late"
    out = run(client, service.run_jobs, None, start + timedelta(days=121))
    assert out["defaulted"] == 1
    got = client.get("/api/credit/agreements", headers=fl).json()[0]
    t = treasury(client, owner)
    assert got["status"] == "defaulted" and got["writtenOffCents"] == t["lossesCents"] == 100_000 - 33_334 and t["outstandingCents"] == 0 and t["ledgerCheck"]
    assert client.post(f"/api/credit/agreements/{agr['id']}/repay", headers=fl, json={"amountCents": 100, "idempotencyKey": key()}).status_code == 404


def test_paying_up_returns_a_late_agreement_to_active(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    agr = funded_agreement(client, owner, fl)
    run(client, service.run_jobs, None, cstore.now() + timedelta(days=31))
    assert client.get("/api/credit/agreements", headers=fl).json()[0]["status"] == "late"
    # the first installment is overdue only, so paying it clears the late flag (the clock for the rest is real time, still ahead)
    first = agr["schedule"][0]
    res = client.post(f"/api/credit/agreements/{agr['id']}/repay", headers=fl, json={"amountCents": first["principalCents"] + first["feeCents"], "idempotencyKey": key()})
    assert res.json()["status"] == "active"


def test_statement_attribution_is_integer_and_can_be_negative(client, owner):
    inv1 = bearer(signup(client, email="i1@example.com", role="investor")["token"])
    inv2 = bearer(signup(client, email="i2@example.com", role="investor")["token"])
    contribute(client, inv1, 300_000)
    contribute(client, inv2, 100_000)
    fl = freelancer(client, owner)
    funded_agreement(client, owner, fl)
    run(client, service.run_jobs, None, cstore.now() + timedelta(days=100))
    s1, s2 = (client.get("/api/credit/statement", headers=h).json() for h in (inv1, inv2))
    assert s1["shareBps"] == 7_500 and s2["shareBps"] == 2_500
    assert s1["attributedLossesCents"] == 75_000 and s2["attributedLossesCents"] == 25_000
    assert s1["simulatedNetCents"] < 0 and all(isinstance(s1[k], int) for k in ("attributedFeesCents", "simulatedNetCents"))
    assert "never a forecast" in s1["notice"] and s1["settlement"] == "simulated"


# ------------------------------------------------------------------------------------------- access and isolation
def test_other_users_cannot_see_or_act_on_my_records(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    other = freelancer(client, owner, "other@example.com")
    app = client.post("/api/credit/applications", headers=fl, json=APP).json()
    offer(client, owner, app["id"])
    assert client.get("/api/credit/applications", headers=other).json() == []
    assert client.post(f"/api/credit/applications/{app['id']}/accept", headers=other, json={"acceptTerms": True}).status_code == 404
    agr = client.post(f"/api/credit/applications/{app['id']}/accept", headers=fl, json={"acceptTerms": True}).json()
    assert client.get("/api/credit/agreements", headers=other).json() == []
    assert client.post(f"/api/credit/agreements/{agr['id']}/repay", headers=other, json={"amountCents": 100, "idempotencyKey": key()}).status_code == 404
    alloc = client.get("/api/credit/pool/allocations", headers=other).json()["allocations"]
    assert len(alloc) == 1 and set(alloc[0]) == {"reference", "grade", "principalCents", "status", "fundedAt", "repaidCents"}   # anonymised


def test_admin_routes_are_owner_only_and_anonymous_is_refused(client, owner):
    fl = freelancer(client, owner)
    for method, path in (("get", "/api/credit/admin/applications"), ("get", "/api/credit/admin/treasury"), ("get", "/api/credit/admin/audit"),
                         ("post", "/api/credit/admin/run-jobs"), ("get", "/api/credit/admin/agreements")):
        assert getattr(client, method)(path, headers=fl).status_code == 403, path
        assert getattr(client, method)(path).status_code == 401, path


def test_applicant_contact_details_stay_out_of_borrower_responses(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    mine = client.post("/api/credit/applications", headers=fl, json=APP).json()
    assert "applicantEmail" not in mine and "applicantId" not in mine and "open" not in mine
    admin = client.get("/api/credit/admin/applications", headers=owner).json()[0]
    assert admin["applicantEmail"] == "fl@example.com" and admin["signals"]["kycStatus"] == "verified"


def test_every_action_is_audited_and_the_trail_has_no_edit_route(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    agr = funded_agreement(client, owner, fl)
    client.post(f"/api/credit/agreements/{agr['id']}/repay", headers=fl, json={"amountCents": 1_000, "idempotencyKey": key()})
    actions = {a["action"] for a in client.get("/api/credit/admin/audit", headers=owner).json()}
    assert {"contribution", "application_submitted", "offer_made", "offer_accepted", "repayment"} <= actions
    assert client.delete("/api/credit/admin/audit", headers=owner).status_code in (404, 405)


def test_open_credit_blocks_account_deletion_until_settled(client, owner):
    from app import datarights
    pool(client, owner)
    fl = freelancer(client, owner)
    funded_agreement(client, owner, fl)
    user = run(client, db.find_user, "fl@example.com")
    blockers = run(client, datarights.blockers, user)
    assert any("credit agreement" in b for b in blockers)


def test_credit_is_gated_like_the_other_simulated_modules(client, owner, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "simulated_modules", "invited")
    ann = bearer(signup(client, email="ann@example.com", role="freelancer")["token"])
    assert client.get("/api/credit/overview", headers=ann).status_code == 403
    assert client.get("/api/credit/overview", headers=owner).status_code == 200


def test_the_database_guard_stops_two_simultaneous_open_applications(client, owner):
    """The pre-check can race; the unique open-application guard in the store is the real protection."""
    pool(client, owner)
    fl = freelancer(client, owner)
    user = run(client, db.find_user, "fl@example.com")
    fields = {"title": "Site", "description": "x" * 30, "requested_cents": 100_000, "installments": 3, }
    run(client, service._insert_application, user, 100_000, fields)
    with pytest.raises(cstore.Conflict):
        run(client, service._insert_application, user, 100_000, fields)
    assert len(client.get("/api/credit/applications", headers=fl).json()) == 1
