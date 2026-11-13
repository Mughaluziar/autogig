"""Order persistence — MongoDB, with the same in-memory fallback as repo.py.

Collections
  order_accounts  connected marketplace accounts; many per platform per user
  orders          one document per (user, platform, platform order id).
                  `dedupe_key` is unique per user, so the same order reported
                  by a poll, a webhook and an email is stored once. `version`
                  gives compare-and-set updates so concurrent sources can't
                  overwrite each other.
  order_events    audit trail: detections, verification attempts, status
                  changes and sync failures (kept 400 days)

Every per-user query filters by user_id. The scheduler's cross-user queries
(due_accounts, due_verifications, expired_orders) only feed the service,
which then works per user.
"""
import re
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from .. import db

# Connection kinds that reach a platform API (see adapters/base.py).
API_CONNECTION_KINDS = ("nango", "platform_token")
EVENT_TTL = timedelta(days=400)
_MEM_EVENT_CAP = 2000

_mem: dict[str, list[dict]] = {"order_accounts": [], "orders": [], "order_events": []}


def reset_memory() -> None:
    for items in _mem.values():
        items.clear()


def now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value):
    # Mongo returns naive UTC datetimes; normalise so comparisons work.
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _clean(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    out = {k: _aware(v) for k, v in doc.items() if k != "_id"}
    return deepcopy(out)


async def ensure_indexes() -> None:
    if not db.enabled():
        return
    mdb = db._get_db()
    await mdb.order_accounts.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    # Partial, not sparse: disconnecting sets the hash to null, and a sparse
    # unique index would still index (and collide on) explicit nulls.
    await mdb.order_accounts.create_index(
        "inbound_token_hash", unique=True, name="inbound_token_hash_unique",
        partialFilterExpression={"inbound_token_hash": {"$type": "string"}})
    await mdb.order_accounts.create_index([("connection.connectionId", ASCENDING)], sparse=True)
    await mdb.order_accounts.create_index([("status", ASCENDING), ("next_sync_at", ASCENDING)])
    await mdb.orders.create_index([("user_id", ASCENDING), ("dedupe_key", ASCENDING)], unique=True)
    await mdb.orders.create_index([("user_id", ASCENDING), ("sort_at", DESCENDING)])
    await mdb.orders.create_index([("user_id", ASCENDING), ("arrived_at", DESCENDING)])
    await mdb.orders.create_index([("verification_status", ASCENDING), ("next_verify_at", ASCENDING)])
    await mdb.orders.create_index([("platform", ASCENDING), ("last_synced_at", ASCENDING)])
    await mdb.order_events.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await mdb.order_events.create_index([("user_id", ASCENDING), ("order_id", ASCENDING)])
    await mdb.order_events.create_index("created_at", expireAfterSeconds=int(EVENT_TTL.total_seconds()))


# --------------------------------------------------------------------------- #
# Accounts
# --------------------------------------------------------------------------- #
async def add_account(user_id: str, fields: dict) -> dict:
    doc = {"id": uuid4().hex, **fields, "user_id": user_id, "created_at": now()}
    doc["_id"] = doc["id"]
    if not db.enabled():
        _mem["order_accounts"].insert(0, doc)
        return _clean(doc)
    await db._get_db().order_accounts.insert_one(doc)
    return _clean(doc)


async def list_accounts(user_id: str) -> list[dict]:
    if not db.enabled():
        return [_clean(d) for d in _mem["order_accounts"] if d["user_id"] == user_id]
    cursor = db._get_db().order_accounts.find({"user_id": user_id}).sort("created_at", DESCENDING)
    return [_clean(d) async for d in cursor]


async def get_account(user_id: str, account_id: str) -> dict | None:
    if not db.enabled():
        return _clean(next((d for d in _mem["order_accounts"]
                            if d["id"] == account_id and d["user_id"] == user_id), None))
    return _clean(await db._get_db().order_accounts.find_one({"_id": account_id, "user_id": user_id}))


async def update_account(user_id: str, account_id: str, fields: dict) -> dict | None:
    if not db.enabled():
        for d in _mem["order_accounts"]:
            if d["id"] == account_id and d["user_id"] == user_id:
                d.update(deepcopy(fields))
                return _clean(d)
        return None
    doc = await db._get_db().order_accounts.find_one_and_update(
        {"_id": account_id, "user_id": user_id}, {"$set": fields}, return_document=ReturnDocument.AFTER,
    )
    return _clean(doc)


async def account_for_inbound_hash(token_hash: str) -> dict | None:
    if not db.enabled():
        return _clean(next((d for d in _mem["order_accounts"]
                            if d.get("inbound_token_hash") == token_hash and d.get("status") != "disabled"), None))
    return _clean(await db._get_db().order_accounts.find_one(
        {"inbound_token_hash": token_hash, "status": {"$ne": "disabled"}}))


async def accounts_for_connection(integration_id: str, connection_id: str) -> list[dict]:
    query = {"connection.integrationId": integration_id, "connection.connectionId": connection_id,
             "status": {"$ne": "disabled"}}
    if not db.enabled():
        return [_clean(d) for d in _mem["order_accounts"]
                if (d.get("connection") or {}).get("integrationId") == integration_id
                and (d.get("connection") or {}).get("connectionId") == connection_id
                and d.get("status") != "disabled"]
    return [_clean(d) async for d in db._get_db().order_accounts.find(query)]


async def accounts_using_connection(user_id: str, kind: str, connection_id: str) -> list[dict]:
    """This user's accounts (any status) that call the API through one connection."""
    if not db.enabled():
        return [_clean(d) for d in _mem["order_accounts"]
                if d["user_id"] == user_id and (d.get("connection") or {}).get("kind") == kind
                and (d.get("connection") or {}).get("connectionId") == connection_id]
    cursor = db._get_db().order_accounts.find(
        {"user_id": user_id, "connection.kind": kind, "connection.connectionId": connection_id})
    return [_clean(d) async for d in cursor]


async def due_accounts(at: datetime, limit: int = 200) -> list[dict]:
    """API-connected accounts whose next poll is due, across all users."""
    if not db.enabled():
        due = [d for d in _mem["order_accounts"]
               if d.get("status") == "active"
               and (d.get("connection") or {}).get("kind") in API_CONNECTION_KINDS
               and (d.get("next_sync_at") is None or _aware(d["next_sync_at"]) <= at)]
        return [_clean(d) for d in due[:limit]]
    cursor = db._get_db().order_accounts.find({
        "status": "active", "connection.kind": {"$in": list(API_CONNECTION_KINDS)},
        "$or": [{"next_sync_at": None}, {"next_sync_at": {"$lte": at}}],
    }).limit(limit)
    return [_clean(d) async for d in cursor]


# --------------------------------------------------------------------------- #
# Orders
# --------------------------------------------------------------------------- #
async def get_order(user_id: str, order_id: str) -> dict | None:
    if not db.enabled():
        return _clean(next((d for d in _mem["orders"] if d["id"] == order_id and d["user_id"] == user_id), None))
    return _clean(await db._get_db().orders.find_one({"_id": order_id, "user_id": user_id}))


async def get_order_by_key(user_id: str, dedupe_key: str) -> dict | None:
    if not db.enabled():
        return _clean(next((d for d in _mem["orders"]
                            if d["user_id"] == user_id and d["dedupe_key"] == dedupe_key), None))
    return _clean(await db._get_db().orders.find_one({"user_id": user_id, "dedupe_key": dedupe_key}))


async def insert_order(user_id: str, fields: dict) -> dict | None:
    """Insert a new order. Returns None when another source inserted the same
    dedupe_key first; the caller then merges into that record instead."""
    doc = {"id": uuid4().hex, **fields, "user_id": user_id, "version": 1}
    doc["_id"] = doc["id"]
    if not db.enabled():
        if any(d["user_id"] == user_id and d["dedupe_key"] == doc["dedupe_key"] for d in _mem["orders"]):
            return None
        _mem["orders"].insert(0, deepcopy(doc))
        return _clean(doc)
    try:
        await db._get_db().orders.insert_one(doc)
    except DuplicateKeyError:
        return None
    return _clean(doc)


async def update_order(user_id: str, order_id: str, fields: dict, *, expect_version: int) -> dict | None:
    """Compare-and-set: applies only if the stored version still matches.
    Returns None on a lost race (the caller reloads and retries)."""
    if not db.enabled():
        for d in _mem["orders"]:
            if d["id"] == order_id and d["user_id"] == user_id:
                if d.get("version") != expect_version:
                    return None
                d.update(deepcopy(fields))
                d["version"] = expect_version + 1
                return _clean(d)
        return None
    doc = await db._get_db().orders.find_one_and_update(
        {"_id": order_id, "user_id": user_id, "version": expect_version},
        {"$set": fields, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER,
    )
    return _clean(doc)


async def delete_order(user_id: str, order_id: str) -> None:
    if not db.enabled():
        _mem["orders"][:] = [d for d in _mem["orders"] if not (d["id"] == order_id and d["user_id"] == user_id)]
        return
    await db._get_db().orders.delete_one({"_id": order_id, "user_id": user_id})


def _matches(doc: dict, filters: dict) -> bool:
    for key in ("platform", "account_id", "status", "verification_status"):
        if filters.get(key) and doc.get(key) != filters[key]:
            return False
    sort_at = _aware(doc.get("sort_at"))
    if filters.get("date_from") and (sort_at is None or sort_at < filters["date_from"]):
        return False
    if filters.get("date_to") and (sort_at is None or sort_at >= filters["date_to"]):
        return False
    if filters.get("q"):
        needle = filters["q"].lower()
        hay = " ".join(str(doc.get(k) or "") for k in ("external_order_id", "title", "client_name", "client_id"))
        if needle not in hay.lower():
            return False
    return True


async def list_orders(user_id: str, filters: dict, limit: int = 500) -> list[dict]:
    """Filters: platform, account_id, status, verification_status (exact),
    date_from/date_to (datetimes, on the order date), q (substring search)."""
    if not db.enabled():
        rows = [d for d in _mem["orders"] if d["user_id"] == user_id and _matches(d, filters)]
        rows.sort(key=lambda d: _aware(d.get("sort_at")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return [_clean(d) for d in rows[:limit]]
    query: dict = {"user_id": user_id}
    for key in ("platform", "account_id", "status", "verification_status"):
        if filters.get(key):
            query[key] = filters[key]
    date_range = {}
    if filters.get("date_from"):
        date_range["$gte"] = filters["date_from"]
    if filters.get("date_to"):
        date_range["$lt"] = filters["date_to"]
    if date_range:
        query["sort_at"] = date_range
    if filters.get("q"):
        pattern = re.compile(re.escape(filters["q"]), re.I)
        query["$or"] = [{k: pattern} for k in ("external_order_id", "title", "client_name", "client_id")]
    cursor = db._get_db().orders.find(query).sort("sort_at", DESCENDING).limit(limit)
    return [_clean(d) async for d in cursor]


async def orders_for_account(user_id: str, account_id: str) -> list[dict]:
    return await list_orders(user_id, {"account_id": account_id}, limit=2000)


async def orders_arrived_since(user_id: str, since: datetime, limit: int = 200) -> list[dict]:
    """The user's orders whose `arrived_at` is at or after `since`, newest first."""
    if not db.enabled():
        rows = [d for d in _mem["orders"] if d["user_id"] == user_id
                and d.get("arrived_at") is not None and _aware(d["arrived_at"]) >= since]
        rows.sort(key=lambda d: _aware(d["arrived_at"]), reverse=True)
        return [_clean(d) for d in rows[:limit]]
    cursor = db._get_db().orders.find({"user_id": user_id, "arrived_at": {"$gte": since}}) \
        .sort("arrived_at", DESCENDING).limit(limit)
    return [_clean(d) async for d in cursor]


async def due_verifications(at: datetime, limit: int = 200) -> list[dict]:
    """Orders whose next check is due, across users: pending ones, and
    verified ones an email reported a status change for."""
    if not db.enabled():
        due = [d for d in _mem["orders"] if d.get("verification_status") in ("pending", "verified")
               and d.get("next_verify_at") is not None and _aware(d["next_verify_at"]) <= at]
        return [_clean(d) for d in due[:limit]]
    cursor = db._get_db().orders.find({
        "verification_status": {"$in": ["pending", "verified"]}, "next_verify_at": {"$ne": None, "$lte": at},
    }).limit(limit)
    return [_clean(d) async for d in cursor]


async def expired_orders(platform: str, synced_before: datetime, limit: int = 500) -> list[dict]:
    """API-derived orders not refreshed since `synced_before` whose data has
    not been cleared yet, across users."""
    if not db.enabled():
        rows = [d for d in _mem["orders"] if d.get("platform") == platform and not d.get("data_expired")
                and d.get("last_synced_at") is not None and _aware(d["last_synced_at"]) < synced_before]
        return [_clean(d) for d in rows[:limit]]
    cursor = db._get_db().orders.find({
        "platform": platform, "data_expired": {"$ne": True},
        "last_synced_at": {"$ne": None, "$lt": synced_before},
    }).limit(limit)
    return [_clean(d) async for d in cursor]


# --------------------------------------------------------------------------- #
# Audit events
# --------------------------------------------------------------------------- #
async def add_event(user_id: str, fields: dict) -> dict:
    doc = {"id": uuid4().hex, **fields, "user_id": user_id, "created_at": now()}
    doc["_id"] = doc["id"]
    if not db.enabled():
        events = _mem["order_events"]
        events.insert(0, doc)
        mine = [e for e in events if e["user_id"] == user_id]
        if len(mine) > _MEM_EVENT_CAP:
            events.remove(mine[-1])
        return _clean(doc)
    await db._get_db().order_events.insert_one(doc)
    return _clean(doc)


async def list_events(user_id: str, *, order_id: str | None = None, account_id: str | None = None,
                      event_type: str | None = None, limit: int = 200) -> list[dict]:
    if not db.enabled():
        rows = [e for e in _mem["order_events"] if e["user_id"] == user_id
                and (order_id is None or e.get("order_id") == order_id)
                and (account_id is None or e.get("account_id") == account_id)
                and (event_type is None or e.get("type") == event_type)]
        return [_clean(e) for e in rows[:limit]]
    query: dict = {"user_id": user_id}
    if order_id is not None:
        query["order_id"] = order_id
    if account_id is not None:
        query["account_id"] = account_id
    if event_type is not None:
        query["type"] = event_type
    cursor = db._get_db().order_events.find(query).sort("created_at", DESCENDING).limit(limit)
    return [_clean(e) async for e in cursor]
