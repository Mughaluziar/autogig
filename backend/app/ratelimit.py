"""Per-IP request budgets, shared by every API instance.

Two budgets per client address: a general one (a few hundred requests a minute) and a much tighter one for credential
endpoints (login, signup, reset...). With MongoDB (the production setting) the counters live in the `rate_limits`
collection, so a second instance, a restart or a deploy neither resets nor doubles a budget:

  general  a fixed one-minute window counter: one atomic upsert per request (`$inc`), the document expires on its own
           (TTL index). A burst straddling a window boundary can briefly reach twice the limit; that is acceptable for
           abuse protection and it keeps each request to a single tiny write.
  auth     an exact sliding log: the last <= limit+1 timestamps in one document, updated atomically by a single
           aggregation-pipeline update, so "20 attempts per minute" is exact on every instance.

Without MongoDB (local development, tests) the counters are in process memory, as before. If MongoDB errors while it is
the configured store, the request is counted in process memory instead and a warning is logged (degraded, never open).
Setting RATE_LIMIT_BACKEND=memory in production requires SINGLE_INSTANCE=true (config.production_problems)."""
import logging
import time
from collections import defaultdict, deque

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from . import db
from .config import get_settings

log = logging.getLogger("autopilot.ratelimit")

WINDOW = 60.0
_hits: dict[str, deque] = defaultdict(deque)        # general budget, in memory (also the degraded fallback)
_auth_hits: dict[str, deque] = defaultdict(deque)   # credential budget, in memory
_last_warning = 0.0


def backend() -> str:
    """"mongo" or "memory": what is actually used right now."""
    choice = get_settings().rate_limit_backend.strip().lower() or "auto"
    if choice == "memory":
        return "memory"
    return "mongo" if db.enabled() else "memory"


def reset_memory() -> None:
    _hits.clear()
    _auth_hits.clear()


async def ensure_indexes() -> None:
    if not db.enabled():
        return
    await db._get_db().rate_limits.create_index("expire_at", expireAfterSeconds=0)


def _memory(q: deque, now: float, limit: int, record: bool = True) -> tuple[bool, int]:
    while q and now - q[0] > WINDOW:
        q.popleft()
    if len(q) >= limit:
        return False, max(1, int(WINDOW - (now - q[0])))
    if record:
        q.append(now)
    return True, 0


def _degraded(err: Exception) -> None:
    global _last_warning
    if time.monotonic() - _last_warning > 60:
        _last_warning = time.monotonic()
        log.warning("Rate-limit store unavailable (%s); counting in process memory until it recovers.", type(err).__name__)


async def _fixed_window(key: str, limit: int, now: float) -> tuple[bool, int]:
    window = int(now // WINDOW)
    coll = db._get_db().rate_limits
    doc_id = f"g:{key}:{window}"
    expire = _datetime(now + 2 * WINDOW)
    for attempt in (0, 1):
        try:
            doc = await coll.find_one_and_update(
                {"_id": doc_id}, {"$inc": {"n": 1}, "$setOnInsert": {"expire_at": expire}},
                upsert=True, return_document=ReturnDocument.AFTER)
            break
        except DuplicateKeyError:           # two instances created the window at once: the second update just increments
            if attempt:
                raise
    allowed = doc["n"] <= limit
    return allowed, 0 if allowed else max(1, int((window + 1) * WINDOW - now))


async def _sliding_log(key: str, limit: int, now: float) -> tuple[bool, int]:
    """Exact: keep the timestamps of the last `limit` allowed attempts within the window; the attempt is allowed when
    fewer than `limit` of them remain. One atomic pipeline update, so concurrent instances cannot both take the last slot."""
    coll = db._get_db().rate_limits
    cutoff = now - WINDOW
    recent = {"$filter": {"input": {"$ifNull": ["$hits", []]}, "cond": {"$gt": ["$$this", cutoff]}}}
    doc = await coll.find_one_and_update(
        {"_id": f"a:{key}"},
        [{"$set": {
            "hits": {"$cond": [
                {"$lt": [{"$size": recent}, limit]},
                {"$concatArrays": [recent, [now]]},                 # room left: take a slot
                recent,                                             # full: record nothing (a blocked caller isn't extended)
            ]},
            "full": {"$gte": [{"$size": recent}, limit]},
            "expire_at": _datetime(now + 2 * WINDOW),
        }}],
        upsert=True, return_document=ReturnDocument.AFTER)
    if not doc["full"]:
        return True, 0
    oldest = min(doc["hits"]) if doc["hits"] else now
    return False, max(1, int(WINDOW - (now - oldest)) + 1)


def _datetime(ts: float):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, tz=timezone.utc)


async def allow(kind: str, ip: str, limit: int, now: float | None = None) -> tuple[bool, int]:
    """(allowed, retry_after_seconds). kind: "general" or "auth"."""
    limit = max(int(limit), 1)
    if backend() == "mongo":
        stamp = time.time() if now is None else now
        try:
            return await (_fixed_window(ip, limit, stamp) if kind == "general" else _sliding_log(ip, limit, stamp))
        except Exception as err:       # noqa: BLE001 - a store outage must degrade, not take the API down
            _degraded(err)
    mono = time.monotonic() if now is None else now
    return _memory(_hits[ip] if kind == "general" else _auth_hits[ip], mono, limit)
