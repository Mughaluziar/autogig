"""Pay-link persistence — MongoDB, with the same in-memory fallback as repo.py.

Collection
  pay_links   one document per (user, invoice). `token` is the public,
              unguessable handle the pay page uses. Amounts are integer cents.
              `version` gives compare-and-set updates, so the owner refreshing
              the snapshot can't overwrite a milestone the webhook just marked
              paid. A milestone paid online is never changed afterwards.

Every per-user query filters by user_id. Lookups by token serve the public
pay page and the Stripe webhook, which carry no session.
"""
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from .. import db

_mem: list[dict] = []


def reset_memory() -> None:
    _mem.clear()


def now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value):
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _clean(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    out = deepcopy({k: v for k, v in doc.items() if k != "_id"})
    for k, v in out.items():
        out[k] = _aware(v)
    for m in out.get("milestones") or []:
        for k, v in m.items():
            m[k] = _aware(v)
    return out


def _coll():
    return db._get_db().pay_links


async def ensure_indexes() -> None:
    if not db.enabled():
        return
    await _coll().create_index([("user_id", ASCENDING), ("invoice_id", ASCENDING)], unique=True)
    await _coll().create_index("token", unique=True)
    await _coll().create_index([("user_id", ASCENDING), ("updated_at", DESCENDING)])


async def get_for_invoice(user_id: str, invoice_id: str) -> dict | None:
    if not db.enabled():
        return _clean(next((d for d in _mem if d["user_id"] == user_id and d["invoice_id"] == invoice_id), None))
    return _clean(await _coll().find_one({"user_id": user_id, "invoice_id": invoice_id}))


async def get_by_token(token: str) -> dict | None:
    if not db.enabled():
        return _clean(next((d for d in _mem if d["token"] == token), None))
    return _clean(await _coll().find_one({"token": token}))


async def list_for_user(user_id: str) -> list[dict]:
    if not db.enabled():
        mine = [d for d in _mem if d["user_id"] == user_id]
        return [_clean(d) for d in sorted(mine, key=lambda d: d["updated_at"], reverse=True)]
    cursor = _coll().find({"user_id": user_id}).sort("updated_at", DESCENDING)
    return [_clean(d) async for d in cursor]


async def insert(doc: dict) -> dict | None:
    """Insert a new link. None when one already exists for this invoice
    (a concurrent request won), so the caller re-reads and updates."""
    doc = {**doc, "id": uuid4().hex, "version": 1, "created_at": now(), "updated_at": now()}
    doc["_id"] = doc["id"]
    if not db.enabled():
        if any(d["user_id"] == doc["user_id"] and d["invoice_id"] == doc["invoice_id"] for d in _mem):
            return None
        _mem.append(deepcopy(doc))
        return _clean(doc)
    try:
        await _coll().insert_one(doc)
    except DuplicateKeyError:
        return None
    return _clean(doc)


async def update(user_id: str, link_id: str, fields: dict, *, expect_version: int) -> dict | None:
    """Compare-and-set: applies only while the stored version is unchanged.
    None means someone else (usually the webhook) wrote first."""
    fields = {**fields, "updated_at": now()}
    if not db.enabled():
        for d in _mem:
            if d["id"] == link_id and d["user_id"] == user_id:
                if d["version"] != expect_version:
                    return None
                d.update(deepcopy(fields))
                d["version"] += 1
                return _clean(d)
        return None
    doc = await _coll().find_one_and_update(
        {"_id": link_id, "user_id": user_id, "version": expect_version},
        {"$set": fields, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER,
    )
    return _clean(doc)


async def mark_milestone_paid(token: str, milestone_id: str, fields: dict) -> dict | None:
    """Mark one due milestone paid. Atomic and idempotent: returns the updated
    link only for the call that flipped it; None if it was already paid or
    doesn't exist."""
    stamp = now()
    if not db.enabled():
        for d in _mem:
            if d["token"] != token:
                continue
            for m in d["milestones"]:
                if m["id"] == milestone_id and m["status"] == "due":
                    m.update(deepcopy(fields), status="paid")
                    d["version"] += 1
                    d["updated_at"] = stamp
                    return _clean(d)
            return None
        return None
    sets = {f"milestones.$.{k}": v for k, v in fields.items()}
    doc = await _coll().find_one_and_update(
        {"token": token, "milestones": {"$elemMatch": {"id": milestone_id, "status": "due"}}},
        {"$set": {**sets, "milestones.$.status": "paid", "updated_at": stamp}, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER,
    )
    return _clean(doc)


async def add_extra_payment(token: str, record: dict) -> None:
    """A payment that arrived for a milestone already paid (the client paid
    twice). Kept so the owner can refund it from Stripe."""
    if not db.enabled():
        for d in _mem:
            if d["token"] == token:
                d.setdefault("extra_payments", []).append(deepcopy(record))
                d["updated_at"] = now()
        return
    await _coll().update_one({"token": token}, {"$push": {"extra_payments": record}, "$set": {"updated_at": now()}})


async def deactivate(user_id: str, invoice_id: str) -> bool:
    if not db.enabled():
        for d in _mem:
            if d["user_id"] == user_id and d["invoice_id"] == invoice_id:
                d["active"] = False
                d["version"] += 1
                d["updated_at"] = now()
                return True
        return False
    res = await _coll().update_one(
        {"user_id": user_id, "invoice_id": invoice_id},
        {"$set": {"active": False, "updated_at": now()}, "$inc": {"version": 1}},
    )
    return res.matched_count > 0
