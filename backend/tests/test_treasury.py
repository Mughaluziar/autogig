"""Treasury and financial reporting (simulated): owner-only access, grouping that never names a customer, integrity
checks on a real workflow and on a tampered head, period arithmetic, CSV safety and date validation."""
import csv
import io
import json
from datetime import timedelta

import pytest

from conftest import bearer, memory_only, run, signup
from app import db
from app.capital import ledger, store as cstore, treasury
from app.capital.ledger import line
from test_capital import freelancer, investor, key, make_order, owner, uid  # noqa: F401  (owner is a fixture)
from test_marketplace import fund_wallet

ROUTES = ("/api/treasury/overview", "/api/treasury/report?start=2026-01-01&end=2026-01-31",
          "/api/treasury/journal.csv?start=2026-01-01&end=2026-01-31")


def today():
    return cstore.now().date()


def overview(client, owner):
    res = client.get("/api/treasury/overview", headers=owner)
    assert res.status_code == 200, res.text
    return res.json()


def report(client, owner, start, end):
    res = client.get(f"/api/treasury/report?start={start}&end={end}", headers=owner)
    assert res.status_code == 200, res.text
    return res.json()


def checks(view):
    return {c["key"]: c for c in view["checks"]}


def group(view, key, unit="USD"):
    return next(g for g in view["groups"] if g["key"] == key and g["unit"] == unit)


def accounts(g):
    return {a["account"]: a.get("balance", a.get("closing")) for a in g["accounts"]}


async def _post(kind, lines, memo="test"):
    return await ledger.post(kind, lines, memo=memo)


async def _set_at(seqs, at):
    if db.enabled():
        await db._get_db().capital_journal.update_many({"_id": {"$in": list(seqs)}}, {"$set": {"at": at}})
        return
    for entry in ledger._mem_journal:
        if entry["seq"] in seqs:
            entry["at"] = at


def workflow(client, owner):
    """Pool deposit, an early payment repaid with its fee, standalone cover, banking in and out, a credit contribution."""
    inv = investor(client, owner, deposit_cents=10_000_00)
    fl = freelancer(client, owner)
    order = make_order(client, "fl@example.com")
    quote = client.post("/api/capital/advances/quote", headers=fl, json={"orderId": order["id"], "principalCents": 500_00}).json()
    adv = client.post(f"/api/capital/advances/{quote['id']}/accept", headers=fl, json={"acceptTerms": True}).json()
    assert client.post(f"/api/capital/advances/{adv['id']}/repay", headers=fl, json={"amountCents": 515_00}).status_code == 200
    covered = make_order(client, "fl@example.com")
    cover = client.post("/api/capital/coverages", headers=fl, json={"orderId": covered["id"], "acceptTerms": True})
    assert cover.status_code == 200, cover.text
    acct = fund_wallet(client, fl, 1_000_00)
    for body in ({"kind": "to_usdc", "amountCents": 300_00}, {"kind": "crypto_send", "amountCents": 100_00, "address": "0x" + "ab" * 20},
                 {"kind": "withdraw", "amountCents": 50_00, "bankAccountId": acct["id"]}):
        res = client.post("/api/banking/transfers", headers=fl, json={**body, "idempotencyKey": key()})
        assert res.status_code == 200, res.text
    res = client.post("/api/credit/contributions", headers=inv, json={"amountCents": 2_000_00, "idempotencyKey": key(), "acceptRisk": True})
    assert res.status_code == 200, res.text
    return inv, fl


# ---------------------------------------------------------------------------------------------------------------- access
def test_treasury_is_owner_only(client, owner):
    member = bearer(signup(client, email="member@example.com")["token"])
    for path in ROUTES:
        assert client.get(path).status_code == 401, path
        assert client.get(path, headers=member).status_code == 403, path
        assert client.get(path, headers=owner).status_code == 200, path


# ------------------------------------------------------------------------------------------------- overview and checks
def test_overview_groups_figures_and_checks_on_a_real_workflow(client, owner):
    workflow(client, owner)
    view = overview(client, owner)
    assert view["settlement"] == "simulated" and view["notice"]
    assert all(c["ok"] for c in view["checks"]) and view["ok"], view["checks"]
    assert set(checks(view)) == {"zero_sum", "replay_matches_head", "journal_contiguous", "entries_balanced", "non_negative", "credit_ledger"}

    k = view["kpis"]
    # $15 fee on $500: $10.50 to the pool, $3.00 to protection, $1.50 to the platform. Cover: 80% of $1,000 at 4%.
    assert k["pool"] == {"navCents": 10_010_50, "cashCents": 10_010_50, "outstandingCents": 0, "capitalCents": 10_000_00,
                         "feeIncomeCents": 10_50, "writtenOffCents": 0}
    p = k["protection"]
    assert (p["cashCents"], p["premiumsCents"], p["feeShareCents"], p["payoutsCents"]) == (35_00, 32_00, 3_00, 0)
    assert p["activeCovers"] == 1 and p["activeExposureCents"] == 800_00          # the repaid advance's cover expired
    assert p["coverageRatioBps"] == 35_00 * 10_000 // 800_00
    assert k["platform"] == {"cashCents": 1_50, "incomeCents": 1_50}
    assert k["customers"] == {"usdCents": 650_00, "usdAccounts": 1, "usdcCents": 200_00, "usdcAccounts": 1, "totalCents": 850_00}
    assert k["escrow"] == {"totalCents": 0, "listings": 0}
    assert k["credit"]["contributionsCents"] == 2_000_00 and k["credit"]["ledgerCheck"] is True
    assert k["shares"]["issuedUnits"] == 10_000_00 * ledger.SHARE_SCALE and k["shares"]["holderAccounts"] == 1
    assert k["shares"]["heldUnits"] == k["shares"]["issuedUnits"]

    assert accounts(group(view, "pool")) == {"pool:cash": 10_010_50, "pool:capital": -10_000_00, "pool:income": -10_50, "pool:advances": 0}
    assert accounts(group(view, "external")) == {"external:bank": -950_00, "external:chain": 100_00}
    wallets = group(view, "wallet")
    assert wallets["accounts"] == [] and wallets["aggregate"] == {"count": 1, "total": 650_00}
    shares = group(view, "shares", "SHARE")
    assert list(accounts(shares)) == ["shares:issued"] and shares["aggregate"]["count"] == 1
    assert all(sum(g["total"] for g in view["groups"] if g["unit"] == u) == 0 for u in ("USD", "SHARE"))
    text = json.dumps(view)
    assert uid(client, "inv@example.com") not in text and uid(client, "fl@example.com") not in text


def test_new_accounts_land_in_their_program_or_other_without_naming_ids(client, owner):
    run(client, _post, "card_purchase", [line("wallet:u-0a1b2c3d4e5f", 7_00), line("external:card_network", -7_00)])
    run(client, _post, "mystery", [line("zeta:u-0a1b2c3d4e5f", 5), line("clearing:pool_funding", -5)])
    view = overview(client, owner)
    assert accounts(group(view, "external")) == {"external:card_network": -7_00}
    assert accounts(group(view, "clearing")) == {"clearing:pool_funding": -5}
    other = group(view, "other")
    assert other["accounts"] == [] and other["aggregate"] == {"count": 1, "total": 5}
    assert "0a1b2c3d4e5f" not in json.dumps(view)


@memory_only
def test_checks_detect_a_tampered_head_a_sequence_break_and_negative_balances(client, owner):
    workflow(client, owner)
    ledger._mem_head["balances"]["USD"]["pool:cash"] += 1
    found = checks(overview(client, owner))
    assert not found["zero_sum"]["ok"] and "USD by 1" in found["zero_sum"]["detail"]
    assert not found["replay_matches_head"]["ok"] and "pool:cash" in found["replay_matches_head"]["detail"]
    ledger._mem_head["balances"]["USD"]["pool:cash"] -= 1
    assert overview(client, owner)["ok"]

    ledger._mem_head["seq"] += 1
    found = checks(overview(client, owner))
    assert not found["journal_contiguous"]["ok"] and found["replay_matches_head"]["ok"]
    ledger._mem_head["seq"] -= 1

    run(client, _post, "test_overdraft", [line("wallet:u-feedfacecafe", -5), line("external:bank", 5)])
    view = overview(client, owner)
    found = checks(view)
    assert not view["ok"] and not found["non_negative"]["ok"]
    assert "wallet:…" in found["non_negative"]["detail"] and "feedfacecafe" not in json.dumps(view)


# -------------------------------------------------------------------------------------------------------------- reports
def test_report_opening_plus_flows_equals_closing(client, owner):
    inv = investor(client, owner, deposit_cents=1_000_00)
    fl = bearer(signup(client, email="bank@example.com")["token"])
    acct = fund_wallet(client, fl, 400_00)
    early = list(range(1, run(client, ledger._head)["seq"] + 1))
    run(client, _set_at, set(early), cstore.now() - timedelta(days=10))
    res = client.post("/api/credit/contributions", headers=inv, json={"amountCents": 300_00, "idempotencyKey": key(), "acceptRisk": True})
    assert res.status_code == 200
    for body in ({"kind": "to_usdc", "amountCents": 100_00}, {"kind": "withdraw", "amountCents": 50_00, "bankAccountId": acct["id"]}):
        assert client.post("/api/banking/transfers", headers=fl, json={**body, "idempotencyKey": key()}).status_code == 200

    day, back = today(), today() - timedelta(days=10)
    recent = report(client, owner, day - timedelta(days=5), day)
    assert recent["entries"] == 3 and recent["start"] == str(day - timedelta(days=5)) and recent["end"] == str(day)
    for g in recent["groups"]:
        assert g["opening"] + g["netFlow"] == g["closing"], g
    by_key = {(g["key"], g["unit"]): g for g in recent["groups"]}
    pool = {a["account"]: a for a in by_key[("pool", "USD")]["accounts"]}
    assert pool["pool:cash"]["opening"] == pool["pool:cash"]["closing"] == 1_000_00
    assert by_key[("wallet", "USD")]["aggregate"] == {"openingCount": 1, "closingCount": 1, "opening": 400_00, "closing": 250_00}
    assert by_key[("usdc", "USD")]["netFlow"] == 100_00 and by_key[("credit", "USD")]["netFlow"] == 0
    flows = {f["kind"]: f for f in recent["flows"]}
    assert flows["credit_contribution"] == {"kind": "credit_contribution", "count": 1, "grossCents": 300_00}
    assert set(flows) == {"credit_contribution", "bank_to_usdc", "bank_withdraw"}
    assert recent["external"] == [{"account": "external:bank", "inCents": 0, "outCents": 50_00, "netInCents": -50_00}]
    # Closing balances at today's end are today's balances.
    now = {(g["key"], g["unit"]): g["total"] for g in overview(client, owner)["groups"]}
    assert {k: g["closing"] for k, g in by_key.items()} == now

    earlier = report(client, owner, back, back)
    assert earlier["entries"] == len(early) and all(g["opening"] == 0 for g in earlier["groups"])
    assert {f["kind"] for f in earlier["flows"]} == {"investor_deposit", "bank_deposit"}
    both = report(client, owner, back, day)
    assert both["external"] == [{"account": "external:bank", "inCents": 400_00, "outCents": 50_00, "netInCents": 350_00}]

    empty = report(client, owner, "2025-01-01", "2025-01-31")
    assert empty["entries"] == 0 and empty["flows"] == [] and empty["external"] == []
    assert all(g["opening"] == g["closing"] == g["netFlow"] == 0 for g in empty["groups"])
    assert uid(client, "bank@example.com") not in json.dumps(recent)


def test_report_income_and_losses_by_kind(client, owner):
    entries = [
        ("investor_deposit", [line("pool:cash", 1_000), line("pool:capital", -1_000)]),
        ("advance_repayment", [line("pool:cash", 70), line("pool:income", -70), line("protection:cash", 20),
                               line("protection:income", -20), line("platform:cash", 10), line("platform:income", -10)]),
        ("protection_premium", [line("protection:cash", 40), line("protection:income", -40)]),
        ("market_disbursed", [line("escrow:l1", -500), line("wallet:u-1", 490), line("platform:cash", 10)]),
        ("credit_repayment", [line("credit:cash", 330), line("credit:receivable", -300), line("credit:income", -30)]),
        ("advance_written_off", [line("pool:losses", 200), line("pool:advances", -200)]),
        ("advance_repayment", [line("pool:cash", 50), line("pool:losses", -50)]),          # recovery after default
        ("credit_writeoff", [line("credit:losses", 120), line("credit:receivable", -120)]),
        ("protection_payout", [line("protection:payouts", 25), line("protection:cash", -25)]),
    ]
    for kind, lines in entries:
        run(client, _post, kind, lines)
    r = report(client, owner, today(), today())
    assert r["income"] == {"poolFeeIncomeCents": 70, "protectionPremiumsCents": 40, "protectionFeeShareCents": 20,
                           "platformIncomeCents": 10, "marketplaceFeesCents": 10, "creditFeesCents": 30, "totalCents": 180}
    assert r["losses"] == {"poolWriteOffsCents": 200, "poolRecoveriesCents": 50, "creditWriteOffsCents": 120,
                           "creditRecoveriesCents": 0, "protectionPayoutsCents": 25, "totalCents": 295}
    flows = {f["kind"]: f for f in r["flows"]}
    assert flows["advance_repayment"] == {"kind": "advance_repayment", "count": 2, "grossCents": 150}
    assert r["flows"][0]["kind"] == "investor_deposit"                          # largest gross first


# ------------------------------------------------------------------------------------------------------------------ CSV
def test_csv_cells_neutralise_formulas():
    assert [treasury.csv_cell(v) for v in ("=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx", "plain", None, 5, -5)] == \
        ["'=1+1", "'+1", "'-1", "'@SUM(A1)", "'\tx", "'\rx", "plain", "", 5, -5]


def test_journal_csv_export_is_quoted_and_formula_safe(client, owner):
    memo = '=HYPERLINK("http://evil.example","click"), with "quotes"\nand a second line'
    run(client, _post, "@sum", [line("pool:cash", 5), line("pool:income", -5)], memo)
    run(client, _post, "plain_kind", [line("wallet:u-abc123abc123", 7), line("external:bank", -7)], "Deposit, simple")
    res = client.get(f"/api/treasury/journal.csv?start={today()}&end={today()}", headers=owner)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert res.headers["content-disposition"] == f'attachment; filename="treasury-journal-{today()}-to-{today()}.csv"'
    assert res.headers["cache-control"] == "private, no-store"
    rows = list(csv.reader(io.StringIO(res.text)))
    assert rows[0] == list(treasury.CSV_HEADER) and len(rows) == 5
    first = rows[1]
    assert first[0] == "1" and first[2] == "'@sum" and first[3] == "'" + memo and first[4] == "simulated"
    assert [r[7] for r in rows[1:]] == ["5", "-5", "7", "-7"]                # amounts stay numbers
    assert rows[3][5] == "wallet:u-abc123abc123"                              # the owner's export names accounts
    assert '"' + "'" + '=HYPERLINK(""http' in res.text                        # quotes doubled inside a quoted cell
    assert all(not cell.startswith(("=", "+", "@")) for row in rows for cell in row)
    later = client.get("/api/treasury/journal.csv?start=2025-01-01&end=2025-01-02", headers=owner)
    assert list(csv.reader(io.StringIO(later.text))) == [list(treasury.CSV_HEADER)]


# ---------------------------------------------------------------------------------------------------------------- dates
@pytest.mark.parametrize("query", [
    "", "start=2026-01-01", "end=2026-01-01", "start=2026-1-1&end=2026-01-31", "start=2026-02-30&end=2026-03-01",
    "start=2026-03-02&end=2026-03-01", "start=2025-01-01&end=2026-01-02", "start=1999-12-31&end=2000-01-01",
    "start=2026-01-01&end=2026-01-31T00:00", "start=20260101&end=20260131",
])
def test_report_and_export_reject_bad_periods(client, owner, query):
    for path in ("/api/treasury/report", "/api/treasury/journal.csv"):
        res = client.get(f"{path}?{query}", headers=owner)
        assert res.status_code == 422, (path, query, res.text)


def test_period_limit_is_366_inclusive_days(client, owner):
    assert treasury.parse_period("2024-01-01", "2024-12-31")[1].isoformat() == "2024-12-31"      # leap year: 366 days
    assert client.get("/api/treasury/report?start=2024-01-01&end=2024-12-31", headers=owner).status_code == 200
    assert client.get("/api/treasury/report?start=2024-01-01&end=2025-01-01", headers=owner).status_code == 422
    assert client.get("/api/treasury/report?start=2026-05-05&end=2026-05-05", headers=owner).status_code == 200
