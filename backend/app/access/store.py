"""Team and API-key persistence — MongoDB, with the same in-memory fallback as repo.py.

Collections
  team_members   one document per (team, member). A team is identified by its
                 owner's user id; the owner is implicit and never stored here.
                 Each document snapshots the team's name and owner so a member
                 can see which teams they belong to without reading the owner's
                 account.
  team_invites   pending, accepted, revoked or expired invites. Only the
                 SHA-256 of the invite token is stored; the link holding the
                 token is shown to the inviter once and emailed when email is
                 configured.
  api_keys       personal API keys. Only the SHA-256 of the key is stored,
                 plus a short prefix the owner can recognise it by.

Every per-team read filters by team_id and every per-user read by user_id.
"""
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from .. import db

_mem: dict[str, dict[str, dict]] = {"members": {}, "invites": {}, "keys": {}}


def reset_memory() -> None:
    """Tests only — wipe the in-memory fallback."""
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


def _newest_first(docs) -> list[dict]:
    return [_clean(d) for d in sorted(docs, key=lambda d: d["created_at"], reverse=True)]


async def ensure_indexes() -> None:
    if not db.enabled():
        return
    mdb = db._get_db()
    await mdb.team_members.create_index([("team_id", ASCENDING), ("user_id", ASCENDING)], unique=True)
    await mdb.team_members.create_index([("user_id", ASCENDING)])
    await mdb.team_invites.create_index("token_hash", unique=True)
    await mdb.team_invites.create_index([("team_id", ASCENDING), ("created_at", DESCENDING)])
    await mdb.api_keys.create_index("key_hash", unique=True)
    await mdb.api_keys.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])


# --------------------------------------------------------------------------- #
# Members
# --------------------------------------------------------------------------- #
async def add_member(team_id: str, fields: dict) -> dict | None:
    """Add a member; None when this user is already on the team."""
    stamp = now()
    member_id = f"tm_{uuid4().hex}"
    doc = {"_id": member_id, "id": member_id, **fields, "team_id": team_id, "created_at": stamp, "updated_at": stamp}
    if not db.enabled():
        if any(d["team_id"] == team_id and d["user_id"] == fields["user_id"] for d in _mem["members"].values()):
            return None
        _mem["members"][member_id] = deepcopy(doc)
        return _clean(doc)
    try:
        await db._get_db().team_members.insert_one(doc)
    except DuplicateKeyError:
        return None
    return _clean(doc)


async def list_members(team_id: str) -> list[dict]:
    if not db.enabled():
        return _newest_first(d for d in _mem["members"].values() if d["team_id"] == team_id)
    cursor = db._get_db().team_members.find({"team_id": team_id}).sort("created_at", DESCENDING)
    return [_clean(d) async for d in cursor]


async def list_memberships(user_id: str) -> list[dict]:
    """Teams this user has joined as a member."""
    if not db.enabled():
        return _newest_first(d for d in _mem["members"].values() if d["user_id"] == user_id)
    cursor = db._get_db().team_members.find({"user_id": user_id}).sort("created_at", DESCENDING)
    return [_clean(d) async for d in cursor]


async def find_membership(team_id: str, user_id: str) -> dict | None:
    if not db.enabled():
        return next((_clean(d) for d in _mem["members"].values()
                     if d["team_id"] == team_id and d["user_id"] == user_id), None)
    return _clean(await db._get_db().team_members.find_one({"team_id": team_id, "user_id": user_id}))


async def get_member(team_id: str, member_id: str) -> dict | None:
    if not db.enabled():
        d = _mem["members"].get(member_id)
        return _clean(d) if d and d["team_id"] == team_id else None
    return _clean(await db._get_db().team_members.find_one({"_id": member_id, "team_id": team_id}))


async def update_member(team_id: str, member_id: str, fields: dict) -> dict | None:
    stamp = now()
    if not db.enabled():
        d = _mem["members"].get(member_id)
        if not d or d["team_id"] != team_id:
            return None
        d.update(deepcopy(fields), updated_at=stamp)
        return _clean(d)
    doc = await db._get_db().team_members.find_one_and_update(
        {"_id": member_id, "team_id": team_id}, {"$set": {**fields, "updated_at": stamp}},
        return_document=ReturnDocument.AFTER,
    )
    return _clean(doc)


async def delete_member(team_id: str, member_id: str) -> bool:
    if not db.enabled():
        d = _mem["members"].get(member_id)
        if not d or d["team_id"] != team_id:
            return False
        del _mem["members"][member_id]
        return True
    res = await db._get_db().team_members.delete_one({"_id": member_id, "team_id": team_id})
    return res.deleted_count > 0


# --------------------------------------------------------------------------- #
# Invites
# --------------------------------------------------------------------------- #
async def create_invite(team_id: str, token_hash: str, fields: dict) -> dict:
    stamp = now()
    invite_id = f"inv_{uuid4().hex}"
    doc = {"_id": invite_id, "id": invite_id, **fields, "team_id": team_id, "token_hash": token_hash,
           "created_at": stamp, "updated_at": stamp}
    if not db.enabled():
        _mem["invites"][invite_id] = deepcopy(doc)
        return _clean(doc)
    await db._get_db().team_invites.insert_one(doc)
    return _clean(doc)


async def list_invites(team_id: str, limit: int = 100) -> list[dict]:
    if not db.enabled():
        return _newest_first(d for d in _mem["invites"].values() if d["team_id"] == team_id)[:limit]
    cursor = db._get_db().team_invites.find({"team_id": team_id}).sort("created_at", DESCENDING).limit(limit)
    return [_clean(d) async for d in cursor]


async def get_invite(team_id: str, invite_id: str) -> dict | None:
    if not db.enabled():
        d = _mem["invites"].get(invite_id)
        return _clean(d) if d and d["team_id"] == team_id else None
    return _clean(await db._get_db().team_invites.find_one({"_id": invite_id, "team_id": team_id}))


async def find_invite_by_hash(token_hash: str) -> dict | None:
    if not db.enabled():
        return next((_clean(d) for d in _mem["invites"].values() if d["token_hash"] == token_hash), None)
    return _clean(await db._get_db().team_invites.find_one({"token_hash": token_hash}))


async def update_invite(invite_id: str, fields: dict, *, expect_status: str | None = None) -> dict | None:
    """Apply `fields`. With expect_status, only while the invite still has that
    status — so an invite can't be accepted twice or accepted after a revoke."""
    stamp = now()
    if not db.enabled():
        d = _mem["invites"].get(invite_id)
        if not d or (expect_status is not None and d["status"] != expect_status):
            return None
        d.update(deepcopy(fields), updated_at=stamp)
        return _clean(d)
    query = {"_id": invite_id, **({"status": expect_status} if expect_status is not None else {})}
    doc = await db._get_db().team_invites.find_one_and_update(
        query, {"$set": {**fields, "updated_at": stamp}}, return_document=ReturnDocument.AFTER,
    )
    return _clean(doc)


# --------------------------------------------------------------------------- #
# API keys
# --------------------------------------------------------------------------- #
async def create_key(user_id: str, key_hash: str, fields: dict) -> dict:
    stamp = now()
    key_id = f"key_{uuid4().hex}"
    doc = {"_id": key_id, "id": key_id, **fields, "user_id": user_id, "key_hash": key_hash,
           "created_at": stamp, "last_used_at": None, "revoked_at": None}
    if not db.enabled():
        _mem["keys"][key_id] = deepcopy(doc)
        return _clean(doc)
    await db._get_db().api_keys.insert_one(doc)
    return _clean(doc)


async def list_keys(user_id: str) -> list[dict]:
    if not db.enabled():
        return _newest_first(d for d in _mem["keys"].values() if d["user_id"] == user_id)
    cursor = db._get_db().api_keys.find({"user_id": user_id}).sort("created_at", DESCENDING)
    return [_clean(d) async for d in cursor]


async def find_key_by_hash(key_hash: str) -> dict | None:
    if not db.enabled():
        return next((_clean(d) for d in _mem["keys"].values() if d["key_hash"] == key_hash), None)
    return _clean(await db._get_db().api_keys.find_one({"key_hash": key_hash}))


async def revoke_key(user_id: str, key_id: str) -> dict | None:
    """Revoke a key the user owns; None when it isn't theirs or doesn't exist."""
    stamp = now()
    if not db.enabled():
        d = _mem["keys"].get(key_id)
        if not d or d["user_id"] != user_id:
            return None
        if d.get("revoked_at") is None:
            d["revoked_at"] = stamp
        return _clean(d)
    coll = db._get_db().api_keys
    await coll.update_one({"_id": key_id, "user_id": user_id, "revoked_at": None}, {"$set": {"revoked_at": stamp}})
    return _clean(await coll.find_one({"_id": key_id, "user_id": user_id}))


async def touch_key(key_id: str, when: datetime) -> None:
    if not db.enabled():
        d = _mem["keys"].get(key_id)
        if d:
            d["last_used_at"] = when
        return
    await db._get_db().api_keys.update_one({"_id": key_id}, {"$set": {"last_used_at": when}})
