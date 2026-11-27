"""Wallet activity: every movement of a user's Autopilot USD and USDC balances, with running balances. SIMULATED.

A view derived from the capital ledger (the only source of truth), so filtering, paging, totals and CSV export run in
the database with indexes instead of replaying the user's whole journal on every request.

Collections
  wallet_activity          one row per ledger entry that changes the user's wallet:<id> or usdc:<id> balance
                           (_id "<user>:<seq>"): kind, category, memo, the USD and USDC change and the balances after.
  wallet_activity_cursors  per user: the last ledger seq folded in and the balances at that point.

`sync` catches a user's view up from their cursor, reading only newer entries through the (refs.*, seq) indexes. It
runs before every read, so the view is never behind the ledger. It is safe to run concurrently and to interrupt: rows
have fixed ids and identical content whoever computes them, and the cursor only moves forward, after its rows exist.
The first read for a user with older activity builds their view once (a backfill).

Like the old in-request replay, running balances count the entries that name the user in refs.user_id or refs.users,
which every posting that moves a user's wallet does.
"""
import re
from datetime import datetime, timezone

from pymongo import ASCENDING, DESCENDING, ReplaceOne
from pymongo.errors import DuplicateKeyError

from .. import db
from . import ledger

COLL = "wallet_activity"
CURSORS = "wallet_activity_cursors"
_BATCH = 500

# Ledger entry kind -> category shown and filtered in the history. Unknown kinds land in "other".
CATEGORIES = ("bank", "crypto", "member", "card", "investing", "other")
_CATEGORY = {
    "bank_deposit": "bank", "bank_withdraw": "bank",
    "bank_to_usdc": "crypto", "bank_to_usd": "crypto", "bank_crypto_send": "crypto", "bank_crypto_receive": "crypto",
    "bank_internal_send": "member",
    "card_purchase": "card", "card_refund": "card",
    "investor_deposit": "investing", "investor_withdrawal": "investing", "advance_payout_wallet": "investing",
}

_mem_rows: dict[str, dict[int, dict]] = {}
_mem_cursors: dict[str, dict] = {}


def reset_memory() -> None:
    _mem_rows.clear()
    _mem_cursors.clear()


def category_of(kind: str) -> str:
    if kind in _CATEGORY:
        return _CATEGORY[kind]
    return "investing" if kind.startswith("market_") else "other"


async def ensure_indexes() -> None:
    if not db.enabled():
        return
    coll = db._get_db()[COLL]
    await coll.create_index([("user_id", ASCENDING), ("seq", DESCENDING)])
    await coll.create_index([("user_id", ASCENDING), ("category", ASCENDING), ("seq", DESCENDING)])
    await coll.create_index([("user_id", ASCENDING), ("at", DESCENDING)])


# --------------------------------------------------------------------------- #
# Building the view
# --------------------------------------------------------------------------- #
def _fold(user_id: str, entries: list[dict], usd: int, usdc: int) -> tuple[list[dict], int, int]:
    wallet, usdc_account = f"wallet:{user_id}", f"usdc:{user_id}"
    rows = []
    for entry in entries:
        d_usd = sum(i["amount"] for i in entry["lines"] if i["account"] == wallet and i["unit"] == "USD")
        d_usdc = sum(i["amount"] for i in entry["lines"] if i["account"] == usdc_account and i["unit"] == "USD")
        if not d_usd and not d_usdc:
            continue
        usd, usdc = usd + d_usd, usdc + d_usdc
        at = entry["at"]
        if isinstance(at, str):
            at = datetime.strptime(at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        rows.append({"_id": f"{user_id}:{entry['seq']}", "user_id": user_id, "seq": entry["seq"], "at": at,
                     "kind": entry["kind"], "category": category_of(entry["kind"]), "memo": entry["memo"],
                     "usd_cents": d_usd, "usdc_cents": d_usdc, "net_cents": d_usd + d_usdc,
                     "balance_usd_cents": usd, "balance_usdc_cents": usdc})
    return rows, usd, usdc


async def sync(user_id: str) -> None:
    """Fold the user's ledger entries newer than their cursor into the view."""
    while True:
        if not db.enabled():
            cur = _mem_cursors.get(user_id) or {"seq": 0, "usd": 0, "usdc": 0}
        else:
            cur = await db._get_db()[CURSORS].find_one({"_id": user_id}) or {"seq": 0, "usd": 0, "usdc": 0}
        entries = await ledger.user_entries_after(user_id, cur["seq"], limit=_BATCH)
        if not entries:
            return
        rows, usd, usdc = _fold(user_id, entries, cur["usd"], cur["usdc"])
        last = entries[-1]["seq"]
        if not db.enabled():
            mine = _mem_rows.setdefault(user_id, {})
            for row in rows:
                mine[row["seq"]] = row
            if last > (_mem_cursors.get(user_id) or {}).get("seq", 0):
                _mem_cursors[user_id] = {"seq": last, "usd": usd, "usdc": usdc}
        else:
            mdb = db._get_db()
            if rows:
                await mdb[COLL].bulk_write([ReplaceOne({"_id": r["_id"]}, r, upsert=True) for r in rows], ordered=False)
            try:
                await mdb[CURSORS].update_one({"_id": user_id, "seq": {"$lt": last}},
                                              {"$set": {"seq": last, "usd": usd, "usdc": usdc}}, upsert=True)
            except DuplicateKeyError:
                pass  # another reader already moved the cursor at least this far
        if len(entries) < _BATCH:
            return


# --------------------------------------------------------------------------- #
# Reading it
# --------------------------------------------------------------------------- #
def filters(*, currency: str | None = None, direction: str | None = None, category: str | None = None,
            since: datetime | None = None, until: datetime | None = None, search: str | None = None) -> dict:
    """Validated filters (the caller checks the values). `until` is exclusive."""
    return {"field": {"usd": "usd_cents", "usdc": "usdc_cents"}.get(currency or "", "net_cents"),
            "currency": bool(currency), "direction": direction or None, "category": category or None,
            "since": since, "until": until, "needle": " ".join((search or "").lower().split())[:80] or None}


def _query(user_id: str, f: dict, before: int | None = None) -> dict:
    q: dict = {"user_id": user_id}
    if f["direction"] == "in":
        q[f["field"]] = {"$gt": 0}
    elif f["direction"] == "out":
        q[f["field"]] = {"$lt": 0}
    elif f["currency"]:
        q[f["field"]] = {"$ne": 0}
    if f["category"]:
        q["category"] = f["category"]
    if f["since"] or f["until"]:
        q["at"] = {**({"$gte": f["since"]} if f["since"] else {}), **({"$lt": f["until"]} if f["until"] else {})}
    if f["needle"]:
        q["memo"] = {"$regex": re.escape(f["needle"]), "$options": "i"}
    if before is not None:
        q["seq"] = {"$lt": before}
    return q


def _matches(row: dict, f: dict, before: int | None = None) -> bool:
    """The same test as _query, for memory mode."""
    value = row[f["field"]]
    if f["direction"] == "in" and value <= 0 or f["direction"] == "out" and value >= 0:
        return False
    if f["currency"] and not value:
        return False
    if f["category"] and row["category"] != f["category"]:
        return False
    if f["since"] and row["at"] < f["since"] or f["until"] and row["at"] >= f["until"]:
        return False
    if f["needle"] and f["needle"] not in row["memo"].lower():
        return False
    return before is None or row["seq"] < before


def _mem_newest_first(user_id: str) -> list[dict]:
    rows = _mem_rows.get(user_id) or {}
    return [rows[s] for s in sorted(rows, reverse=True)]


async def page(user_id: str, f: dict, *, before: int | None = None, limit: int = 50) -> tuple[list[dict], bool]:
    """Newest first, at most `limit` rows with seq < before, and whether more follow."""
    await sync(user_id)
    if not db.enabled():
        rows = [r for r in _mem_newest_first(user_id) if _matches(r, f, before)][:limit + 1]
    else:
        cursor = db._get_db()[COLL].find(_query(user_id, f, before)).sort("seq", DESCENDING).limit(limit + 1)
        rows = [r async for r in cursor]
    return rows[:limit], len(rows) > limit


async def totals(user_id: str, f: dict) -> dict:
    """Count, money in and money out over every row matching the filters (all pages). Call after sync/page."""
    if not db.enabled():
        rows = [r for r in _mem_newest_first(user_id) if _matches(r, f)]
        return {"count": len(rows),
                "in": sum(max(0, r["usd_cents"]) + max(0, r["usdc_cents"]) for r in rows),
                "out": -sum(min(0, r["usd_cents"]) + min(0, r["usdc_cents"]) for r in rows)}
    pipeline = [{"$match": _query(user_id, f)}, {"$group": {
        "_id": None, "count": {"$sum": 1},
        "in": {"$sum": {"$add": [{"$max": [0, "$usd_cents"]}, {"$max": [0, "$usdc_cents"]}]}},
        "out": {"$sum": {"$add": [{"$min": [0, "$usd_cents"]}, {"$min": [0, "$usdc_cents"]}]}}}}]
    found = [d async for d in db._get_db()[COLL].aggregate(pipeline)]
    if not found:
        return {"count": 0, "in": 0, "out": 0}
    return {"count": found[0]["count"], "in": found[0]["in"], "out": -found[0]["out"]}


async def every(user_id: str, f: dict):
    """Every matching row, newest first, read in batches (for the CSV export: complete, never truncated)."""
    await sync(user_id)
    if not db.enabled():
        for row in [r for r in _mem_newest_first(user_id) if _matches(r, f)]:
            yield row
        return
    async for row in db._get_db()[COLL].find(_query(user_id, f)).sort("seq", DESCENDING).batch_size(1000):
        yield row


def view(row: dict) -> dict:
    return {"seq": row["seq"], "at": row["at"].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            if row["at"].tzinfo else row["at"].strftime("%Y-%m-%dT%H:%M:%SZ"),
            "kind": row["kind"], "category": row["category"], "memo": row["memo"],
            "usdCents": row["usd_cents"], "usdcCents": row["usdc_cents"],
            "balanceUsdCents": row["balance_usd_cents"], "balanceUsdcCents": row["balance_usdc_cents"]}
