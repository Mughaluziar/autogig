"""Persistence for the freelancer pool: MongoDB, with the usual in-memory fallback.

Collections
  pool_specs      a piece of work an agency broadcasts to the pool
  pool_bids       one bid per (spec, freelancer): hours x rate
  pool_contracts  created when the agency awards a bid; holds the milestones
  pool_earnings   one row per approved milestone; paid when the agency records it
  pool_threads    one conversation per (spec, freelancer) between the freelancer and the spec's agency
  pool_messages   the messages in a thread, numbered 1, 2, 3... by `seq` within the thread

Queries are equality-only so the same call works in memory and in MongoDB, except
the few message helpers at the end, which page and count by `seq`.
Money is stored as integer cents.
"""
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

from pymongo import ASCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from .. import db

COLLECTIONS = ("specs", "bids", "contracts", "earnings", "threads", "messages")
# One row per these fields (a unique index in MongoDB, checked by hand in memory).
_UNIQUE = {"bids": ("spec_id", "freelancer_id"), "threads": ("spec_id", "freelancer_id")}
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
    await mdb.pool_threads.create_index([("spec_id", ASCENDING), ("freelancer_id", ASCENDING)], unique=True)
    await mdb.pool_threads.create_index("owner_id")
    await mdb.pool_threads.create_index("freelancer_id")
    await mdb.pool_messages.create_index([("thread_id", ASCENDING), ("seq", ASCENDING)])
    # A retried send carries the same client id: the second insert is refused instead of duplicating the message.
    await mdb.pool_messages.create_index([("thread_id", ASCENDING), ("client_id", ASCENDING)], unique=True,
                                         partialFilterExpression={"client_id": {"$type": "string"}})
    await mdb.pool_messages.create_index("owner_id")
    await mdb.pool_messages.create_index("freelancer_id")


def _duplicate_in_memory(coll: str, doc: dict) -> bool:
    keys = _UNIQUE.get(coll)
    if keys and any(all(d.get(k) == doc.get(k) for k in keys) for d in _mem[coll].values()):
        return True
    if coll == "messages" and isinstance(doc.get("client_id"), str):
        return any(d["thread_id"] == doc["thread_id"] and d.get("client_id") == doc["client_id"]
                   for d in _mem["messages"].values())
    return False


async def insert(coll: str, fields: dict) -> dict | None:
    """Insert; None when a unique index (one bid or thread per spec and freelancer, one message per client id)
    says it exists."""
    doc = {"id": uuid4().hex, **fields, "created_at": now()}
    doc["_id"] = doc["id"]
    if not db.enabled():
        if _duplicate_in_memory(coll, doc):
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


# --------------------------------------------------------------------------- #
# Message threads: counters and paging by `seq`
# --------------------------------------------------------------------------- #
async def increment(coll: str, item_id: str, counter: str, fields: dict) -> dict | None:
    """Atomically add 1 to `counter` and set `fields` in the same write; returns the document after it. Two
    concurrent calls always get different counter values, and the fields left behind are the ones written with
    the highest value."""
    if not db.enabled():
        doc = _mem[coll].get(item_id)
        if doc is None:
            return None
        doc[counter] = doc.get(counter, 0) + 1
        doc.update(deepcopy(fields))
        return _clean(doc)
    return _clean(await db._get_db()[_name(coll)].find_one_and_update(
        {"_id": item_id}, {"$inc": {counter: 1}, "$set": fields}, return_document=ReturnDocument.AFTER))


async def raise_to(coll: str, item_id: str, field: str, value: int) -> dict | None:
    """Set `field` to `value` unless it is already higher (a read marker never moves backwards)."""
    if not db.enabled():
        doc = _mem[coll].get(item_id)
        if doc is None:
            return None
        doc[field] = max(doc.get(field, 0), value)
        return _clean(doc)
    return _clean(await db._get_db()[_name(coll)].find_one_and_update(
        {"_id": item_id}, {"$max": {field: value}}, return_document=ReturnDocument.AFTER))


async def find_messages(thread_id: str, *, before: int | None = None, after: int | None = None,
                        limit: int = 50) -> list[dict]:
    """Messages of one thread in `seq` order (oldest first). `after`: the next ones after that seq (polling for
    new messages). `before`: the `limit` messages just before that seq (loading older history). Neither: the
    latest `limit`."""
    query: dict = {"thread_id": thread_id}
    if after is not None:
        query["seq"] = {"$gt": after}
    elif before is not None:
        query["seq"] = {"$lt": before}
    newest_first = after is None
    if not db.enabled():
        rows = [d for d in _mem["messages"].values() if d["thread_id"] == thread_id and isinstance(d.get("seq"), int)
                and (after is None or d["seq"] > after) and (before is None or after is not None or d["seq"] < before)]
        rows.sort(key=lambda d: d["seq"], reverse=newest_first)
        rows = rows[:limit]
    else:
        cursor = db._get_db().pool_messages.find(query).sort("seq", -1 if newest_first else 1).limit(limit)
        rows = [d async for d in cursor]
    if newest_first:
        rows.reverse()
    return [_clean(d) for d in rows]


async def count_unread(thread_id: str, after_seq: int, reader_id: str) -> int:
    """Messages in the thread after `after_seq` that someone other than the reader sent."""
    if not db.enabled():
        return sum(1 for d in _mem["messages"].values() if d["thread_id"] == thread_id
                   and isinstance(d.get("seq"), int) and d["seq"] > after_seq and d.get("sender_id") != reader_id)
    return await db._get_db().pool_messages.count_documents(
        {"thread_id": thread_id, "seq": {"$gt": after_seq}, "sender_id": {"$ne": reader_id}})
