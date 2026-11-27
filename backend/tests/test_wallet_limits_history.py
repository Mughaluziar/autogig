"""Regression tests for the atomic daily limits (capital/limits.py) and the database-backed transaction history
(capital/activity.py): concurrent requests, duplicate requests, failed requests giving their reservation back,
pagination and totals, complete CSV exports, permissions, and that the history always agrees with the ledger.
Simulated settlement throughout; the books must balance after each flow."""
import asyncio
import csv
import io

from conftest import run
from app import db
from app.capital import activity, banking, ledger, limits
from test_capital import assert_books_balance, key, owner, uid  # noqa: F401  (owner is a fixture)
from test_marketplace import balances, fund_wallet
from test_wallet_cards import OTHER, member


def _gather(client, *coros_factories):
    async def go():
        return await asyncio.gather(*[f() for f in coros_factories], return_exceptions=True)
    return run(client, go)


def _ok(results):
    return [r for r in results if isinstance(r, dict)]


def _limit_errors(results):
    return [r for r in results if isinstance(r, banking.CapitalError) and "a day" in str(r)]


def _ledger_wallet(client, user_id):
    bal = run(client, ledger.balances)
    return {"usdCents": ledger.usd(bal, f"wallet:{user_id}"), "usdcCents": ledger.usd(bal, f"usdc:{user_id}")}


# --------------------------------------------------------------------------- #
# Daily limits under concurrency
# --------------------------------------------------------------------------- #
def test_concurrent_member_transfers_cannot_beat_the_daily_limit(client, owner, monkeypatch):
    monkeypatch.setattr(banking, "DAILY_INTERNAL_SEND_CENTS", 150_00)
    a = member(client, owner, "alice@example.com", cents=1_000_00)
    member(client, owner, "bob@example.com")
    alice = uid(client, "alice@example.com")
    results = _gather(client, *[lambda: banking.transfer(alice, kind="internal_send", amount_cents=60_00, idem=key(),
                                                         recipient_email="bob@example.com") for _ in range(8)])
    assert len(_ok(results)) == 2                       # 2 x 60 = 120 of 150; a third would be 180
    assert len(_limit_errors(results)) == 6
    assert balances(client, a)["usdCents"] == 1_000_00 - 120_00
    assert _ledger_wallet(client, uid(client, "bob@example.com"))["usdCents"] == 120_00
    assert run(client, limits.used, alice, "internal_send") == 120_00
    assert_books_balance(client)


def test_concurrent_deposits_and_usdc_receipts_cannot_beat_their_limits(client, owner, monkeypatch):
    monkeypatch.setattr(banking, "DAILY_DEPOSIT_CENTS", 500_00)
    monkeypatch.setattr(banking, "DAILY_CRYPTO_RECEIVE_CENTS", 300_00)
    h = member(client, owner, "dep@example.com")
    user_id = uid(client, "dep@example.com")
    acct = fund_wallet(client, h, 100_00)                  # 100 of today's 500 deposit limit
    results = _gather(client, *[lambda: banking.transfer(user_id, kind="deposit", amount_cents=150_00, idem=key(),
                                                         bank_account_id=acct["id"]) for _ in range(6)])
    assert len(_ok(results)) == 2 and len(_limit_errors(results)) == 4     # 100 + 2 x 150 = 400 of 500

    linked = client.post("/api/banking/crypto/addresses", headers=h, json={"address": OTHER, "label": "Mine"}).json()
    results = _gather(client, *[lambda: banking.transfer(user_id, kind="crypto_receive", amount_cents=100_00, idem=key(),
                                                         crypto_address_id=linked["id"]) for _ in range(5)])
    assert len(_ok(results)) == 3 and len(_limit_errors(results)) == 2
    assert balances(client, h) == {"usdCents": 400_00, "usdcCents": 300_00}
    assert_books_balance(client)


def test_duplicate_concurrent_requests_post_once(client, owner):
    a = member(client, owner, "alice@example.com", cents=500_00)
    member(client, owner, "bob@example.com")
    alice, bob = uid(client, "alice@example.com"), uid(client, "bob@example.com")
    k = key()
    results = _gather(client, *[lambda: banking.transfer(alice, kind="internal_send", amount_cents=75_00, idem=k,
                                                         recipient_email="bob@example.com") for _ in range(6)])
    assert all(isinstance(r, dict) for r in results), results
    assert len({r["id"] for r in results}) == 1
    sends = [e for e in run(client, ledger.entries) if e["kind"] == "bank_internal_send"]
    assert len(sends) == 1
    assert balances(client, a)["usdCents"] == 425_00
    assert _ledger_wallet(client, bob)["usdCents"] == 75_00
    receipts = run(client, banking.store.find, "bank_transfers", {"user_id": bob, "kind": "internal_receive"})
    assert len(receipts) == 1
    assert run(client, limits.used, alice, "internal_send") == 75_00     # counted once
    assert_books_balance(client)


def test_failed_and_retried_transfers_count_once_against_the_limit(client, owner, monkeypatch):
    monkeypatch.setattr(banking, "DAILY_INTERNAL_SEND_CENTS", 150_00)
    a = member(client, owner, "alice@example.com", cents=50_00)
    member(client, owner, "bob@example.com")
    body = {"kind": "internal_send", "recipientEmail": "bob@example.com"}
    poor = client.post("/api/banking/transfers", headers=a, json={**body, "amountCents": 100_00, "idempotencyKey": key()})
    assert poor.status_code == 409 and "balance" in poor.json()["detail"]
    alice = uid(client, "alice@example.com")
    assert run(client, limits.used, alice, "internal_send") == 0          # the failed request gave its 100 back
    k = key()
    for _ in range(3):                                                    # one request, retried
        assert client.post("/api/banking/transfers", headers=a,
                           json={**body, "amountCents": 50_00, "idempotencyKey": k}).status_code == 200
    bank = client.get("/api/banking/accounts", headers=a).json()[0]["id"]
    assert client.post("/api/banking/transfers", headers=a, json={
        "kind": "deposit", "amountCents": 200_00, "idempotencyKey": key(), "bankAccountId": bank}).status_code == 200
    assert client.post("/api/banking/transfers", headers=a,
                       json={**body, "amountCents": 100_00, "idempotencyKey": key()}).status_code == 200
    over = client.post("/api/banking/transfers", headers=a, json={**body, "amountCents": 1_00, "idempotencyKey": key()})
    assert over.status_code == 409 and "a day" in over.json()["detail"]
    assert balances(client, a)["usdCents"] == 50_00 - 50_00 + 200_00 - 100_00
    assert_books_balance(client)


def test_limit_counters_are_per_user_kind_and_day(client):
    async def go():
        assert await limits.reserve("u1", "deposit", 60, 100, "r1", day="2026-01-01")
        assert await limits.reserve("u1", "deposit", 60, 100, "r1", day="2026-01-01")      # same request: once
        assert not await limits.reserve("u1", "deposit", 60, 100, "r2", day="2026-01-01")
        assert await limits.reserve("u1", "deposit", 60, 100, "r2", day="2026-01-02")      # new day
        assert await limits.reserve("u2", "deposit", 60, 100, "r3", day="2026-01-01")      # other user
        assert await limits.reserve("u1", "internal_send", 60, 100, "r4", day="2026-01-01")  # other kind
        await limits.release("u1", "deposit", 60, "r1", day="2026-01-01")
        await limits.release("u1", "deposit", 60, "r1", day="2026-01-01")                  # idempotent
        assert await limits.used("u1", "deposit", day="2026-01-01") == 0
        assert await limits.reserve("u1", "deposit", 100, 100, "r5", day="2026-01-01")
        assert not await limits.reserve("u1", "deposit", 101, 100, "r6", day="2026-01-03")  # over the cap alone
    run(client, go)


# --------------------------------------------------------------------------- #
# Transaction history: pagination, totals, CSV, permissions, ledger agreement
# --------------------------------------------------------------------------- #
def _movements(client, h, n):
    """n wallet movements alternating in and out (deposits, conversions to USDC and back)."""
    for i in range(n):
        kind, cents = (("to_usdc", 10_00 + i), ("to_usd", 5_00 + i))[i % 2]
        res = client.post("/api/banking/transfers", headers=h, json={"kind": kind, "amountCents": cents, "idempotencyKey": key()})
        assert res.status_code == 200, res.text


def test_history_pages_cover_every_row_once_with_stable_totals(client, owner):
    h = member(client, owner, "hist@example.com", cents=1_000_00)
    _movements(client, h, 24)
    full = client.get("/api/banking/transactions?limit=200", headers=h).json()
    assert full["count"] == 25 and full["nextBefore"] is None
    seen, before, pages = [], None, 0
    while True:
        url = "/api/banking/transactions?limit=7" + (f"&before={before}" if before else "")
        page = client.get(url, headers=h).json()
        pages += 1
        assert (page["count"], page["inCents"], page["outCents"]) == (full["count"], full["inCents"], full["outCents"])
        seen += [r["seq"] for r in page["rows"]]
        before = page["nextBefore"]
        if before is None:
            break
    assert pages == 4 and seen == [r["seq"] for r in full["rows"]] and seen == sorted(seen, reverse=True)
    # Running balances agree with the ledger, and with the sum of the movements.
    top = full["rows"][0]
    assert {"usdCents": top["balanceUsdCents"], "usdcCents": top["balanceUsdcCents"]} == balances(client, h)
    assert sum(r["usdCents"] for r in full["rows"]) == top["balanceUsdCents"]
    assert sum(r["usdcCents"] for r in full["rows"]) == top["balanceUsdcCents"]
    # Filtered paging: USDC out only.
    out = client.get("/api/banking/transactions?currency=usdc&direction=out&limit=5", headers=h).json()
    assert out["count"] == 12 and len(out["rows"]) == 5 and all(r["usdcCents"] < 0 for r in out["rows"])
    nxt = client.get(f"/api/banking/transactions?currency=usdc&direction=out&limit=5&before={out['nextBefore']}", headers=h).json()
    assert not {r["seq"] for r in out["rows"]} & {r["seq"] for r in nxt["rows"]}


def test_csv_export_is_complete_beyond_one_page(client, owner):
    h = member(client, owner, "csv@example.com", cents=1_000_00)
    _movements(client, h, 30)
    res = client.get("/api/banking/transactions.csv", headers=h)
    assert res.status_code == 200
    rows = list(csv.reader(io.StringIO(res.text)))
    assert len(rows) - 1 == 31 == client.get("/api/banking/transactions?limit=1", headers=h).json()["count"]
    filtered = list(csv.reader(io.StringIO(client.get("/api/banking/transactions.csv?category=bank", headers=h).text)))
    assert len(filtered) == 2 and filtered[1][1] == "bank"


def test_history_catches_up_and_rebuilds_from_the_ledger(client, owner):
    h = member(client, owner, "sync@example.com", cents=300_00)
    user_id = uid(client, "sync@example.com")
    first = client.get("/api/banking/transactions", headers=h).json()
    _movements(client, h, 3)
    later = client.get("/api/banking/transactions", headers=h).json()
    assert later["count"] == first["count"] + 3

    async def wipe():                               # lose the derived view entirely: it is rebuilt from the journal
        if db.enabled():
            await db._get_db()[activity.COLL].delete_many({"user_id": user_id})
            await db._get_db()[activity.CURSORS].delete_one({"_id": user_id})
        else:
            activity._mem_rows.pop(user_id, None)
            activity._mem_cursors.pop(user_id, None)
    run(client, wipe)
    rebuilt = client.get("/api/banking/transactions", headers=h).json()
    assert rebuilt["rows"] == later["rows"] and rebuilt["count"] == later["count"]
    # Concurrent readers catching up at once produce one row per entry.
    _movements(client, h, 2)
    _gather(client, *[lambda: activity.sync(user_id) for _ in range(5)])
    assert client.get("/api/banking/transactions", headers=h).json()["count"] == later["count"] + 2


def test_history_is_private_and_bounded(client, owner):
    a = member(client, owner, "a@example.com", cents=100_00)
    b = member(client, owner, "b@example.com")
    seq = client.get("/api/banking/transactions", headers=a).json()["rows"][0]["seq"]
    assert client.get(f"/api/banking/transactions?before={seq + 1}", headers=b).json()["count"] == 0
    assert len(client.get("/api/banking/transactions.csv", headers=b).text.splitlines()) == 1   # header only
    assert client.get("/api/banking/transactions.csv").status_code == 401
    assert client.get("/api/banking/transactions?limit=0", headers=a).status_code == 422
    assert client.get("/api/banking/transactions?limit=201", headers=a).status_code == 422
    assert client.get("/api/banking/transactions?before=0", headers=a).status_code == 422
    assert client.get("/api/banking/transactions?q=" + "%28%2A%5B", headers=a).status_code == 200   # regex chars


def test_history_matches_the_ledger_after_concurrent_bursts(client, owner, monkeypatch):
    monkeypatch.setattr(banking, "DAILY_INTERNAL_SEND_CENTS", 10_000_00)
    a = member(client, owner, "alice@example.com", cents=300_00)
    member(client, owner, "bob@example.com")
    alice, bob = uid(client, "alice@example.com"), uid(client, "bob@example.com")
    results = _gather(client, *[lambda: banking.transfer(alice, kind="internal_send", amount_cents=70_00, idem=key(),
                                                         recipient_email="bob@example.com") for _ in range(6)])
    assert len(_ok(results)) == 4                       # 4 x 70 = 280 of 300: the balance can't go negative
    for user_id in (alice, bob):
        page = run(client, banking.transactions, user_id)
        wallet = _ledger_wallet(client, user_id)
        assert page["rows"][0]["balanceUsdCents"] == wallet["usdCents"]
        assert sum(r["usdCents"] for r in page["rows"]) == wallet["usdCents"]
    assert balances(client, a)["usdCents"] == 20_00
    assert_books_balance(client)
