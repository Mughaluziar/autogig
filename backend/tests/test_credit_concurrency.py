"""Concurrency, idempotency and ledger-integrity tests for the simulated credit prototype.
Each case fires real overlapping calls on the application's own event loop (in MongoDB mode these genuinely interleave at every
database await). Invariants are asserted rather than a particular winner."""
import asyncio
import base64
from datetime import timedelta
from uuid import uuid4

import pytest

from conftest import bearer, run, signup
from app import db
from app.capital import ledger, store as cstore
from app.credit import service
from test_credit import APP, freelancer, offer, pool, treasury, verify, key


async def _all(factories):
    return await asyncio.gather(*(f() for f in factories), return_exceptions=True)


def ok_count(results):
    return sum(1 for r in results if not isinstance(r, Exception))


@pytest.fixture
def owner(client):
    return bearer(signup(client, email="owner@example.com")["token"])


def user_of(client, email):
    return run(client, db.find_user, email)


def fields():
    return {"title": "Site", "description": "Fixed-price website project needing licences.", "requested_cents": 100_000, "installments": 3}


# --------------------------------------------------------------------------------------------- applications
def test_simultaneous_applications_from_one_user_create_exactly_one(client, owner):
    pool(client, owner)
    freelancer(client, owner)
    u = user_of(client, "fl@example.com")
    res = run(client, _all, [lambda: service.apply(u, fields()) for _ in range(6)])
    assert ok_count(res) == 1, res
    assert all(isinstance(r, service.CreditError) and r.status == 409 for r in res if isinstance(r, Exception))
    assert len(client.get("/api/credit/applications", headers=bearer(signup(client, email="x@example.com")["token"])).json()) == 0


def test_simultaneous_applications_from_different_users_all_succeed(client, owner):
    pool(client, owner)
    users = []
    for i in range(4):
        freelancer(client, owner, f"u{i}@example.com")
        users.append(user_of(client, f"u{i}@example.com"))
    res = run(client, _all, [lambda u=u: service.apply(u, fields()) for u in users])
    assert ok_count(res) == 4


# -------------------------------------------------------------------------------------- simultaneous approvals
def test_simultaneous_offers_can_never_reserve_more_than_the_pool_holds(client, owner):
    pool(client, owner, 250_000)                               # room for two $1,000 offers, not five
    apps = []
    for i in range(5):
        h = freelancer(client, owner, f"a{i}@example.com")
        apps.append(client.post("/api/credit/applications", headers=h, json=APP).json()["id"])
    owner_user = user_of(client, "owner@example.com")
    res = run(client, _all, [lambda a=a: service.decide(owner_user, a, approve=True, grade="B", fee_bps=1000, installments=3, principal_cents=100_000) for a in apps])
    assert ok_count(res) == 2, res
    t = treasury(client, owner)
    assert t["committedCents"] == 200_000 and t["availableCents"] == 50_000 and t["ledgerCheck"]
    assert sum(1 for a in client.get("/api/credit/admin/applications", headers=owner).json() if a["status"] == "offered") == 2
    assert sum(1 for a in client.get("/api/credit/admin/applications", headers=owner).json() if a["status"] == "submitted") == 3   # losers reopened


def test_simultaneous_decisions_on_one_application_make_one_offer(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    app_id = client.post("/api/credit/applications", headers=fl, json=APP).json()["id"]
    o = user_of(client, "owner@example.com")
    res = run(client, _all, [lambda: service.decide(o, app_id, approve=True, grade="A", fee_bps=500, installments=2, principal_cents=100_000) for _ in range(5)])
    assert ok_count(res) == 1
    t = treasury(client, owner)
    assert t["committedCents"] == 100_000 and t["ledgerCheck"]            # reserved once, not five times


def test_reserved_money_returns_exactly_once_on_reject_withdraw_and_expiry(client, owner):
    pool(client, owner, 300_000)
    base = ledger_total(client)
    fls = [freelancer(client, owner, f"r{i}@example.com") for i in range(3)]
    ids = [client.post("/api/credit/applications", headers=h, json=APP).json()["id"] for h in fls]
    for i in ids:
        assert offer(client, owner, i).status_code == 200
    assert treasury(client, owner)["committedCents"] == 300_000
    client.post(f"/api/credit/applications/{ids[0]}/reject", headers=fls[0])
    client.post(f"/api/credit/applications/{ids[1]}/withdraw", headers=fls[1])
    run(client, service.run_jobs, None, cstore.now() + timedelta(days=8))                 # expires the third
    run(client, service.run_jobs, None, cstore.now() + timedelta(days=8))                 # and again: no double release
    t = treasury(client, owner)
    assert t["committedCents"] == 0 and t["availableCents"] == 300_000 and t["ledgerCheck"]


def ledger_total(client):
    return run(client, ledger.balances)


def test_simultaneous_accepts_make_one_agreement_and_use_the_reservation_once(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    app_id = client.post("/api/credit/applications", headers=fl, json=APP).json()["id"]
    offer(client, owner, app_id)
    u = user_of(client, "fl@example.com")
    res = run(client, _all, [lambda: service.accept_offer(u, app_id, True) for _ in range(5)])
    assert ok_count(res) == 1
    t = treasury(client, owner)
    assert (t["committedCents"], t["outstandingCents"], t["cashCents"]) == (0, 100_000, 400_000) and t["ledgerCheck"]


def test_accept_racing_a_withdraw_ends_consistent(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    app_id = client.post("/api/credit/applications", headers=fl, json=APP).json()["id"]
    offer(client, owner, app_id)
    u = user_of(client, "fl@example.com")
    run(client, _all, [lambda: service.accept_offer(u, app_id, True), lambda: service.withdraw(u, app_id)])
    run(client, service.run_jobs)
    t = treasury(client, owner)
    agreements = client.get("/api/credit/agreements", headers=fl).json()
    assert t["ledgerCheck"]
    assert (t["outstandingCents"], t["committedCents"]) in ((100_000, 0), (0, 0))      # either funded or fully returned, never half
    assert len(agreements) <= 1


# ------------------------------------------------------------------------------------------------ repayments
def funded(client, owner, fl):
    app_id = client.post("/api/credit/applications", headers=fl, json=APP).json()["id"]
    offer(client, owner, app_id)
    return client.post(f"/api/credit/applications/{app_id}/accept", headers=fl, json={"acceptTerms": True}).json()


def test_concurrent_repayments_never_exceed_what_is_owed_and_the_books_balance(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    agr = funded(client, owner, fl)
    u = user_of(client, "fl@example.com")
    res = run(client, _all, [lambda k=k: service.repay(u, agr["id"], 40_000, f"key-{k}-{uuid4().hex[:8]}") for k in range(6)])
    after = client.get("/api/credit/agreements", headers=fl).json()[0]
    paid = sum(r["amountCents"] for r in after["repayments"])
    assert paid <= 110_000 and after["openCents"] == 110_000 - paid and ok_count(res) == len(after["repayments"])
    run(client, service.run_jobs)
    t = treasury(client, owner)
    assert t["repaymentsCents"] == paid and t["ledgerCheck"]


def test_the_same_repayment_sent_many_times_at_once_is_recorded_once(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    agr = funded(client, owner, fl)
    u = user_of(client, "fl@example.com")
    same = f"dup-{uuid4().hex[:10]}"
    run(client, _all, [lambda: service.repay(u, agr["id"], 25_000, same) for _ in range(8)])
    after = client.get("/api/credit/agreements", headers=fl).json()[0]
    assert len(after["repayments"]) == 1 and after["openCents"] == 85_000
    client.post(f"/api/credit/agreements/{agr['id']}/repay", headers=fl, json={"amountCents": 25_000, "idempotencyKey": same})   # and once more over HTTP
    assert len(client.get("/api/credit/agreements", headers=fl).json()[0]["repayments"]) == 1
    assert treasury(client, owner)["repaymentsCents"] == 25_000


def test_the_same_contribution_sent_many_times_at_once_is_recorded_once(client, owner):
    inv = signup(client, email="inv@example.com", role="investor")
    u = user_of(client, "inv@example.com")
    same = f"dup-{uuid4().hex[:10]}"
    res = run(client, _all, [lambda: service.contribute(u, 30_000, same, True) for _ in range(8)])
    assert ok_count(res) >= 1
    h = bearer(inv["token"])
    assert client.get("/api/credit/statement", headers=h).json()["contributedCents"] == 30_000
    assert len(client.get("/api/credit/statement", headers=h).json()["contributions"]) == 1


def test_repayment_that_stopped_before_the_ledger_is_finished_by_the_job(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    agr = funded(client, owner, fl)
    u = user_of(client, "fl@example.com")
    record = run(client, cstore.get, "credit_agreements", agr["id"])
    # simulate a crash: the repayment is recorded on the agreement but its ledger entry was never posted
    schedule, prin, fee = service.apply_payment(record["schedule"], 30_000)
    rep = {"id": "crash-1", "idem": "crash-key-0001", "amount_cents": 30_000, "principal_cents": prin, "fee_cents": fee, "at": cstore.now(), "posted": False}
    updated = run(client, _force, record, {"schedule": schedule, "repayments": [rep]})
    assert updated
    assert treasury(client, owner)["ledgerCheck"] is False                          # the books visibly disagree before repair
    assert run(client, service.run_jobs)["repaired"] >= 1
    assert treasury(client, owner)["ledgerCheck"] is True
    assert run(client, service.run_jobs)["repaired"] == 0                           # and a second pass is a no-op


async def _force(record, fields_):
    return await cstore.update("credit_agreements", record["id"], fields_, expect_version=record["version"])


# -------------------------------------------------------------------------------------- tenant isolation (more)
def test_tenant_isolation_across_every_credit_read_and_write(client, owner):
    pool(client, owner)
    a, b = freelancer(client, owner, "a@example.com"), freelancer(client, owner, "b@example.com")
    app_id = client.post("/api/credit/applications", headers=a, json=APP).json()["id"]
    pdf = base64.b64encode(b"%PDF-1.4 test").decode()
    doc = client.post(f"/api/credit/applications/{app_id}/documents", headers=a, json={"label": "Brief", "contentBase64": pdf}).json()
    assert client.get(f"/api/credit/documents/{doc['id']}", headers=b).status_code == 404                      # other freelancer
    assert client.post(f"/api/credit/applications/{app_id}/documents", headers=b, json={"label": "x", "contentBase64": pdf}).status_code == 404
    assert client.delete(f"/api/credit/applications/{app_id}/documents/{doc['id']}", headers=b).status_code == 404
    assert client.post(f"/api/credit/applications/{app_id}/withdraw", headers=b).status_code == 404
    assert client.get("/api/credit/applications", headers=b).json() == [] and client.get("/api/credit/agreements", headers=b).json() == []
    inv = bearer(signup(client, email="inv9@example.com", role="investor")["token"])
    assert client.get(f"/api/credit/documents/{doc['id']}", headers=inv).status_code == 404                    # investor
    st = client.get("/api/credit/statement", headers=inv).json()
    assert st["contributions"] == [] and st["contributedCents"] == 0
    assert client.get(f"/api/credit/documents/{doc['id']}", headers=owner).status_code == 200                  # owner may, and is audited
    assert any(r["action"] == "document_viewed" for r in client.get("/api/credit/admin/audit", headers=owner).json())
