"""Persistence for the freelancer pool: MongoDB, with the usual in-memory fallback.

Collections
  pool_specs      a piece of work an agency broadcasts to the pool
  pool_bids       one bid per (spec, freelancer): hours x rate
  pool_contracts  created when the agency awards a bid; holds the milestones
  pool_earnings   one row per approved milestone; paid when the agency records it

Queries are equality-only so the same call works in memory and in MongoDB.
Money is stored as integer cents.
"""
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

from pymongo import ASCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from .. import db

COLLECTIONS = ("specs", "bids", "contracts", "earnings")
_mem: dict[str, dict[str, dict]] = {c: {} for c in COLLECTIONS}


def reset_memory() -> None:
    for items in _mem.values():
        items.clear()


def now() -> datetime:
    return datetime.now(timezone.utc)


def _name(coll: str) -> str:
    return f"pool_{coll}"


def _clean(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    out = deepcopy({k: v for k, v in doc.items() if k != "_id"})
    for key, value in out.items():
        if isinstance(value, datetime):
            out[key] = (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return out


async def ensure_indexes() -> None:
    if not db.enabled():
        return
    mdb = db._get_db()
    await mdb.pool_bids.create_index([("spec_id", ASCENDING), ("freelancer_id", ASCENDING)], unique=True)
    await mdb.pool_specs.create_index([("status", ASCENDING), ("created_at", ASCENDING)])
    await mdb.pool_specs.create_index("owner_id")
    await mdb.pool_contracts.create_index("spec_id", unique=True)
    await mdb.pool_contracts.create_index("freelancer_id")
    await mdb.pool_contracts.create_index("owner_id")
    await mdb.pool_earnings.create_index("freelancer_id")
    await mdb.pool_earnings.create_index("owner_id")
    await mdb.pool_earnings.create_index([("contract_id", ASCENDING), ("milestone_id", ASCENDING)], unique=True)


async def insert(coll: str, fields: dict) -> dict | None:
    """Insert; None when a unique index (one bid per spec and freelancer) says it exists."""
    doc = {"id": uuid4().hex, **fields, "created_at": now()}
    doc["_id"] = doc["id"]
    if not db.enabled():
        if coll == "bids" and any(b["spec_id"] == doc["spec_id"] and b["freelancer_id"] == doc["freelancer_id"]
                                  for b in _mem["bids"].values()):
            return None
        if coll == "contracts" and any(c["spec_id"] == doc["spec_id"] for c in _mem["contracts"].values()):
            return None
        if coll == "earnings" and any(e["contract_id"] == doc["contract_id"] and e["milestone_id"] == doc["milestone_id"]
                                       for e in _mem["earnings"].values()):
            return None
        _mem[coll][doc["id"]] = deepcopy(doc)
        return _clean(doc)
    try:
        await db._get_db()[_name(coll)].insert_one(doc)
    except DuplicateKeyError:
        return None
    return _clean(doc)


async def get(coll: str, item_id: str) -> dict | None:
    if not db.enabled():
        return _clean(_mem[coll].get(item_id))
    return _clean(await db._get_db()[_name(coll)].find_one({"_id": item_id}))


async def find(coll: str, query: dict | None = None, limit: int = 500) -> list[dict]:
    query = query or {}
    if not db.enabled():
        rows = [d for d in _mem[coll].values() if all(d.get(k) == v for k, v in query.items())]
        rows.sort(key=lambda d: d["created_at"], reverse=True)
        return [_clean(d) for d in rows[:limit]]
    cursor = db._get_db()[_name(coll)].find(query).sort("created_at", -1).limit(limit)
    return [_clean(d) async for d in cursor]


async def count(coll: str, query: dict) -> int:
    if not db.enabled():
        return sum(1 for d in _mem[coll].values() if all(d.get(k) == v for k, v in query.items()))
    return await db._get_db()[_name(coll)].count_documents(query)


async def iter_records(coll: str, query: dict | None = None):
    """Stream records for bounded startup recovery without a 500-row page limit."""
    query = query or {}
    if not db.enabled():
        for doc in list(_mem[coll].values()):
            if all(doc.get(k) == v for k, v in query.items()):
                yield _clean(doc)
        return
    async for doc in db._get_db()[_name(coll)].find(query):
        yield _clean(doc)


async def update(coll: str, item_id: str, fields: dict, *, expect: dict | None = None) -> dict | None:
    """Set fields; with `expect` it is an atomic compare-and-set (None when it did not match)."""
    expect = expect or {}
    if not db.enabled():
        doc = _mem[coll].get(item_id)
        if doc is None or any(doc.get(k) != v for k, v in expect.items()):
            return None
        doc.update(deepcopy(fields))
        return _clean(doc)
    return _clean(await db._get_db()[_name(coll)].find_one_and_update(
        {"_id": item_id, **expect}, {"$set": fields}, return_document=ReturnDocument.AFTER))


async def delete_where(coll: str, query: dict) -> None:
    if not db.enabled():
        for key in [k for k, d in _mem[coll].items() if all(d.get(f) == v for f, v in query.items())]:
            _mem[coll].pop(key)
        return
    await db._get_db()[_name(coll)].delete_many(query)
