"""Stripe webhook event log — MongoDB, with the same in-memory fallback as repo.py.

Collection
  stripe_events   one document per Stripe event id (`_id`): event type, livemode, when it arrived, what the webhook
                  did with it (outcome), how many times it ran and how often Stripe re-sent it after that, and the
                  ids of the Stripe objects involved (payment intent, charge, subscription, invoice...). No names,
                  emails, amounts or Autopilot user ids: it answers "did Stripe reach us, and what happened", not
                  "who paid". Expires 90 days after arrival (TTL index).

A repeated event id is answered as a duplicate without running any handler again, unless the earlier attempt
failed (outcome "error") or never finished (a crash mid-way), in which case the retry takes it over. The handlers
stay idempotent on their own as well (Stripe can describe the same change in two different events).

reset_memory and ensure_indexes are called through payments/store.py, so this log shares the pay links'
lifecycle in tests and at startup.
"""
import re
from copy import deepcopy
from datetime import datetime, timedelta, timezone

from pymongo import DESCENDING
from pymongo.errors import DuplicateKeyError

from .. import db

OUTCOMES = ("processing", "applied", "duplicate", "ignored", "rejected-amount", "error")
RETENTION = timedelta(days=90)
# A "processing" row older than this is a crashed attempt: a retry may take it over.
_STALE = timedelta(minutes=5)
_MEM_MAX = 2000
_ID_RE = re.compile(r"^[A-Za-z0-9_]{3,255}$")
# Stripe object ids worth keeping for "find it in the Stripe Dashboard"; customer ids are left out on purpose.
_REF_KEYS = ("payment_intent", "charge", "subscription", "invoice")
# Keys a handler's response carries when it changed something.
_APPLIED_KEYS = ("paid", "extra", "plan", "pack", "status", "refunded", "dispute", "pastDue", "reopened")

_mem: dict[str, dict] = {}


def reset_memory() -> None:
    _mem.clear()


def now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value):
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _coll():
    return db._get_db().stripe_events


async def ensure_indexes() -> None:
    if not db.enabled():
        return
    await _coll().create_index("received_at", expireAfterSeconds=int(RETENTION.total_seconds()))


def _stripe_id(value) -> str | None:
    if isinstance(value, dict):
        value = value.get("id")
    return value if isinstance(value, str) and _ID_RE.match(value) else None


def refs_of(event: dict) -> dict:
    """Ids of the Stripe objects an event is about. Nothing else from the payload is kept."""
    obj = (event.get("data") or {}).get("object") or {}
    if not isinstance(obj, dict):
        return {}
    refs = {"object": _stripe_id(obj.get("id"))}
    for key in _REF_KEYS:
        refs[key] = _stripe_id(obj.get(key))
    return {k: v for k, v in refs.items() if v}


def outcome_of(result: dict) -> str:
    """What a handler's response says it did."""
    if result.get("duplicate"):
        return "duplicate"
    if result.get("rejected") == "amount":
        return "rejected-amount"
    if any(result.get(k) for k in _APPLIED_KEYS):
        return "applied"
    return "ignored"


def _prune(stamp: datetime) -> None:
    cutoff = stamp - RETENTION
    for key in [k for k, d in _mem.items() if d["received_at"] < cutoff]:
        del _mem[key]
    while len(_mem) > _MEM_MAX:
        del _mem[next(iter(_mem))]


async def claim(event: dict) -> bool:
    """Start handling an event. False when this event id was already handled (or is being handled right now),
    so the caller answers "duplicate" and changes nothing."""
    event_id = str(event.get("id") or "")[:255]
    stamp = now()
    doc = {
        "_id": event_id, "type": str(event.get("type") or "")[:100], "livemode": bool(event.get("livemode")),
        "received_at": stamp, "updated_at": stamp, "outcome": "processing", "attempts": 1, "duplicates": 0,
        "refs": refs_of(event),
    }
    if not db.enabled():
        _prune(stamp)
        existing = _mem.get(event_id)
        if existing is None:
            _mem[event_id] = doc
            return True
        if existing["outcome"] == "error" or (existing["outcome"] == "processing" and existing["updated_at"] < stamp - _STALE):
            existing.update(outcome="processing", updated_at=stamp, attempts=existing["attempts"] + 1)
            return True
        existing["duplicates"] += 1
        return False
    try:
        await _coll().insert_one(doc)
        return True
    except DuplicateKeyError:
        pass
    taken = await _coll().update_one(
        {"_id": event_id, "$or": [{"outcome": "error"}, {"outcome": "processing", "updated_at": {"$lt": stamp - _STALE}}]},
        {"$set": {"outcome": "processing", "updated_at": stamp}, "$inc": {"attempts": 1}},
    )
    if taken.modified_count:
        return True
    await _coll().update_one({"_id": event_id}, {"$inc": {"duplicates": 1}})
    return False


async def finish(event_id: str, outcome: str) -> None:
    if outcome not in OUTCOMES:
        outcome = "error"
    fields = {"outcome": outcome, "updated_at": now()}
    event_id = event_id[:255]
    if not db.enabled():
        if event_id in _mem:
            _mem[event_id].update(fields)
        return
    await _coll().update_one({"_id": event_id}, {"$set": fields})


def _view(doc: dict) -> dict:
    received = _aware(doc.get("received_at"))
    return {
        "id": doc["_id"], "type": doc.get("type") or "", "livemode": bool(doc.get("livemode")),
        "receivedAt": received.isoformat() if isinstance(received, datetime) else None,
        "outcome": doc.get("outcome") or "", "attempts": int(doc.get("attempts") or 1),
        "duplicates": int(doc.get("duplicates") or 0), "refs": dict(doc.get("refs") or {}),
    }


async def recent(limit: int = 50) -> list[dict]:
    """Newest first."""
    if not db.enabled():
        rows = sorted(_mem.values(), key=lambda d: d["received_at"], reverse=True)[:limit]
        return [_view(deepcopy(d)) for d in rows]
    cursor = _coll().find({}).sort("received_at", DESCENDING).limit(limit)
    return [_view(d) async for d in cursor]
