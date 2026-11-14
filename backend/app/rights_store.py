"""Storage for the records about people's rights: Terms acceptances and export/deletion requests.

Collections `terms_acceptances` and `data_requests` (MongoDB), with the usual in-memory fallback. Rows hold ids,
versions, timestamps and counts only: never the content of an export and never an email address."""
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

from pymongo import ASCENDING, DESCENDING

from . import db

_mem: dict[str, list[dict]] = {"terms_acceptances": [], "data_requests": []}


def reset_memory() -> None:
    for rows in _mem.values():
        rows.clear()


def now() -> datetime:
    return datetime.now(timezone.utc)


def _clean(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    out = deepcopy({k: v for k, v in doc.items() if k != "_id"})
    for k, v in out.items():
        if isinstance(v, datetime) and v.tzinfo is None:
            out[k] = v.replace(tzinfo=timezone.utc)
    return out


async def ensure_indexes() -> None:
    if not db.enabled():
        return
    mdb = db._get_db()
    await mdb.terms_acceptances.create_index([("user_id", ASCENDING), ("accepted_at", DESCENDING)])
    await mdb.data_requests.create_index([("user_id", ASCENDING), ("requested_at", DESCENDING)])
    await mdb.data_requests.create_index([("type", ASCENDING), ("status", ASCENDING), ("scheduled_for", ASCENDING)])
    await mdb.users.create_index("id")


async def add(coll: str, fields: dict) -> dict:
    doc = {"id": uuid4().hex, **fields}
    doc["_id"] = doc["id"]
    if not db.enabled():
        _mem[coll].append(deepcopy(doc))
    else:
        await db._get_db()[coll].insert_one(doc)
    return _clean(doc)


async def list_for(coll: str, user_id: str, **match) -> list[dict]:
    query = {"user_id": user_id, **match}
    if not db.enabled():
        rows = [d for d in _mem[coll] if all(d.get(k) == v for k, v in query.items())]
        key = "accepted_at" if coll == "terms_acceptances" else "requested_at"
        return [_clean(d) for d in sorted(rows, key=lambda d: d[key], reverse=True)]
    key = "accepted_at" if coll == "terms_acceptances" else "requested_at"
    return [_clean(d) async for d in db._get_db()[coll].find(query).sort(key, DESCENDING)]


async def update(coll: str, item_id: str, fields: dict) -> dict | None:
    if not db.enabled():
        for d in _mem[coll]:
            if d["id"] == item_id:
                d.update(deepcopy(fields))
                return _clean(d)
        return None
    doc = await db._get_db()[coll].find_one_and_update({"_id": item_id}, {"$set": fields}, return_document=True)
    return _clean(doc)


async def due_deletions(at: datetime) -> list[dict]:
    query = {"type": "deletion", "status": "scheduled"}
    if not db.enabled():
        return [_clean(d) for d in _mem["data_requests"]
                if all(d.get(k) == v for k, v in query.items()) and d["scheduled_for"] <= at]
    return [_clean(d) async for d in db._get_db().data_requests.find({**query, "scheduled_for": {"$lte": at}})]
