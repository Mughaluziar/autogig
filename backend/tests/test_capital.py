"""Capital program: verification, investor pool, early payment, protection."""
from datetime import timedelta
from uuid import uuid4

import pytest

from conftest import bearer, run, signup
from app import db
from app.capital import ledger, store as cstore
from app.orders import store as order_store


def uid(client, email):
    return run(client, db.find_user, email)["id"]


def key():
    return uuid4().hex


@pytest.fixture
def owner(client):
    return bearer(signup(client, email="owner@example.com")["token"])


def verify(client, owner, headers, email, *, roles=("freelancer",), country="US"):
    body = {"legalName": "Test Person", "country": country, "roles": list(roles)}
    if "investor" in roles:
        body.update(investorBasis="net_worth", accredited=True, riskAcknowledged=True)
    assert client.post("/api/capital/verification", headers=headers, json=body).status_code == 200
    res = client.post(f"/api/capital/admin/verifications/{uid(client, email)}", headers=owner,
                      json={"approve": True})
    assert res.status_code == 200, res.text


def investor(client, owner, email="inv@example.com", deposit_cents=500_000):
    headers = bearer(signup(client, email=email, role="investor")["token"])
    verify(client, owner, headers, email, roles=("investor",))
    if deposit_cents:
        res = client.post("/api/capital/investor/deposit", headers=headers,
                          json={"amountCents": deposit_cents, "idempotencyKey": key()})
        assert res.status_code == 200, res.text
    return headers


def freelancer(client, owner, email="fl@example.com"):
    headers = bearer(signup(client, email=email)["token"])
    verify(client, owner, headers, email)
    return headers


def make_order(client, email, **overrides):
    now = cstore.now()
    fields = {
        "dedupe_key": f"upwork:{uuid4().hex[:8]}", "platform": "Upwork", "account_id": "acc-1",
        "external_order_id": uuid4().hex[:8], "kind": "contract", "title": "Dashboard build", "amount": 1000.0,
        "currency": "USD", "pricing": "fixed", "status": "active", "status_source": "api_sync",
        "verification_status": "verified", "last_synced_at": now, "data_expired": False,
        "order_created_at": now, "sort_at": now, "detected_at": now, "arrived_at": now, "milestones": [],
    }
    fields.update(overrides)
    return run(client, order_store.insert_order, uid(client, email), fields)


def platform_reports(client, email, order, status, source="api_sync", at=None):
    user_id = uid(client, email)
    current = run(client, order_store.get_order, user_id, order["id"])
    run(client, _force_order, user_id, order["id"], {"status": status, "status_source": source}, current["version"])
    event = run(client, order_store.add_event, user_id, {
        "type": "status_changed", "message": f"Status → {status}", "status": "info", "order_id": order["id"],
        "account_id": order.get("account_id"), "platform": order["platform"],
        "data": {"from": order["status"], "to": status, "source": source}})
    if at is not None:
        run(client, _backdate_event, event["id"], at)
    return event


async def _backdate_event(event_id, at):
    if db.enabled():
        await db._get_db().order_events.update_one({"_id": event_id}, {"$set": {"created_at": at}})
        return
    for e in order_store._mem["order_events"]:
        if e["id"] == event_id:
            e["created_at"] = at


async def _force_order(user_id, order_id, fields, version):
    return await order_store.update_order(user_id, order_id, fields, expect_version=version)


async def _force(coll, record_id, fields):
    current = await cstore.get(coll, record_id)
    return await cstore.update(coll, record_id, fields, expect_version=current["version"])


async def _post_yield(cents):
    await ledger.post("test_yield", [ledger.line("pool:cash", cents), ledger.line("pool:income", -cents)], memo="t")


async def _post_unbalanced():
    await ledger.post("bad", [ledger.line("pool:cash", 5)], memo="x")


async def _seed_fund(cents):
    await ledger.post("test_seed", [ledger.line("protection:cash", cents), ledger.line("protection:income", -cents)],
                      memo="test seed")


def assert_books_balance(client):
    bal = run(client, ledger.balances)
    assert sum(bal.get("USD", {}).values()) == 0
    assert sum(bal.get("SHARE", {}).values()) == 0
    assert all(e["settlement"] == "simulated" for e in run(client, ledger.entries))
    assert ledger.usd(bal, "pool:cash") >= 0 and ledger.usd(bal, "protection:cash") >= 0


# --------------------------------------------------------------------------- #
# Verification and investor gating
# --------------------------------------------------------------------------- #
def test_investing_needs_operator_verified_identity_and_attestation(client, owner):
    headers = bearer(signup(client, email="gate@example.com", role="investor")["token"])
    blocked = client.post("/api/capital/investor/deposit", headers=headers,
                          json={"amountCents": 100_00, "idempotencyKey": key()})
    assert blocked.status_code == 403 and blocked.json()["reasons"]

    missing_ack = client.post("/api/capital/verification", headers=headers, json={
        "legalName": "Gate Keeper", "country": "US", "roles": ["investor"], "investorBasis": "income",
        "accredited": True, "riskAcknowledged": False})
    assert missing_ack.status_code == 422

    client.post("/api/capital/verification", headers=headers, json={
        "legalName": "Gate Keeper", "country": "US", "roles": ["investor"], "investorBasis": "income",
        "accredited": True, "riskAcknowledged": True})
    profile = client.get("/api/capital/overview", headers=headers).json()["profile"]
    assert profile["kyc"]["status"] == "pending"
    # Users can't approve themselves.
    assert client.post(f"/api/capital/admin/verifications/{uid(client, 'gate@example.com')}", headers=headers,
                       json={"approve": True}).status_code == 403
    assert client.get("/api/capital/admin/verifications", headers=owner).json()[0]["kyc"]["legalName"] == "Gate Keeper"
    client.post(f"/api/capital/admin/verifications/{uid(client, 'gate@example.com')}", headers=owner, json={"approve": True})
    ok = client.post("/api/capital/investor/deposit", headers=headers, json={"amountCents": 100_00, "idempotencyKey": key()})
    assert ok.status_code == 200 and ok.json()["entry"]["settlement"] == "simulated"


def test_jurisdiction_allowlist_blocks_investors_elsewhere(client, owner, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "capital_investor_jurisdictions", "GB,SG")
    headers = bearer(signup(client, email="us-inv@example.com", role="investor")["token"])
    verify(client, owner, headers, "us-inv@example.com", roles=("investor",), country="US")
    res = client.post("/api/capital/investor/deposit", headers=headers, json={"amountCents": 100_00, "idempotencyKey": key()})
    assert res.status_code == 403 and any("country" in r for r in res.json()["reasons"])


def test_deposits_are_idempotent_and_shares_are_priced_at_nav(client, owner):
    a = investor(client, owner, "a@example.com", deposit_cents=0)
    idem = key()
    for _ in range(2):
        client.post("/api/capital/investor/deposit", headers=a, json={"amountCents": 1_000_00, "idempotencyKey": idem})
    assert client.get("/api/capital/investor", headers=a).json()["depositedCents"] == 1_000_00

    # Yield lands in the pool: NAV per share rises; a later investor pays the new price.
    run(client, _post_yield, 100_00)
    b = investor(client, owner, "b@example.com", deposit_cents=1_100_00)
    pa = client.get("/api/capital/investor", headers=a).json()
    pb = client.get("/api/capital/investor", headers=b).json()
    assert pa["valueCents"] == 1_100_00 and pa["gainCents"] == 100_00
    assert pb["valueCents"] in (1_099_99, 1_100_00) and pb["shares"] == pytest.approx(pa["shares"], rel=1e-6)
    assert client.get("/api/capital/pool", headers=a).json()["sharePriceCents"] == 110
    assert_books_balance(client)


# --------------------------------------------------------------------------- #
# Early payment
# --------------------------------------------------------------------------- #
def test_underwriting_only_accepts_fresh_fixed_price_api_verified_usd_orders(client, owner):
    investor(client, owner)
    fl = freelancer(client, owner)
    good = make_order(client, "fl@example.com")
    make_order(client, "fl@example.com", pricing="hourly", amount=60.0, title="Hourly")
    make_order(client, "fl@example.com", last_synced_at=cstore.now() - timedelta(hours=30), title="Stale")
    make_order(client, "fl@example.com", currency="EUR", title="Euro")
    make_order(client, "fl@example.com", verification_status="unverifiable", platform="Fiverr", title="Email only")
    rows = {r["order"]["title"]: r["underwriting"] for r in client.get("/api/capital/early-pay/orders", headers=fl).json()}
    assert "Email only" not in rows  # only API-verified orders are listed
    assert rows["Dashboard build"]["eligible"] and rows["Dashboard build"]["maxPrincipalCents"] == 700_00
    assert any("hourly" in r for r in rows["Hourly"]["reasons"])
    assert any("24 hours" in r for r in rows["Stale"]["reasons"])
    assert any("USD" in r for r in rows["Euro"]["reasons"])

    unverified = bearer(signup(client, email="nokyc@example.com")["token"])
    order = make_order(client, "nokyc@example.com")
    res = client.post("/api/capital/advances/quote", headers=unverified, json={"orderId": order["id"]})
    assert res.status_code == 422 and any("identity" in r for r in res.json()["reasons"])
    assert good["id"]


def test_advance_lifecycle_disburse_repay_and_fee_split(client, owner):
    inv = investor(client, owner, deposit_cents=10_000_00)
    fl = freelancer(client, owner)
    order = make_order(client, "fl@example.com")
    quote = client.post("/api/capital/advances/quote", headers=fl, json={"orderId": order["id"], "principalCents": 500_00}).json()
    assert quote["status"] == "quoted" and quote["feeCents"] == 15_00 and quote["settlement"] == "simulated"
    assert client.post(f"/api/capital/advances/{quote['id']}/accept", headers=fl, json={}).status_code == 422
    adv = client.post(f"/api/capital/advances/{quote['id']}/accept", headers=fl, json={"acceptTerms": True}).json()
    assert adv["status"] == "active" and adv["totalDueCents"] == 515_00 and adv["coverageId"]
    # One open early payment per order.
    again = client.post("/api/capital/advances/quote", headers=fl, json={"orderId": order["id"]})
    assert again.status_code == 422 and any("already" in r for r in again.json()["reasons"])
    second_quote_rows = client.get("/api/capital/early-pay/orders", headers=fl).json()
    assert not second_quote_rows[0]["underwriting"]["eligible"]

    pool = client.get("/api/capital/pool", headers=fl).json()
    assert pool["outstandingCents"] == 500_00 and pool["cashCents"] == 9_500_00
    assert client.post(f"/api/capital/advances/{adv['id']}/repay", headers=fl, json={"amountCents": 600_00}).status_code == 422
    part = client.post(f"/api/capital/advances/{adv['id']}/repay", headers=fl, json={"amountCents": 300_00}).json()
    assert part["status"] == "active" and part["principalDueCents"] == 200_00 and part["feeDueCents"] == 15_00
    done = client.post(f"/api/capital/advances/{adv['id']}/repay", headers=fl, json={"amountCents": 215_00}).json()
    assert done["status"] == "repaid" and done["totalDueCents"] == 0

    pool = client.get("/api/capital/pool", headers=fl).json()
    # 3% fee of $15: $10.50 to investors, $3.00 to protection, $1.50 to the platform.
    assert pool["realisedYieldCents"] == 10_50 and pool["protectionFundCents"] == 3_00
    assert pool["navCents"] == 10_010_50 and pool["outstandingCents"] == 0
    assert client.get("/api/capital/investor", headers=inv).json()["gainCents"] == 10_50
    assert_books_balance(client)


def test_liquidity_reserve_and_exposure_limits(client, owner):
    investor(client, owner, deposit_cents=300_00)  # $30 reserve, $270 lendable
    fl = freelancer(client, owner)
    order = make_order(client, "fl@example.com", amount=2000.0)
    row = client.get("/api/capital/early-pay/orders", headers=fl).json()[0]["underwriting"]
    assert row["maxPrincipalCents"] == 270_00
    # Investors can still withdraw all cash; advances can't touch the reserve.
    quote = client.post("/api/capital/advances/quote", headers=fl, json={"orderId": order["id"]}).json()
    client.post(f"/api/capital/advances/{quote['id']}/accept", headers=fl, json={"acceptTerms": True})
    other = make_order(client, "fl@example.com", amount=500.0, title="Second")
    second = client.post("/api/capital/advances/quote", headers=fl, json={"orderId": other["id"]})
    assert second.status_code == 422 and any("capital" in r for r in second.json()["reasons"])


def test_withdrawals_are_limited_to_uncommitted_cash(client, owner):
    inv = investor(client, owner, deposit_cents=1_000_00)
    fl = freelancer(client, owner)
    order = make_order(client, "fl@example.com")
    quote = client.post("/api/capital/advances/quote", headers=fl, json={"orderId": order["id"]}).json()
    client.post(f"/api/capital/advances/{quote['id']}/accept", headers=fl, json={"acceptTerms": True})
    too_much = client.post("/api/capital/investor/withdraw", headers=inv, json={"all": True, "idempotencyKey": key()})
    assert too_much.status_code == 409 and "early payments" in too_much.json()["detail"]
    ok = client.post("/api/capital/investor/withdraw", headers=inv, json={"amountCents": 300_00, "idempotencyKey": key()})
    assert ok.status_code == 200 and ok.json()["position"]["valueCents"] == 700_00
    assert_books_balance(client)


# --------------------------------------------------------------------------- #
# Protection fund
# --------------------------------------------------------------------------- #
def _active_advance(client, owner):
    investor(client, owner, deposit_cents=10_000_00)
    fl = freelancer(client, owner)
    order = make_order(client, "fl@example.com")
    quote = client.post("/api/capital/advances/quote", headers=fl, json={"orderId": order["id"], "principalCents": 500_00}).json()
    adv = client.post(f"/api/capital/advances/{quote['id']}/accept", headers=fl, json={"acceptTerms": True}).json()
    return fl, order, adv


def test_platform_reported_cancellation_opens_a_claim_that_settles_the_advance(client, owner):
    fl, order, adv = _active_advance(client, owner)
    run(client, _seed_fund, 1_000_00)
    platform_reports(client, "fl@example.com", order, "cancelled")
    assert run(client, __import__("app.capital.service", fromlist=["run_jobs"]).run_jobs)["claimsOpened"] == 1
    claims = client.get("/api/capital/admin/claims", headers=owner).json()
    assert claims[0]["status"] == "eligible" and claims[0]["amountCents"] == 500_00
    # Freelancers can't approve their own claims.
    assert client.post(f"/api/capital/admin/claims/{claims[0]['id']}", headers=fl, json={"approve": True}).status_code == 403
    paid = client.post(f"/api/capital/admin/claims/{claims[0]['id']}", headers=owner, json={"approve": True}).json()
    assert paid["status"] == "paid" and paid["paidCents"] == 500_00
    advance = client.get("/api/capital/advances", headers=fl).json()[0]
    assert advance["status"] == "covered" and advance["totalDueCents"] == 0 and advance["feeWaivedCents"] == 15_00
    pool = client.get("/api/capital/pool", headers=fl).json()
    assert pool["outstandingCents"] == 0 and pool["protectionFundCents"] == 500_00 and pool["writtenOffCents"] == 0
    assert_books_balance(client)


def test_claims_ignore_email_reports_and_losses_before_cover(client, owner):
    fl, order, adv = _active_advance(client, owner)
    platform_reports(client, "fl@example.com", order, "cancelled", source="email")
    res = client.post(f"/api/capital/coverages/{adv['coverageId']}/claim", headers=fl).json()
    assert res["status"] == "ineligible"

    old = make_order(client, "fl@example.com", title="Old")
    platform_reports(client, "fl@example.com", old, "cancelled", at=cstore.now() - timedelta(days=1))
    run(client, _force_order, uid(client, "fl@example.com"), old["id"], {"status": "active"},
        run(client, order_store.get_order, uid(client, "fl@example.com"), old["id"])["version"])
    cover = client.post("/api/capital/coverages", headers=fl, json={"orderId": old["id"], "acceptTerms": True}).json()
    assert cover["coveredCents"] == 800_00 and cover["premiumCents"] == 32_00
    assert client.post(f"/api/capital/coverages/{cover['id']}/claim", headers=fl).json()["status"] == "ineligible"


# --------------------------------------------------------------------------- #
# New-order protection window
# --------------------------------------------------------------------------- #
def test_cover_can_only_be_bought_within_24_hours_of_an_order_arriving(client, owner):
    fl = freelancer(client, owner)
    late = make_order(client, "fl@example.com", title="Late", arrived_at=cstore.now() - timedelta(hours=25))
    imported = make_order(client, "fl@example.com", title="Imported", arrived_at=None)
    fresh = make_order(client, "fl@example.com", title="Fresh", arrived_at=cstore.now() - timedelta(hours=23))
    for order, phrase in ((late, "closed at"), (imported, "imported")):
        res = client.post("/api/capital/coverages", headers=fl, json={"orderId": order["id"], "acceptTerms": True})
        assert res.status_code == 422 and any(phrase in r for r in res.json()["reasons"]), res.text
    res = client.post("/api/capital/coverages", headers=fl, json={"orderId": fresh["id"], "acceptTerms": True})
    assert res.status_code == 200, res.text
    rows = {r["order"]["title"]: r for r in client.get("/api/capital/early-pay/orders", headers=fl).json()}
    assert rows["Imported"]["coverClosesAt"] is None and rows["Late"]["coverClosesAt"]
    assert_books_balance(client)


def test_new_orders_are_offered_cover_until_bought_dismissed_or_expired(client, owner):
    fl = freelancer(client, owner)
    soon = make_order(client, "fl@example.com", title="Closing soon", arrived_at=cstore.now() - timedelta(hours=22))
    make_order(client, "fl@example.com", title="Just in", amount=100_000.0)
    make_order(client, "fl@example.com", title="Fiverr gig", platform="Fiverr", verification_status="unverifiable",
               status_source="email", pricing=None)
    make_order(client, "fl@example.com", title="Checking", verification_status="pending")
    make_order(client, "fl@example.com", title="Old", arrived_at=cstore.now() - timedelta(hours=30))
    make_order(client, "fl@example.com", title="Backfilled", arrived_at=None)
    make_order(client, "fl@example.com", title="Cancelled", status="cancelled")

    offers = client.get("/api/capital/coverages/offers", headers=fl).json()
    assert [o["order"]["title"] for o in offers][0] == "Closing soon"  # most urgent first
    by_title = {o["order"]["title"]: o for o in offers}
    assert set(by_title) == {"Closing soon", "Just in", "Fiverr gig"}
    assert by_title["Closing soon"]["eligible"] and by_title["Closing soon"]["maxCoverCents"] == 800_00
    assert by_title["Closing soon"]["premiumCents"] == 32_00 and by_title["Closing soon"]["identityVerified"]
    assert by_title["Just in"]["maxCoverCents"] == 2_000_00  # capped
    fiverr = by_title["Fiverr gig"]
    assert not fiverr["eligible"] and fiverr["maxCoverCents"] == 0
    assert any("no order API" in r for r in fiverr["reasons"])

    assert client.post("/api/capital/coverages", headers=fl,
                       json={"orderId": soon["id"], "acceptTerms": True}).status_code == 200
    res = client.post(f"/api/capital/coverages/offers/{fiverr['order']['id']}/dismiss", headers=fl)
    assert res.status_code == 200
    client.post(f"/api/capital/coverages/offers/{fiverr['order']['id']}/dismiss", headers=fl)  # idempotent
    assert [o["order"]["title"] for o in client.get("/api/capital/coverages/offers", headers=fl).json()] == ["Just in"]

    # Offers are private, and an unverified identity is reported, not hidden.
    other = bearer(signup(client, email="other@example.com")["token"])
    assert client.get("/api/capital/coverages/offers", headers=other).json() == []
    assert client.post(f"/api/capital/coverages/offers/{soon['id']}/dismiss", headers=other).status_code == 404
    make_order(client, "other@example.com", title="Mine")
    mine = client.get("/api/capital/coverages/offers", headers=other).json()
    assert mine[0]["eligible"] and not mine[0]["identityVerified"]


def test_claim_payouts_are_capped_at_the_fund_balance(client, owner):
    fl, order, adv = _active_advance(client, owner)
    run(client, _seed_fund, 200_00)
    platform_reports(client, "fl@example.com", order, "refunded")
    claim = client.post(f"/api/capital/coverages/{adv['coverageId']}/claim", headers=fl).json()
    paid = client.post(f"/api/capital/admin/claims/{claim['id']}", headers=owner, json={"approve": True}).json()
    assert paid["paidCents"] == 200_00 and paid["shortfallCents"] == 300_00
    advance = client.get("/api/capital/advances", headers=fl).json()[0]
    assert advance["status"] == "active" and advance["principalDueCents"] == 300_00
    assert_books_balance(client)


# --------------------------------------------------------------------------- #
# Default, write-off, recovery
# --------------------------------------------------------------------------- #
def test_unpaid_advance_defaults_after_grace_and_recoveries_restore_nav(client, owner):
    from app.capital import service
    fl, order, adv = _active_advance(client, owner)
    run(client, _force, "capital_advances", adv["id"], {"due_at": cstore.now() - timedelta(days=16)})
    result = run(client, service.run_jobs)
    assert result["overdue"] == 1 and result["defaulted"] == 1
    pool = client.get("/api/capital/pool", headers=fl).json()
    assert pool["writtenOffCents"] == 500_00 and pool["navCents"] == 9_500_00
    # In default: no new advances.
    other = make_order(client, "fl@example.com", title="Next")
    res = client.post("/api/capital/advances/quote", headers=fl, json={"orderId": other["id"]})
    assert res.status_code == 422 and any("default" in r for r in res.json()["reasons"])
    # A late repayment is a recovery.
    done = client.post(f"/api/capital/advances/{adv['id']}/repay", headers=fl, json={"amountCents": 515_00}).json()
    assert done["status"] == "repaid"
    pool = client.get("/api/capital/pool", headers=fl).json()
    assert pool["writtenOffCents"] == 0 and pool["navCents"] == 10_010_50
    assert_books_balance(client)


def test_a_live_claim_holds_off_the_write_off(client, owner):
    from app.capital import service
    fl, order, adv = _active_advance(client, owner)
    platform_reports(client, "fl@example.com", order, "cancelled")
    run(client, _force, "capital_advances", adv["id"], {"due_at": cstore.now() - timedelta(days=20)})
    result = run(client, service.run_jobs)
    assert result["claimsOpened"] == 1 and result["defaulted"] == 0


def test_ledger_rejects_unbalanced_and_float_entries(client):
    with pytest.raises(ValueError):
        run(client, _post_unbalanced)
    with pytest.raises(TypeError):
        ledger.line("pool:cash", 1.5)


def test_operator_endpoints_are_owner_only(client):
    user = bearer(signup(client, email="nobody@example.com")["token"])
    for method, path in (("get", "/api/capital/admin/verifications"), ("get", "/api/capital/admin/claims"),
                         ("post", "/api/capital/admin/run-jobs"), ("get", "/api/capital/admin/journal")):
        assert getattr(client, method)(path, headers=user).status_code == 403
