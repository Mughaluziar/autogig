"""Scheduled overdue/default processing: correct, idempotent, safe when run twice or at the same time."""
import asyncio
from datetime import timedelta

import pytest

from conftest import bearer, run, signup
from app.capital import ledger, store as cstore
from app.credit import service
from test_credit import APP, freelancer, offer, pool, treasury, key
from test_credit_concurrency import _all, funded


@pytest.fixture
def owner(client):
    return bearer(signup(client, email="owner@example.com")["token"])


def seq(client):
    return run(client, ledger.balances) and run(client, _seq)


async def _seq():
    from app.capital.ledger import _head
    return (await _head())["seq"]


def audit_actions(client, owner):
    return [a["action"] for a in client.get("/api/credit/admin/audit", headers=owner).json()]


def test_a_pass_marks_late_then_defaulted_and_a_second_pass_changes_nothing(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    funded(client, owner, fl)
    start = cstore.now()
    assert run(client, service.run_jobs, None, start + timedelta(days=31)) == {"late": 1, "defaulted": 0, "expiredOffers": 0, "repaired": 0, "reminders": 0, "withdrawalsRepaired": 0}
    assert run(client, service.run_jobs, None, start + timedelta(days=31)) == {"late": 0, "defaulted": 0, "expiredOffers": 0, "repaired": 0, "reminders": 0, "withdrawalsRepaired": 0}
    s1 = run(client, _seq)
    assert run(client, service.run_jobs, None, start + timedelta(days=95))["defaulted"] == 1
    s2 = run(client, _seq)
    assert s2 == s1 + 1                                                    # exactly one write-off entry
    assert run(client, service.run_jobs, None, start + timedelta(days=95)) == {"late": 0, "defaulted": 0, "expiredOffers": 0, "repaired": 0, "reminders": 0, "withdrawalsRepaired": 0}
    assert run(client, _seq) == s2
    t = treasury(client, owner)
    assert t["lossesCents"] == 100_000 and t["outstandingCents"] == 0 and t["ledgerCheck"]
    assert audit_actions(client, owner).count("agreement_defaulted") == 1 and audit_actions(client, owner).count("agreement_late") == 1


def test_concurrent_passes_write_off_once(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    funded(client, owner, fl)
    at = cstore.now() + timedelta(days=120)
    run(client, _all, [lambda: service.run_jobs(None, at) for _ in range(5)])
    t = treasury(client, owner)
    assert t["lossesCents"] == 100_000 and t["outstandingCents"] == 0 and t["ledgerCheck"]
    assert audit_actions(client, owner).count("agreement_defaulted") == 1


def test_a_partly_paid_agreement_only_loses_the_unpaid_principal(client, owner):
    pool(client, owner)
    fl = freelancer(client, owner)
    agr = funded(client, owner, fl)
    client.post(f"/api/credit/agreements/{agr['id']}/repay", headers=fl, json={"amountCents": 36_668, "idempotencyKey": key()})
    run(client, service.run_jobs, None, cstore.now() + timedelta(days=130))
    t = treasury(client, owner)
    assert t["lossesCents"] == 100_000 - 33_334 and t["ledgerCheck"]


def test_the_scheduled_entry_point_never_raises_and_does_the_same_work(client, owner, monkeypatch):
    pool(client, owner)
    fl = freelancer(client, owner)
    funded(client, owner, fl)
    assert run(client, service.scheduled_pass) == {"late": 0, "defaulted": 0, "expiredOffers": 0, "repaired": 0, "reminders": 0, "withdrawalsRepaired": 0}   # nothing due yet
    async def boom(*a, **k):
        raise RuntimeError("database went away")
    monkeypatch.setattr(service, "run_jobs", boom)
    assert run(client, service.scheduled_pass) is None                                                              # logged, not raised


def test_the_scheduler_is_started_with_the_app_outside_tests_and_can_be_switched_off():
    from app.config import Settings
    assert Settings().credit_jobs_runner is True
    import inspect
    from app import main
    src = inspect.getsource(main.startup)
    assert "credit_jobs_runner" in src and "scheduler_loop" in src and 'environment != "test"' in src


def test_a_bad_record_does_not_stop_the_pass(client, owner, monkeypatch):
    pool(client, owner)
    a, b = freelancer(client, owner, "a@example.com"), freelancer(client, owner, "b@example.com")
    funded(client, owner, a)
    funded(client, owner, b)
    real = service.overdue_days
    calls = {"n": 0}
    def flaky(agr, at):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("corrupt row")
        return real(agr, at)
    monkeypatch.setattr(service, "overdue_days", flaky)
    out = run(client, service.run_jobs, None, cstore.now() + timedelta(days=31))
    assert out["late"] == 1                                                    # the other agreement was still processed


@pytest.mark.parametrize("status", ["repaid", "defaulted"])
def test_terminal_agreement_ledger_is_repaired_after_interruption(client, owner, status):
    from test_credit_concurrency import _force

    pool(client, owner)
    fl = freelancer(client, owner)
    agr = funded(client, owner, fl)
    record = run(client, cstore.get, "credit_agreements", agr["id"])
    fields = {"status": status, "ledger_reconciled": False}
    if status == "repaid":
        schedule, principal, fee = service.apply_payment(record["schedule"], 110_000)
        fields.update(schedule=schedule, repayments=[{
            "id": "interrupted", "idem": "retry-after-close", "amount_cents": 110_000,
            "principal_cents": principal, "fee_cents": fee, "at": cstore.now(), "posted": False,
        }])
    else:
        fields["written_off_cents"] = 100_000
    assert run(client, _force, record, fields)
    sequence = run(client, _seq)
    assert run(client, service.run_jobs)["repaired"] == 1
    assert treasury(client, owner)["outstandingCents"] == 0 and treasury(client, owner)["ledgerCheck"]
    assert run(client, service.run_jobs)["repaired"] == 0
    if status == "repaid":
        path = f"/api/credit/agreements/{agr['id']}/repay"
        body = {"amountCents": 110_000, "idempotencyKey": "retry-after-close"}
        assert client.post(path, headers=fl, json=body).status_code == 200
        assert client.post(path, headers=fl, json={**body, "amountCents": 100}).status_code == 409
    assert run(client, _seq) == sequence + 1


def test_accepted_offer_recovers_without_an_agreement_after_interruption(client, owner, monkeypatch):
    pool(client, owner)
    fl = freelancer(client, owner)
    app_id = client.post("/api/credit/applications", headers=fl, json=APP).json()["id"]
    assert offer(client, owner, app_id).status_code == 200
    original = cstore.insert

    async def fail_agreement(coll, user_id, fields):
        if coll == "credit_agreements":
            raise RuntimeError("interrupted before writing agreement")
        return await original(coll, user_id, fields)

    with monkeypatch.context() as patch:
        patch.setattr(cstore, "insert", fail_agreement)
        assert client.post(f"/api/credit/applications/{app_id}/accept", headers=fl,
                           json={"acceptTerms": True}).status_code == 500
    assert client.post("/api/credit/applications", headers=fl, json=APP).status_code == 409
    sequence = run(client, _seq)
    assert run(client, service.run_jobs)["repaired"] == 1
    assert run(client, service.run_jobs)["repaired"] == 0
    assert len(client.get("/api/credit/agreements", headers=fl).json()) == 1
    assert run(client, _seq) == sequence + 1 and treasury(client, owner)["ledgerCheck"]


def test_pending_contribution_is_reconciled_once(client, owner):
    from conftest import signup

    account = signup(client, email="investor-pending@example.com", role="investor")
    uid = account["user"]["id"]
    headers = bearer(account["token"])
    body = {"amountCents": 20_000, "idempotencyKey": "pending-contribution", "acceptRisk": True}

    async def save_intent():
        return await cstore.insert("credit_contributions", uid, {
            "amount_cents": 20_000, "idem": body["idempotencyKey"], "ledger_seq": None, "settlement": "simulated",
        })

    intent = run(client, save_intent)
    assert client.get("/api/credit/statement", headers=headers).json()["contributedCents"] == 0
    assert run(client, service.run_jobs)["repaired"] == 1
    assert run(client, service.run_jobs)["repaired"] == 0
    response = client.post("/api/credit/contributions", headers=headers, json=body)
    assert response.status_code == 200 and response.json()["contribution"]["id"] == intent["id"]
    assert treasury(client, owner)["contributionsCents"] == 20_000
