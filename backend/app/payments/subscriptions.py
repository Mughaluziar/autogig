"""Plan subscriptions bought through Stripe Checkout — MongoDB, with the same
in-memory fallback as repo.py.

Collection
  subscriptions   one document per user (`_id` = user id): the Stripe customer
                  and subscription ids, plan, status, trial and period ends,
                  whether a trial was ever used (one free trial per account),
                  and the Stripe event / session ids already applied, so
                  webhook retries are no-ops.

The plan and credits themselves stay in repo.py's billing document; this only
remembers how they were paid for.
"""
from copy import deepcopy
from datetime import datetime, timezone

from .. import db

_mem: dict[str, dict] = {}
_MAX_SEEN = 200

EMPTY = {
    "customer_id": None, "subscription_id": None, "plan": None, "status": None,
    "trial_end": None, "current_period_end": None, "cancel_at_period_end": False,
    "trial_used": False, "seen": [],
}


def reset_memory() -> None:
    _mem.clear()


def now() -> datetime:
    return datetime.now(timezone.utc)


def _coll():
    return db._get_db().subscriptions


async def ensure_indexes() -> None:
    if not db.enabled():
        return
    await _coll().create_index("subscription_id", sparse=True)
    await _coll().create_index("customer_id", sparse=True)


def _clean(doc: dict | None) -> dict:
    out = {**deepcopy(EMPTY), **{k: v for k, v in (doc or {}).items() if k != "_id"}}
    return out


async def get(user_id: str) -> dict:
    if not db.enabled():
        return _clean(_mem.get(user_id))
    return _clean(await _coll().find_one({"_id": user_id}))


async def find_user_by_subscription(subscription_id: str) -> str | None:
    if not subscription_id:
        return None
    if not db.enabled():
        return next((uid for uid, d in _mem.items() if d.get("subscription_id") == subscription_id), None)
    doc = await _coll().find_one({"subscription_id": subscription_id}, {"_id": 1})
    return doc["_id"] if doc else None


async def update(user_id: str, fields: dict) -> dict:
    if not db.enabled():
        doc = _mem.setdefault(user_id, deepcopy(EMPTY))
        doc.update(deepcopy(fields))
        return _clean(doc)
    await _coll().update_one({"_id": user_id}, {"$set": fields}, upsert=True)
    return await get(user_id)


async def claim(user_id: str, key: str) -> bool:
    """Record that an event/session was applied. True only for the first call
    with this key, so a retried webhook changes nothing."""
    if not key:
        return True
    if not db.enabled():
        doc = _mem.setdefault(user_id, deepcopy(EMPTY))
        if key in doc["seen"]:
            return False
        doc["seen"] = (doc["seen"] + [key])[-_MAX_SEEN:]
        return True
    res = await _coll().update_one(
        {"_id": user_id, "seen": {"$ne": key}},
        {"$push": {"seen": {"$each": [key], "$slice": -_MAX_SEEN}}},
        upsert=False,
    )
    if res.matched_count:
        return True
    # No document yet (first event for this user) or already seen.
    existing = await _coll().find_one({"_id": user_id}, {"seen": 1})
    if existing is None:
        try:
            await _coll().insert_one({**deepcopy(EMPTY), "_id": user_id, "seen": [key]})
            return True
        except Exception:
            return await claim(user_id, key)
    return False
