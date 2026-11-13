"""Upwork connection persistence — MongoDB, with the same in-memory fallback as repo.py.

Collections
  upwork_connections   one document per (user, Upwork user). access_token and
                       refresh_token hold ciphertext from app/crypto.py, never
                       plain tokens. `version` gives compare-and-set updates,
                       so two requests refreshing at once can't overwrite
                       each other's tokens.
  upwork_oauth_states  pending authorizations, keyed by the SHA-256 of the
                       state sent to Upwork. Single use; expire after 10 minutes.

Every per-user read filters by user_id. get_connection() without a user id
serves the token-refresh path, which already holds a connection it was given.
"""
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from .. import db

_mem: dict[str, dict[str, dict]] = {"connections": {}, "states": {}}


def reset_memory() -> None:
    for items in _mem.values():
        items.clear()


def now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value):
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _clean(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    return deepcopy({k: _aware(v) for k, v in doc.items() if k != "_id"})


async def ensure_indexes() -> None:
    if not db.enabled():
        return
    mdb = db._get_db()
    await mdb.upwork_connections.create_index([("user_id", ASCENDING), ("upwork_user_id", ASCENDING)], unique=True)
    await mdb.upwork_connections.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await mdb.upwork_oauth_states.create_index("expires_at", expireAfterSeconds=0)


# --------------------------------------------------------------------------- #
# OAuth states
# --------------------------------------------------------------------------- #
async def save_state(state_hash: str, fields: dict) -> None:
    doc = {**fields, "_id": state_hash, "created_at": now()}
    if not db.enabled():
        _mem["states"][state_hash] = deepcopy(doc)
        return
    await db._get_db().upwork_oauth_states.insert_one(doc)


async def take_state(state_hash: str) -> dict | None:
    """Return and delete a pending state in one step, so it can be used once."""
    if not db.enabled():
        return _clean(_mem["states"].pop(state_hash, None))
    return _clean(await db._get_db().upwork_oauth_states.find_one_and_delete({"_id": state_hash}))


# --------------------------------------------------------------------------- #
# Connections
# --------------------------------------------------------------------------- #
async def upsert_connection(user_id: str, upwork_user_id: str, fields: dict) -> tuple[dict, bool]:
    """Create the connection, or refresh the tokens of this user's existing
    connection to the same Upwork account (a reconnect). Returns (doc, created)."""
    stamp = now()
    if not db.enabled():
        for d in _mem["connections"].values():
            if d["user_id"] == user_id and d["upwork_user_id"] == upwork_user_id:
                d.update(deepcopy(fields), updated_at=stamp, version=d["version"] + 1)
                return _clean(d), False
        doc = {"id": f"uwc_{uuid4().hex}", **deepcopy(fields), "user_id": user_id, "upwork_user_id": upwork_user_id,
               "version": 1, "created_at": stamp, "updated_at": stamp}
        _mem["connections"][doc["id"]] = doc
        return _clean(doc), True
    coll = db._get_db().upwork_connections
    doc = await coll.find_one_and_update(
        {"user_id": user_id, "upwork_user_id": upwork_user_id},
        {"$set": {**fields, "updated_at": stamp}, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if doc:
        return _clean(doc), False
    new_id = f"uwc_{uuid4().hex}"
    doc = {"_id": new_id, "id": new_id, **fields, "user_id": user_id, "upwork_user_id": upwork_user_id,
           "version": 1, "created_at": stamp, "updated_at": stamp}
    try:
        await coll.insert_one(doc)
    except DuplicateKeyError:
        # A concurrent callback for the same account won; update that one.
        return await upsert_connection(user_id, upwork_user_id, fields)
    return _clean(doc), True


async def get_connection(connection_id: str, user_id: str | None = None) -> dict | None:
    if not db.enabled():
        doc = _mem["connections"].get(connection_id)
        return _clean(doc) if doc and (user_id is None or doc["user_id"] == user_id) else None
    query = {"_id": connection_id, **({"user_id": user_id} if user_id is not None else {})}
    return _clean(await db._get_db().upwork_connections.find_one(query))


async def list_connections(user_id: str) -> list[dict]:
    if not db.enabled():
        mine = [d for d in _mem["connections"].values() if d["user_id"] == user_id]
        return [_clean(d) for d in sorted(mine, key=lambda d: d["created_at"], reverse=True)]
    cursor = db._get_db().upwork_connections.find({"user_id": user_id}).sort("created_at", DESCENDING)
    return [_clean(d) async for d in cursor]


async def update_connection(connection_id: str, fields: dict, *, expect_version: int | None = None) -> dict | None:
    """Apply `fields`. With expect_version, only while the stored version is
    unchanged (None means another writer got there first)."""
    stamp = now()
    if not db.enabled():
        d = _mem["connections"].get(connection_id)
        if not d or (expect_version is not None and d["version"] != expect_version):
            return None
        d.update(deepcopy(fields), updated_at=stamp, version=d["version"] + 1)
        return _clean(d)
    query = {"_id": connection_id, **({"version": expect_version} if expect_version is not None else {})}
    doc = await db._get_db().upwork_connections.find_one_and_update(
        query, {"$set": {**fields, "updated_at": stamp}, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER,
    )
    return _clean(doc)


async def delete_connection(user_id: str, connection_id: str) -> bool:
    """Remove the connection and its tokens for good."""
    if not db.enabled():
        d = _mem["connections"].get(connection_id)
        if not d or d["user_id"] != user_id:
            return False
        del _mem["connections"][connection_id]
        return True
    res = await db._get_db().upwork_connections.delete_one({"_id": connection_id, "user_id": user_id})
    return res.deleted_count > 0
