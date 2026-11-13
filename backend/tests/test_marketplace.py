"""Investment marketplace and banking: balances, transfers, raises, investing,
the Platform Index, repayments, revenue sharing, refunds and financing.
Everything is simulated settlement; the books must balance after each flow."""
from datetime import timedelta

from conftest import bearer, run, signup
from app.capital import ledger, market, service, store as cstore
from test_capital import (  # noqa: F401  (owner is a fixture)
    _force, assert_books_balance, freelancer, key, make_order, owner, uid, verify,
)

ROUTING = "021000021"  # valid ABA checksum


def fund_wallet(client, headers, cents):
    acct = client.post("/api/banking/accounts", headers=headers, json={
        "holder": "Test Person", "routing": ROUTING, "accountNumber": "000123456789", "kind": "checking"})
    assert acct.status_code == 200, acct.text
    acct = acct.json()
    if acct["status"] != "verified":
        res = client.post(f"/api/banking/accounts/{acct['id']}/verify", headers=headers,
                          json={"amounts": acct["simulatedDeposits"]})
        assert res.status_code == 200, res.text
    res = client.post("/api/banking/transfers", headers=headers, json={
        "kind": "deposit", "amountCents": cents, "idempotencyKey": key(), "bankAccountId": acct["id"]})
    assert res.status_code == 200, res.text
    return acct


def verified_investor(client, owner, email, wallet_cents=0):
    headers = bearer(signup(client, email=email, role="investor")["token"])
    verify(client, owner, headers, email, roles=("investor",))
    if wallet_cents:
        fund_wallet(client, headers, wallet_cents)
    return headers


def seed_orders(client, email, n, amount, platform="Upwork", status="completed"):
    for _ in range(n):
        make_order(client, email, status=status, amount=amount, platform=platform)


def raise_body(**over):
    body = {"kind": "project_funding", "title": "Hire two React developers", "summary": "Scale delivery.",
            "targetCents": 2_000_00, "minInvestmentCents": 50_00, "termMonths": 3,
            "uses": [{"category": "hiring", "amountCents": 2_000_00}], "publish": True}
    body.update(over)
    if "uses" not in over:
        body["uses"] = [{"category": "hiring", "amountCents": body["targetCents"]}]
    return body


def balances(client, headers):
    return client.get("/api/banking/overview", headers=headers).json()["balances"]


# --------------------------------------------------------------------------- #
# Banking
# --------------------------------------------------------------------------- #
def test_bank_account_linking_validates_and_verifies_micro_deposits(client):
    headers = bearer(signup(client, email="bank@example.com")["token"])
    bad = client.post("/api/banking/accounts", headers=headers, json={
        "holder": "Test Person", "routing": "123456789", "accountNumber": "12345678"})
    assert bad.status_code == 422
    acct = client.post("/api/banking/accounts", headers=headers, json={
        "holder": "Test Person", "routing": ROUTING, "accountNumber": "000123456789", "nickname": "Ops"}).json()
    assert acct["last4"] == "6789" and acct["status"] == "pending" and "routing" not in acct
    assert "accountNumber" not in acct and len(acct["simulatedDeposits"]) == 2
    wrong = client.post(f"/api/banking/accounts/{acct['id']}/verify", headers=headers, json={"amounts": [0, 0]})
    assert wrong.status_code == 422 and "attempts" in wrong.json()["detail"]
    blocked = client.post("/api/banking/transfers", headers=headers, json={
        "kind": "deposit", "amountCents": 100_00, "idempotencyKey": key(), "bankAccountId": acct["id"]})
    assert blocked.status_code == 409
    ok = client.post(f"/api/banking/accounts/{acct['id']}/verify", headers=headers,
                     json={"amounts": list(reversed(acct["simulatedDeposits"]))})
    assert ok.json()["status"] == "verified" and "simulatedDeposits" not in ok.json()
    dup = client.post("/api/banking/accounts", headers=headers, json={
        "holder": "Test Person", "routing": ROUTING, "accountNumber": "999123456789"})
    assert dup.status_code == 409


def test_transfers_move_balances_and_statement_adds_up(client):
    headers = bearer(signup(client, email="xfer@example.com")["token"])
    acct = fund_wallet(client, headers, 1_000_00)
    assert balances(client, headers) == {"usdCents": 1_000_00, "usdcCents": 0}

    k = key()
    first = client.post("/api/banking/transfers", headers=headers,
                        json={"kind": "to_usdc", "amountCents": 400_00, "idempotencyKey": k})
    again = client.post("/api/banking/transfers", headers=headers,
                        json={"kind": "to_usdc", "amountCents": 400_00, "idempotencyKey": k})
    assert first.json()["transfer"]["id"] == again.json()["transfer"]["id"]
    assert balances(client, headers) == {"usdCents": 600_00, "usdcCents": 400_00}

    bad_addr = client.post("/api/banking/transfers", headers=headers, json={
        "kind": "crypto_send", "amountCents": 100_00, "idempotencyKey": key(), "address": "not-an-address"})
    assert bad_addr.status_code == 422
    sent = client.post("/api/banking/transfers", headers=headers, json={
        "kind": "crypto_send", "amountCents": 100_00, "idempotencyKey": key(), "address": "0x" + "ab" * 20})
    assert sent.status_code == 200 and sent.json()["transfer"]["network"]
    too_much = client.post("/api/banking/transfers", headers=headers, json={
        "kind": "withdraw", "amountCents": 700_00, "idempotencyKey": key(), "bankAccountId": acct["id"]})
    assert too_much.status_code == 409
    client.post("/api/banking/transfers", headers=headers, json={
        "kind": "withdraw", "amountCents": 100_00, "idempotencyKey": key(), "bankAccountId": acct["id"]})
    assert balances(client, headers) == {"usdCents": 500_00, "usdcCents": 300_00}

    month = cstore.now().strftime("%Y-%m")
    st = client.get(f"/api/banking/statements?month={month}", headers=headers).json()
    assert st["openingCents"] == {"usd": 0, "usdc": 0}
    assert st["closingCents"] == {"usd": 500_00, "usdc": 300_00}
    assert [r["kind"] for r in st["rows"]][0] == "bank_deposit"
    assert client.get("/api/banking/statements?month=2026-13", headers=headers).status_code == 422
    failed = [t for t in client.get("/api/banking/transfers", headers=headers).json() if t["status"] == "failed"]
    assert len(failed) == 1
    assert_books_balance(client)


def test_balances_are_private_to_each_user(client):
    a = bearer(signup(client, email="a@example.com")["token"])
    b = bearer(signup(client, email="b@example.com")["token"])
    acct = fund_wallet(client, a, 200_00)
    assert balances(client, b) == {"usdCents": 0, "usdcCents": 0}
    assert client.post(f"/api/banking/accounts/{acct['id']}/verify", headers=b, json={"amounts": [1, 2]}).status_code == 404
    res = client.post("/api/banking/transfers", headers=b, json={
        "kind": "withdraw", "amountCents": 10_00, "idempotencyKey": key(), "bankAccountId": acct["id"]})
    assert res.status_code == 404


# --------------------------------------------------------------------------- #
# Raises and investing
# --------------------------------------------------------------------------- #
def test_publishing_a_raise_needs_identity_and_a_verified_track_record(client, owner):
    headers = bearer(signup(client, email="new@example.com")["token"])
    draft = client.post("/api/marketplace/listings", headers=headers, json=raise_body(publish=False))
    assert draft.status_code == 200 and draft.json()["status"] == "draft" and draft.json()["grade"] == "E"
    blocked = client.post(f"/api/marketplace/listings/{draft.json()['id']}/publish", headers=headers)
    assert blocked.status_code == 422 and len(blocked.json()["reasons"]) == 2
    # Drafts are private.
    other = bearer(signup(client, email="peek@example.com")["token"])
    assert client.get(f"/api/marketplace/listings/{draft.json()['id']}", headers=other).status_code == 404
    assert client.get("/api/marketplace/listings", headers=other).json() == []

    verify(client, owner, headers, "new@example.com")
    seed_orders(client, "new@example.com", 1, 1000.0)
    ok = client.post(f"/api/marketplace/listings/{draft.json()['id']}/publish", headers=headers)
    assert ok.status_code == 200 and ok.json()["status"] == "open"
    assert ok.json()["grade"] == "C" and ok.json()["rateBps"] == market.PROJECT_RATE_BPS["C"]
    assert client.post("/api/marketplace/listings", headers=headers, json=raise_body()).status_code == 409
    too_big = client.post("/api/marketplace/listings", headers=other, json=raise_body(targetCents=10_000_01))
    assert too_big.status_code == 422


def test_project_funding_end_to_end(client, owner):
    biz = freelancer(client, owner, email="agency@example.com")
    seed_orders(client, "agency@example.com", 6, 2000.0)
    listing = client.post("/api/marketplace/listings", headers=biz, json=raise_body()).json()
    assert listing["grade"] == "B"

    unverified = bearer(signup(client, email="nobody@example.com", role="investor")["token"])
    res = client.post(f"/api/marketplace/listings/{listing['id']}/invest", headers=unverified,
                      json={"amountCents": 100_00, "idempotencyKey": key(), "acceptRisk": True})
    assert res.status_code == 403 and res.json()["reasons"]

    inv1 = verified_investor(client, owner, "i1@example.com", 5_000_00)
    inv2 = verified_investor(client, owner, "i2@example.com", 5_000_00)
    no_risk = client.post(f"/api/marketplace/listings/{listing['id']}/invest", headers=inv1,
                          json={"amountCents": 1_500_00, "idempotencyKey": key()})
    assert no_risk.status_code == 422
    own = client.post(f"/api/marketplace/listings/{listing['id']}/invest", headers=biz,
                      json={"amountCents": 100_00, "idempotencyKey": key(), "acceptRisk": True})
    assert own.status_code == 403
    k = key()
    a = client.post(f"/api/marketplace/listings/{listing['id']}/invest", headers=inv1,
                    json={"amountCents": 1_500_00, "idempotencyKey": k, "acceptRisk": True})
    assert a.status_code == 200 and a.json()["investment"]["status"] == "escrow"
    replay = client.post(f"/api/marketplace/listings/{listing['id']}/invest", headers=inv1,
                         json={"amountCents": 1_500_00, "idempotencyKey": k, "acceptRisk": True})
    assert replay.json()["investment"]["id"] == a.json()["investment"]["id"]
    over = client.post(f"/api/marketplace/listings/{listing['id']}/invest", headers=inv2,
                       json={"amountCents": 600_00, "idempotencyKey": key(), "acceptRisk": True})
    assert over.status_code == 409 and "left to raise" in over.json()["detail"]
    detail = client.get(f"/api/marketplace/listings/{listing['id']}", headers=inv2).json()
    assert detail["raisedCents"] == 1_500_00 and detail["remainingCents"] == 500_00

    last = client.post(f"/api/marketplace/listings/{listing['id']}/invest", headers=inv2,
                       json={"amountCents": 500_00, "idempotencyKey": key(), "acceptRisk": True})
    assert last.status_code == 200
    funded = client.get(f"/api/marketplace/listings/{listing['id']}", headers=biz).json()
    assert funded["status"] == "active" and funded["fundedCents"] == 2_000_00
    fee = 2_000_00 * market.ORIGINATION_FEE_BPS // 10_000
    assert balances(client, biz)["usdCents"] == 2_000_00 - fee

    agreement = client.get(f"/api/marketplace/agreements/{funded['agreementId']}", headers=biz).json()
    total = 2_000_00 + 2_000_00 * market.PROJECT_RATE_BPS["B"] // 10_000
    assert agreement["totalDueCents"] == total and len(agreement["schedule"]) == 3
    assert sum(s["amountCents"] for s in agreement["schedule"]) == total
    stranger = bearer(signup(client, email="stranger@example.com")["token"])
    assert client.get(f"/api/marketplace/agreements/{agreement['id']}", headers=stranger).status_code == 404
    as_investor = client.get(f"/api/marketplace/agreements/{agreement['id']}", headers=inv1).json()
    assert as_investor["role"] == "investor" and as_investor["myShare"]["shareBps"] == 7_500

    # The business needs more than the disbursed amount to repay everything.
    fund_wallet(client, biz, 500_00)
    over_pay = client.post(f"/api/marketplace/agreements/{agreement['id']}/pay", headers=biz,
                           json={"amountCents": total + 1, "idempotencyKey": key()})
    assert over_pay.status_code == 422
    first = agreement["schedule"][0]["amountCents"]
    paid = client.post(f"/api/marketplace/agreements/{agreement['id']}/pay", headers=biz,
                       json={"amountCents": first, "idempotencyKey": key()}).json()["agreement"]
    assert paid["paidCents"] == first and paid["schedule"][0]["status"] == "paid"
    folio1 = client.get("/api/marketplace/portfolio", headers=inv1).json()
    folio2 = client.get("/api/marketplace/portfolio", headers=inv2).json()
    assert folio1["totals"]["distributedCents"] + folio2["totals"]["distributedCents"] == first
    assert abs(folio1["totals"]["distributedCents"] - first * 3 // 4) <= 1

    rest = total - first
    done = client.post(f"/api/marketplace/agreements/{agreement['id']}/pay", headers=biz,
                       json={"amountCents": rest, "idempotencyKey": key()}).json()["agreement"]
    assert done["status"] == "completed"
    folio1 = client.get("/api/marketplace/portfolio", headers=inv1).json()
    assert folio1["positions"][0]["investment"]["status"] == "completed"
    assert folio1["totals"]["distributedCents"] + client.get(
        "/api/marketplace/portfolio", headers=inv2).json()["totals"]["distributedCents"] == total
    assert balances(client, inv1)["usdCents"] == 5_000_00 - 1_500_00 + folio1["totals"]["distributedCents"]

    # Read endpoints: lists, my raises, track record, banking overview.
    assert client.get("/api/marketplace/listings", headers=inv1).json() == []
    funded_rows = client.get("/api/marketplace/listings?include=funded", headers=inv1).json()
    assert [r["id"] for r in funded_rows] == [listing["id"]] and funded_rows[0]["status"] == "completed"
    assert client.get("/api/marketplace/agreements", headers=biz).json()["borrower"][0]["role"] == "borrower"
    assert client.get("/api/marketplace/agreements", headers=inv1).json()["investor"][0]["myShare"]["investedCents"] == 1_500_00
    assert client.get("/api/marketplace/my-listings", headers=biz).json()[0]["mine"] is True
    record = client.get("/api/marketplace/track-record", headers=biz).json()
    assert record["grade"] == "B" and record["kycStatus"] == "verified"
    overview = client.get("/api/banking/overview", headers=inv1).json()
    assert overview["marketplace"]["distributedCents"] == folio1["totals"]["distributedCents"]
    assert "micro_deposits" not in str(overview) and "user_id" not in str(overview)
    assert_books_balance(client)


def test_insufficient_balance_and_payment_rollback(client, owner):
    biz = freelancer(client, owner, email="biz2@example.com")
    seed_orders(client, "biz2@example.com", 6, 2000.0)
    listing = client.post("/api/marketplace/listings", headers=biz, json=raise_body(targetCents=1_000_00)).json()
    poor = verified_investor(client, owner, "poor@example.com", 50_00)
    res = client.post(f"/api/marketplace/listings/{listing['id']}/invest", headers=poor,
                      json={"amountCents": 100_00, "idempotencyKey": key(), "acceptRisk": True})
    assert res.status_code == 409 and "Banking" in res.json()["detail"]
    rich = verified_investor(client, owner, "rich@example.com", 2_000_00)
    client.post(f"/api/marketplace/listings/{listing['id']}/invest", headers=rich,
                json={"amountCents": 1_000_00, "idempotencyKey": key(), "acceptRisk": True})
    agreement_id = client.get(f"/api/marketplace/listings/{listing['id']}", headers=biz).json()["agreementId"]
    # Spend the funds so the repayment can't be covered.
    client.post("/api/banking/transfers", headers=biz, json={"kind": "to_usdc", "amountCents": 980_00,
                                                            "idempotencyKey": key()})
    res = client.post(f"/api/marketplace/agreements/{agreement_id}/pay", headers=biz,
                      json={"amountCents": 100_00, "idempotencyKey": key()})
    assert res.status_code == 409
    assert client.get(f"/api/marketplace/agreements/{agreement_id}", headers=biz).json()["payments"] == []
    assert_books_balance(client)


def test_closing_early_accepts_at_half_and_refunds_below(client, owner):
    biz = freelancer(client, owner, email="close@example.com")
    seed_orders(client, "close@example.com", 6, 2000.0)
    inv = verified_investor(client, owner, "ci@example.com", 3_000_00)
    low = client.post("/api/marketplace/listings", headers=biz, json=raise_body()).json()
    client.post(f"/api/marketplace/listings/{low['id']}/invest", headers=inv,
                json={"amountCents": 500_00, "idempotencyKey": key(), "acceptRisk": True})
    closed = client.post(f"/api/marketplace/listings/{low['id']}/close", headers=biz).json()
    assert closed["status"] == "cancelled"
    assert balances(client, inv)["usdCents"] == 3_000_00
    folio = client.get("/api/marketplace/portfolio", headers=inv).json()
    assert folio["positions"][0]["investment"]["status"] == "refunded"

    half = client.post("/api/marketplace/listings", headers=biz, json=raise_body()).json()
    client.post(f"/api/marketplace/listings/{half['id']}/invest", headers=inv,
                json={"amountCents": 1_000_00, "idempotencyKey": key(), "acceptRisk": True})
    accepted = client.post(f"/api/marketplace/listings/{half['id']}/close", headers=biz).json()
    assert accepted["status"] == "active" and accepted["fundedCents"] == 1_000_00
    assert_books_balance(client)


def test_jobs_expire_unfunded_raises_and_default_late_agreements(client, owner):
    biz = freelancer(client, owner, email="late@example.com")
    seed_orders(client, "late@example.com", 6, 2000.0)
    inv = verified_investor(client, owner, "li@example.com", 3_000_00)
    listing = client.post("/api/marketplace/listings", headers=biz, json=raise_body()).json()
    client.post(f"/api/marketplace/listings/{listing['id']}/invest", headers=inv,
                json={"amountCents": 200_00, "idempotencyKey": key(), "acceptRisk": True})
    run(client, _force, "market_listings", listing["id"], {"closes_at": cstore.now() - timedelta(minutes=1)})
    counts = run(client, service.run_jobs)
    assert counts["raisesExpired"] == 1
    assert client.get(f"/api/marketplace/listings/{listing['id']}", headers=biz).json()["status"] == "expired"
    assert balances(client, inv)["usdCents"] == 3_000_00

    funded = client.post("/api/marketplace/listings", headers=biz, json=raise_body(targetCents=1_000_00)).json()
    client.post(f"/api/marketplace/listings/{funded['id']}/invest", headers=inv,
                json={"amountCents": 1_000_00, "idempotencyKey": key(), "acceptRisk": True})
    agreement_id = client.get(f"/api/marketplace/listings/{funded['id']}", headers=biz).json()["agreementId"]
    agreement = run(client, cstore.get, "market_agreements", agreement_id)
    past = cstore.now() - timedelta(days=5)
    run(client, _force, "market_agreements", agreement_id,
        {"schedule": [{**s, "due_at": past} for s in agreement["schedule"]]})
    assert run(client, market.run_jobs)["agreementsLate"] == 1
    long_ago = cstore.now() - timedelta(days=market.DEFAULT_AFTER_DAYS + 1)
    agreement = run(client, cstore.get, "market_agreements", agreement_id)
    run(client, _force, "market_agreements", agreement_id,
        {"schedule": [{**s, "due_at": long_ago} for s in agreement["schedule"]]})
    assert run(client, market.run_jobs)["agreementsDefaulted"] == 1
    folio = client.get("/api/marketplace/portfolio", headers=inv).json()
    assert folio["totals"]["defaultedCents"] == 1_000_00
    assert_books_balance(client)


def test_revenue_share_pays_from_verified_revenue_only(client, owner):
    biz = freelancer(client, owner, email="rev@example.com")
    seed_orders(client, "rev@example.com", 6, 2000.0)
    body = raise_body(kind="revenue_share", targetCents=1_000_00, shareBps=1_000, periodMonths=12,
                      termMonths=None, title="Revenue share for a design studio")
    listing = client.post("/api/marketplace/listings", headers=biz, json=body).json()
    assert listing["terms"] == {"shareBps": 1_000, "periodMonths": 12, "capBps": market.REV_CAP_BPS}
    inv = verified_investor(client, owner, "ri@example.com", 2_000_00)
    client.post(f"/api/marketplace/listings/{listing['id']}/invest", headers=inv,
                json={"amountCents": 1_000_00, "idempotencyKey": key(), "acceptRisk": True})
    agreement_id = client.get(f"/api/marketplace/listings/{listing['id']}", headers=biz).json()["agreementId"]
    agreement = client.get(f"/api/marketplace/agreements/{agreement_id}", headers=biz).json()
    assert agreement["capCents"] == 1_500_00 and agreement["due"]["dueNowCents"] == 0

    # Revenue after the agreement starts: verified and completed counts; the rest doesn't.
    make_order(client, "rev@example.com", status="completed", amount=3000.0)
    make_order(client, "rev@example.com", status="active", amount=9000.0)
    make_order(client, "rev@example.com", status="completed", amount=9000.0, verification_status="pending")
    due = client.get(f"/api/marketplace/agreements/{agreement_id}", headers=biz).json()["due"]
    assert due["eligibleRevenueCents"] == 3_000_00 and due["dueNowCents"] == 300_00
    client.post(f"/api/marketplace/agreements/{agreement_id}/pay", headers=biz,
                json={"amountCents": 300_00, "idempotencyKey": key()})
    assert client.get("/api/marketplace/portfolio", headers=inv).json()["totals"]["distributedCents"] == 300_00
    assert_books_balance(client)


def test_platform_index_spreads_across_high_grades_only(client, owner):
    strong = []
    for i in range(2):
        email = f"strong{i}@example.com"
        headers = freelancer(client, owner, email=email)
        seed_orders(client, email, 21, 3000.0, platform="Upwork")
        seed_orders(client, email, 1, 3000.0, platform="Freelancer.com")
        listing = client.post("/api/marketplace/listings", headers=headers, json=raise_body(targetCents=1_000_00)).json()
        assert listing["grade"] == "A"
        strong.append(listing)
    weak_headers = freelancer(client, owner, email="weak@example.com")
    seed_orders(client, "weak@example.com", 1, 500.0)
    weak = client.post("/api/marketplace/listings", headers=weak_headers, json=raise_body(targetCents=1_000_00)).json()
    assert weak["grade"] not in market.HIGH_GRADES

    inv = verified_investor(client, owner, "idx@example.com", 1_000_00)
    overview = client.get("/api/marketplace/overview", headers=inv).json()
    assert overview["index"]["count"] == 2 and overview["index"]["capacityCents"] == 2_000_00
    res = client.post("/api/marketplace/index/invest", headers=inv,
                      json={"amountCents": 600_00, "idempotencyKey": key(), "acceptRisk": True})
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["placedCents"] == 600_00 and len(data["investments"]) == 2
    assert {i["listingId"] for i in data["investments"]} == {s["id"] for s in strong}
    assert all(i["amountCents"] == 300_00 and i["via"] == "index" for i in data["investments"])
    assert client.get(f"/api/marketplace/listings/{weak['id']}", headers=inv).json()["raisedCents"] == 0
    assert balances(client, inv)["usdCents"] == 400_00
    broke = client.post("/api/marketplace/index/invest", headers=inv,
                        json={"amountCents": 5_000_00, "idempotencyKey": key(), "acceptRisk": True})
    assert broke.status_code == 409
    assert_books_balance(client)


# --------------------------------------------------------------------------- #
# Upfront credit and financing
# --------------------------------------------------------------------------- #
def test_early_payment_can_land_in_usdc_balance_once(client, owner):
    from test_capital import investor
    investor(client, owner)
    fl = freelancer(client, owner)
    order = make_order(client, "fl@example.com")
    quote = client.post("/api/capital/advances/quote", headers=fl, json={"orderId": order["id"]}).json()
    adv = client.post(f"/api/capital/advances/{quote['id']}/accept", headers=fl, json={"acceptTerms": True}).json()
    res = client.post("/api/banking/advance-payout", headers=fl, json={"advanceId": adv["id"], "currency": "usdc"})
    assert res.status_code == 200, res.text
    assert res.json()["advance"]["payoutTo"] == "usdc_balance"
    assert balances(client, fl) == {"usdCents": 0, "usdcCents": adv["principalCents"]}
    again = client.post("/api/banking/advance-payout", headers=fl, json={"advanceId": adv["id"], "currency": "usd"})
    assert again.status_code == 409
    other = bearer(signup(client, email="other@example.com")["token"])
    assert client.post("/api/banking/advance-payout", headers=other,
                       json={"advanceId": adv["id"], "currency": "usd"}).status_code == 404
    assert_books_balance(client)


def test_financing_estimate_and_application(client, owner):
    headers = bearer(signup(client, email="fin@example.com")["token"])
    est = client.get("/api/banking/financing/estimate", headers=headers).json()
    assert est["estimate"] is None and est["reasons"]
    seed_orders(client, "fin@example.com", 10, 10_000.0)
    est = client.get("/api/banking/financing/estimate", headers=headers).json()
    assert est["verifiedTrailingYearCents"] == 100_000_00
    assert est["estimate"] == {"lowCents": 12_500_00, "highCents": 25_000_00}

    body = {"amountCents": 25_000_00, "product": "line_of_credit", "purpose": "Hire two designers for Q1.",
            "businessType": "agency", "yearsInBusiness": "3-5", "teamSize": 4, "monthlyRevenueCents": 9_000_00,
            "consent": False}
    assert client.post("/api/banking/financing", headers=headers, json=body).status_code == 422
    assert client.post("/api/banking/financing", headers=headers,
                       json={**body, "consent": True, "amountCents": 250_000_01}).status_code == 422
    app = client.post("/api/banking/financing", headers=headers, json={**body, "consent": True})
    assert app.status_code == 200 and app.json()["status"] == "submitted"
    assert client.post("/api/banking/financing", headers=headers, json={**body, "consent": True}).status_code == 409
    assert client.get("/api/banking/admin/financing", headers=headers).status_code == 403
    queue = client.get("/api/banking/admin/financing", headers=owner).json()
    assert queue[0]["id"] == app.json()["id"]
    reviewed = client.post(f"/api/banking/admin/financing/{app.json()['id']}", headers=owner,
                           json={"status": "referred", "note": "Sent to partner"})
    assert reviewed.json()["status"] == "referred"
    assert client.post(f"/api/banking/financing/{app.json()['id']}/withdraw", headers=headers).status_code == 409


def test_marketplace_routes_need_a_session(client):
    for method, path in (("get", "/api/marketplace/overview"), ("get", "/api/marketplace/listings"),
                         ("get", "/api/banking/overview"), ("post", "/api/banking/transfers")):
        assert getattr(client, method)(path).status_code == 401
    headers = bearer(signup(client, email="u@example.com")["token"])
    assert client.post("/api/marketplace/admin/run-jobs", headers=headers).status_code == 403
    assert uid(client, "u@example.com")
    assert ledger.SETTLEMENT == "simulated"
