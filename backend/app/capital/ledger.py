"""Double-entry ledger for the capital program. SIMULATED SETTLEMENT.

Nothing here moves money. Each entry records what a licensed settlement
partner would have to execute, and is tagged `settlement: "simulated"`.

Design
  * capital_journal is append-only and the source of truth. Each entry has
    lines in one or more units ("USD" in cents, "SHARE" in pool-share units),
    and the lines of each unit sum to zero.
  * Writers serialise on the journal sequence: an entry is inserted with
    _id = head.seq + 1, and the unique _id means only one writer can claim a
    given seq. The loser re-reads and re-validates. No multi-document
    transactions are needed, so this also works on a single-node MongoDB.
  * capital_head caches balances at a seq. If a writer stops between its
    journal insert and its head update, the next read replays the missing
    entries.
  * `check` runs against the post-entry balances inside the serialised
    section, so invariants (no negative cash, no over-redeemed shares) hold
    under concurrency.

Accounts (USD; debit positive)
  pool:cash, pool:advances       pool assets (NAV = cash + advances)
  pool:capital                   investor contributions (credit)
  pool:income, pool:losses       realised fee yield / written-off principal
  protection:cash                protection fund assets
  protection:income, protection:payouts
  platform:cash, platform:income
  wallet:<user_id>               a user's Autopilot USD balance (banking)
  usdc:<user_id>                 a user's USDC balance (banking)
  escrow:<listing_id>            marketplace investments held until a raise closes
  external:bank, external:chain  money in from / out to banks and crypto wallets
  clearing:advance_payouts       early payments paid into a wallet instead of a bank
Accounts (SHARE)
  shares:issued                  credit balance = total shares outstanding
  shares:<user_id>               an investor's holding
"""
from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone

from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError

from .. import db

SETTLEMENT = "simulated"
# Initial price: one cent buys this many share units ($1 = 1,000,000 units).
SHARE_SCALE = 10_000
_MAX_RETRIES = 12

_mem_journal: list[dict] = []
_mem_head: dict = {"seq": 0, "balances": {}}


class LedgerRejected(Exception):
    """An entry would break an invariant (for example, negative cash)."""


def reset_memory() -> None:
    _mem_journal.clear()
    _mem_head.clear()
    _mem_head.update({"seq": 0, "balances": {}})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def line(account: str, amount: int, unit: str = "USD") -> dict:
    if not isinstance(amount, int) or isinstance(amount, bool):
        raise TypeError("Ledger amounts must be integers (cents or share units).")
    return {"account": account, "unit": unit, "amount": amount}


def _validate(lines: list[dict]) -> None:
    totals: dict[str, int] = defaultdict(int)
    for item in lines:
        if not isinstance(item.get("amount"), int):
            raise TypeError("Ledger amounts must be integers.")
        totals[item["unit"]] += item["amount"]
    unbalanced = {unit: total for unit, total in totals.items() if total != 0}
    if unbalanced:
        raise ValueError(f"Unbalanced entry: {unbalanced}")


def _apply(balances: dict, lines: list[dict]) -> dict:
    out = deepcopy(balances)
    for item in lines:
        unit = out.setdefault(item["unit"], {})
        unit[item["account"]] = unit.get(item["account"], 0) + item["amount"]
    return out


async def ensure_indexes() -> None:
    if not db.enabled():
        return
    mdb = db._get_db()
    await mdb.capital_journal.create_index("idem", unique=True, partialFilterExpression={"idem": {"$type": "string"}})
    await mdb.capital_journal.create_index([("refs.user_id", ASCENDING), ("seq", ASCENDING)])
    await mdb.capital_journal.create_index([("refs.users", ASCENDING), ("seq", ASCENDING)])


async def _head() -> dict:
    """Current balances, replaying any entries the cached head missed."""
    if not db.enabled():
        return {"seq": _mem_head["seq"], "balances": deepcopy(_mem_head["balances"])}
    mdb = db._get_db()
    head = await mdb.capital_head.find_one({"_id": "head"}) or {"seq": 0, "balances": {}}
    missing = [e async for e in mdb.capital_journal.find({"_id": {"$gt": head["seq"]}}).sort("_id", ASCENDING)]
    if not missing:
        return {"seq": head["seq"], "balances": head.get("balances") or {}}
    balances = head.get("balances") or {}
    for entry in missing:
        balances = _apply(balances, entry["lines"])
    seq = missing[-1]["_id"]
    await mdb.capital_head.update_one({"_id": "head"}, {"$max": {"seq": 0}}, upsert=True)
    await mdb.capital_head.update_one({"_id": "head", "seq": {"$lt": seq}},
                                      {"$set": {"seq": seq, "balances": balances}})
    return {"seq": seq, "balances": balances}


async def balances() -> dict:
    return (await _head())["balances"]


async def find_by_idem(idem: str) -> dict | None:
    if not db.enabled():
        return deepcopy(next((e for e in _mem_journal if e.get("idem") == idem), None))
    doc = await db._get_db().capital_journal.find_one({"idem": idem})
    return _public(doc)


def _public(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    out = {k: v for k, v in doc.items() if k != "_id"}
    if isinstance(out.get("at"), datetime):
        out["at"] = out["at"].replace(tzinfo=out["at"].tzinfo or timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return out


async def post(kind: str, lines, *, memo: str, refs: dict | None = None,
               idem: str | None = None, check=None, settlement: str = SETTLEMENT) -> dict:
    """Append one balanced entry.

    `lines` is a list, or a function of the current balances that returns
    one. Use a function when amounts depend on the pool's state (share
    minting): it runs inside the serialised section, so it sees exactly the
    balances the entry lands on. `check(balances_after)` may raise
    LedgerRejected. With `idem`, a repeated call returns the original entry.
    `settlement` labels where money moved: "simulated", or "testnet:<chainId>"
    for token-program entries mirrored from a test chain.
    """
    if not callable(lines):
        _validate(lines)
    if idem:
        existing = await find_by_idem(idem)
        if existing:
            return existing
    build = lines if callable(lines) else (lambda _bal: lines)
    for _ in range(_MAX_RETRIES):
        head = await _head()
        lines_now = build(head["balances"])
        _validate(lines_now)
        after = _apply(head["balances"], lines_now)
        if check is not None:
            check(after)
        seq = head["seq"] + 1
        entry = {"seq": seq, "at": _now(), "kind": kind, "memo": memo[:300], "lines": lines_now,
                 "refs": refs or {}, "settlement": settlement, "idem": idem}
        if not db.enabled():
            # No await between reading the head and writing it: atomic here.
            if _mem_head["seq"] != head["seq"]:
                continue
            _mem_journal.append(deepcopy(entry))
            _mem_head.update({"seq": seq, "balances": after})
            return _public(deepcopy(entry))
        mdb = db._get_db()
        try:
            await mdb.capital_journal.insert_one({"_id": seq, **entry})
        except DuplicateKeyError:
            if idem:
                existing = await find_by_idem(idem)
                if existing:
                    return existing
            continue  # another writer took this seq; re-validate on fresh balances
        await mdb.capital_head.update_one({"_id": "head"}, {"$max": {"seq": 0}}, upsert=True)
        await mdb.capital_head.update_one({"_id": "head", "seq": head["seq"]},
                                          {"$set": {"seq": seq, "balances": after}})
        return _public(entry)
    raise LedgerRejected("The ledger is busy; try again.")


def _involves(entry: dict, user_id: str) -> bool:
    refs = entry.get("refs") or {}
    return refs.get("user_id") == user_id or user_id in (refs.get("users") or [])


async def entries(*, user_id: str | None = None, limit: int = 200) -> list[dict]:
    """Newest first. With `user_id`, entries that name the user in
    `refs.user_id`, or in `refs.users` when one entry moves several users'
    money (a marketplace repayment shared among investors)."""
    if not db.enabled():
        rows = [e for e in reversed(_mem_journal) if user_id is None or _involves(e, user_id)]
        return [_public(deepcopy(e)) for e in rows[:limit]]
    query = {"$or": [{"refs.user_id": user_id}, {"refs.users": user_id}]} if user_id else {}
    cursor = db._get_db().capital_journal.find(query).sort("_id", -1).limit(limit)
    return [_public(d) async for d in cursor]


async def journal(*, upto_seq: int | None = None):
    """Every entry oldest first (seq order), in both storage modes. Read-only, for replays, audits and exports
    (capital/treasury.py). `upto_seq` pins the read to a head already taken, so entries posted meanwhile can't
    make a replay disagree with that head. Memory mode iterates a snapshot of the list."""
    if not db.enabled():
        for entry in list(_mem_journal):
            if upto_seq is not None and entry["seq"] > upto_seq:
                break
            yield _public(deepcopy(entry))
        return
    query = {} if upto_seq is None else {"_id": {"$lte": upto_seq}}
    async for doc in db._get_db().capital_journal.find(query).sort("_id", ASCENDING):
        yield _public(doc)


# --------------------------------------------------------------------------- #
# Pool arithmetic (pure)
# --------------------------------------------------------------------------- #
def usd(bal: dict, account: str) -> int:
    return int((bal.get("USD") or {}).get(account, 0))


def shares(bal: dict, account: str) -> int:
    return int((bal.get("SHARE") or {}).get(account, 0))


def nav_cents(bal: dict) -> int:
    return usd(bal, "pool:cash") + usd(bal, "pool:advances")


def total_shares(bal: dict) -> int:
    return -shares(bal, "shares:issued")


def shares_for_deposit(bal: dict, amount_cents: int) -> int:
    """Shares minted for a deposit, rounded down (rounding favours the pool)."""
    total, nav = total_shares(bal), nav_cents(bal)
    if total == 0 or nav <= 0:
        return amount_cents * SHARE_SCALE
    return amount_cents * total // nav


def shares_to_burn(bal: dict, amount_cents: int) -> int:
    """Shares redeemed to pay out `amount_cents`, rounded up."""
    total, nav = total_shares(bal), nav_cents(bal)
    if nav <= 0 or total == 0:
        raise LedgerRejected("The pool has no value to redeem.")
    return -(-amount_cents * total // nav)


def value_of_shares(bal: dict, units: int) -> int:
    total, nav = total_shares(bal), nav_cents(bal)
    return units * nav // total if total else 0


def require_non_negative(*accounts: str, unit: str = "USD"):
    def check(after: dict) -> None:
        for account in accounts:
            if int((after.get(unit) or {}).get(account, 0)) < 0:
                raise LedgerRejected(f"Insufficient balance in {account}.")
    return check
