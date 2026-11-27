"""Daily money limits, enforced atomically in the database. SIMULATED money; real limits all the same.

Collection
  capital_daily_limits   one document per (user, limit kind, UTC day): `total` cents reserved and `refs`, the
                         idempotency keys of the requests that reserved it. Expires 3 days after the day starts.

`reserve` is one conditional update: it adds the amount only while `total + amount <= cap` and only if this request's
key isn't already in `refs`. Two simultaneous requests can't both slip under the cap, and a retried request (same key)
is counted once. A request that reserved and then failed (for example, not enough balance) gives its amount back with
`release`. A crash between reserving and posting leaves the amount counted until the day ends: the limit errs on the
strict side, and a retry with the same key reuses that reservation instead of counting again.

Days are UTC calendar days, the same as the debit card's daily limit.
"""
import threading
from datetime import datetime, timedelta, timezone

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from .. import db

COLL = "capital_daily_limits"
RETENTION = timedelta(days=3)

_mem: dict[str, dict] = {}
_mem_lock = threading.Lock()


def reset_memory() -> None:
    _mem.clear()


def today(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).strftime("%Y-%m-%d")


def _key(user_id: str, kind: str, day: str) -> str:
    return f"{user_id}:{kind}:{day}"


async def ensure_indexes() -> None:
    if not db.enabled():
        return
    coll = db._get_db()[COLL]
    await coll.create_index("expires_at", expireAfterSeconds=0)
    await coll.create_index("user_id")


async def reserve(user_id: str, kind: str, amount: int, cap: int, ref: str, *, day: str | None = None) -> bool:
    """Count `amount` against today's `cap` for this user and kind, once per `ref`. False when it would go over."""
    day = day or today()
    key = _key(user_id, kind, day)
    if amount <= 0 or amount > cap:
        return False
    if not db.enabled():
        with _mem_lock:
            doc = _mem.setdefault(key, {"user_id": user_id, "kind": kind, "day": day, "total": 0, "refs": []})
            if ref in doc["refs"]:
                return True
            if doc["total"] + amount > cap:
                return False
            doc["total"] += amount
            doc["refs"].append(ref)
            return True
    coll = db._get_db()[COLL]
    claim = ({"_id": key, "refs": {"$ne": ref}, "total": {"$lte": cap - amount}},
             {"$inc": {"total": amount}, "$push": {"refs": ref}})
    if await coll.find_one_and_update(*claim, return_document=ReturnDocument.AFTER):
        return True
    if await coll.find_one({"_id": key}, {"_id": 1}):
        # Already reserved by this request (a retry), else over the cap.
        return bool(await coll.find_one({"_id": key, "refs": ref}, {"_id": 1}))
    start = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    try:
        await coll.insert_one({"_id": key, "user_id": user_id, "kind": kind, "day": day, "total": amount, "refs": [ref],
                               "expires_at": start + RETENTION})
        return True
    except DuplicateKeyError:
        # Another request created today's counter after our first try: one more atomic attempt.
        if await coll.find_one_and_update(*claim, return_document=ReturnDocument.AFTER):
            return True
        return bool(await coll.find_one({"_id": key, "refs": ref}, {"_id": 1}))


async def release(user_id: str, kind: str, amount: int, ref: str, *, day: str) -> None:
    """Give back a reservation whose request failed. Idempotent: only a `ref` still recorded is released."""
    key = _key(user_id, kind, day)
    if not db.enabled():
        with _mem_lock:
            doc = _mem.get(key)
            if doc and ref in doc["refs"]:
                doc["refs"].remove(ref)
                doc["total"] = max(0, doc["total"] - amount)
        return
    await db._get_db()[COLL].update_one({"_id": key, "refs": ref}, {"$inc": {"total": -amount}, "$pull": {"refs": ref}})


async def used(user_id: str, kind: str, *, day: str | None = None) -> int:
    key = _key(user_id, kind, day or today())
    if not db.enabled():
        return int((_mem.get(key) or {}).get("total") or 0)
    doc = await db._get_db()[COLL].find_one({"_id": key}, {"total": 1})
    return int((doc or {}).get("total") or 0)
