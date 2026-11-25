"""MongoDB connection + user accounts (Motor async driver).

When MONGODB_URI is set, accounts live in the `users` collection and per-user
data lives in the collections described in repo.py. Without it, both fall back
to process memory so local development works (data is lost on restart).

Collections
-----------
autopilot.users             one document per registered user, keyed by email
autopilot.oauth_identities  "<provider>:<subject>" -> email, for social sign-in
(see repo.py for the per-user data collections)
"""
import asyncio
import secrets
import time
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from .config import get_settings

_client: AsyncIOMotorClient | None = None
_db = None


def enabled() -> bool:
    return bool((get_settings().mongodb_uri or "").strip())


def close() -> None:
    global _client, _db
    if _client is not None:
        _client.close()
        _client = _db = None


def _get_db():
    global _client, _db
    if _db is None:
        _client = AsyncIOMotorClient(
            get_settings().mongodb_uri,
            serverSelectionTimeoutMS=5000,
        )
        _db = _client[get_settings().mongodb_db]
    return _db


async def ping() -> None:
    await asyncio.wait_for(_get_db().command("ping"), timeout=8)


async def compare_and_update_user(
    email: str, user_id: str, field: str, expected: dict | str | None,
    fields: dict, unset: tuple[str, ...] = (), *, bump_session: bool = False,
) -> dict | None:
    """Update account credentials only if the observed challenge is still current."""
    if not enabled():
        doc = _mem_users.get(email)
        if doc is None or doc["id"] != user_id or doc.get(field) != expected:
            return None
        if bump_session:
            fields = {**fields, "session_version": doc.get("session_version", 0) + 1}
        return await update_user(email, fields, unset)
    update: dict = {}
    if fields:
        update["$set"] = fields
    if unset:
        update["$unset"] = {key: "" for key in unset}
    if bump_session:
        update["$inc"] = {"session_version": 1}
    return await _get_db().users.find_one_and_update(
        {"_id": email, "id": user_id, field: expected}, update,
        return_document=ReturnDocument.AFTER,
    )


async def find_user_by_reset_hash(token_hash: str) -> dict | None:
    """The account holding this password-reset token hash, if any."""
    if not enabled():
        return next((d for d in _mem_users.values() if (d.get("reset") or {}).get("hash") == token_hash), None)
    return await _get_db().users.find_one({"reset.hash": token_hash})


# --------------------------------------------------------------------------- #
# Real user accounts
# --------------------------------------------------------------------------- #
# Without MONGODB_URI, accounts live in process memory so local development
# works end to end (they're lost on restart).
_mem_users: dict[str, dict] = {}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


async def find_user(email: str) -> dict | None:
    """Look up an account by email. Database errors propagate to the caller."""
    email = email.strip().lower()
    if not enabled():
        return _mem_users.get(email)
    return await _get_db().users.find_one({"_id": email})


async def find_user_by_id(user_id: str) -> dict | None:
    if not enabled():
        return next((d for d in _mem_users.values() if d.get("id") == user_id), None)
    return await _get_db().users.find_one({"id": user_id})


async def list_users() -> list[dict]:
    """Return registered users for scheduled per-user jobs."""
    if not enabled():
        return list(_mem_users.values())
    return [doc async for doc in _get_db().users.find({}, {"_id": 0})]


async def create_user(name: str, email: str, password_hash: str, role: str, company: str | None,
                      extra: dict | None = None) -> dict | None:
    """Insert a user; returns the public record, or None if the email exists.
    `extra` adds fields such as email_verified, profile and verify (the
    pending email code). Database errors propagate to the caller."""
    email = email.strip().lower()
    doc = {
        **(extra or {}),
        "_id": email,
        "id": f"u-{secrets.token_hex(6)}",
        "name": name.strip() or email.split("@")[0].title(),
        "email": email,
        "role": role,
        "company": company or "",
        "password_hash": password_hash,
        "created_at": _now(),
    }
    if not enabled():
        if email in _mem_users:
            return None
        _mem_users[email] = doc
        return _public_user(doc)
    try:
        await _get_db().users.insert_one(doc)
    except DuplicateKeyError:
        return None
    return _public_user(doc)


async def update_password_hash(email: str, password_hash: str) -> None:
    email = email.strip().lower()
    if not enabled():
        if email in _mem_users:
            _mem_users[email]["password_hash"] = password_hash
            _mem_users[email].pop("salt", None)
        return
    await _get_db().users.update_one(
        {"_id": email}, {"$set": {"password_hash": password_hash}, "$unset": {"salt": ""}}
    )


# A password signup that was issued a code and never confirmed it, and was
# never reached through social sign-in. Its session could only ever call the
# verification endpoints, so a new signup for the same email may replace it.
_PENDING_FILTER = {"email_verified": False, "verify": {"$exists": True}, "auth_provider": {"$exists": False}}


def is_pending_signup(doc: dict) -> bool:
    return doc.get("email_verified") is False and "verify" in doc and "auth_provider" not in doc


async def replace_pending_user(email: str, name: str, password_hash: str, role: str, company: str | None,
                               extra: dict | None = None, *, verified: bool = False) -> dict | None:
    """Overwrite a pending signup (see is_pending_signup) with a new one, under
    a new user id so sessions issued to the old signup stop matching. Returns
    the new document, or None when the account isn't a pending signup."""
    email = email.strip().lower()
    fields = {
        **(extra or {}),
        "id": f"u-{secrets.token_hex(6)}",
        "name": name.strip() or email.split("@")[0].title(),
        "role": role,
        "company": company or "",
        "password_hash": password_hash,
        "email_verified": verified,
        "created_at": _now(),
    }
    if not enabled():
        doc = _mem_users.get(email)
        if doc is None or not is_pending_signup(doc):
            return None
        doc.pop("verify", None)
        doc.update(fields)
        return doc
    return await _get_db().users.find_one_and_update(
        {"_id": email, **_PENDING_FILTER}, {"$set": fields, "$unset": {"verify": ""}},
        return_document=ReturnDocument.AFTER,
    )


async def email_has_identity(email: str) -> bool:
    """Whether any social sign-in identity points at this email."""
    email = email.strip().lower()
    if not enabled():
        return any(d["email"] == email for d in _mem_identities.values())
    return await _get_db().oauth_identities.find_one({"email": email}) is not None


async def update_user(email: str, fields: dict, unset: tuple[str, ...] = ()) -> dict | None:
    """Set (and optionally unset) fields on an account; returns the updated
    document, or None when there's no such account."""
    email = email.strip().lower()
    if not enabled():
        doc = _mem_users.get(email)
        if doc is None:
            return None
        doc.update(fields)
        for key in unset:
            doc.pop(key, None)
        return doc
    update: dict = {}
    if fields:
        update["$set"] = fields
    if unset:
        update["$unset"] = {k: "" for k in unset}
    if not update:
        return await find_user(email)
    return await _get_db().users.find_one_and_update({"_id": email}, update, return_document=ReturnDocument.AFTER)


# --------------------------------------------------------------------------- #
# Social sign-in identities — "<provider>:<subject>" -> account email
# --------------------------------------------------------------------------- #
_mem_identities: dict[str, dict] = {}


def _identity_key(provider: str, subject: str) -> str:
    return f"{provider}:{subject}"


async def find_identity(provider: str, subject: str) -> dict | None:
    key = _identity_key(provider, subject)
    if not enabled():
        return _mem_identities.get(key)
    return await _get_db().oauth_identities.find_one({"_id": key})


async def link_identity(provider: str, subject: str, email: str) -> None:
    """Remember that this provider account signs in to `email`. Idempotent."""
    key = _identity_key(provider, subject)
    doc = {"_id": key, "provider": provider, "subject": subject, "email": email.strip().lower(), "created_at": _now()}
    if not enabled():
        _mem_identities.setdefault(key, doc)
        return
    try:
        await _get_db().oauth_identities.insert_one(doc)
    except DuplicateKeyError:
        pass


def is_email_verified(doc: dict) -> bool:
    # Accounts from before email verification existed count as verified.
    return bool(doc.get("email_verified", True))


def _iso(value) -> str | None:
    if not isinstance(value, datetime):
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _public_user(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "name": doc["name"],
        "email": doc["email"],
        "role": doc["role"],
        "company": doc.get("company", ""),
        "emailVerified": is_email_verified(doc),
        "hasPassword": bool(doc.get("password_hash")),
        "profile": doc.get("profile") or {},
        "deletionScheduledFor": _iso(doc.get("deletion_scheduled_for")),
    }


async def change_email(old_email: str, new_email: str, extra: dict) -> dict | None:
    """Move an account to a new sign-in address (the email is the document key). Returns the new document, or None if the
    new address is taken or the account vanished. Order: write the new document first, then delete the old one, so a crash
    leaves two copies of the same account (never none); the old copy is removed by re-running the confirmation."""
    old_email, new_email = old_email.strip().lower(), new_email.strip().lower()
    doc = await find_user(old_email)
    if doc is None:
        return None
    moved = {**{k: v for k, v in doc.items() if k not in ("_id", "email_change", "reset")}, **extra,
             "_id": new_email, "email": new_email}
    if not enabled():
        if new_email in _mem_users:
            return None
        _mem_users[new_email] = moved
        _mem_users.pop(old_email, None)
        return moved
    try:
        await _get_db().users.insert_one(moved)
    except DuplicateKeyError:
        return None
    await _get_db().users.delete_one({"_id": old_email, "id": doc["id"]})
    return moved


async def relink_identities(old_email: str, new_email: str) -> None:
    """Social sign-in links point at the account's email; follow it when it changes."""
    if not enabled():
        for doc in _mem_identities.values():
            if doc.get("email") == old_email:
                doc["email"] = new_email
        return
    await _get_db().oauth_identities.update_many({"email": old_email}, {"$set": {"email": new_email}})


async def _check_connection() -> None:
    """Check persistence before starting the optional production queue."""
    if not enabled():
        raise SystemExit("MONGODB_URI is required for the production queue.")
    try:
        await ping()
    except Exception as exc:
        raise SystemExit(f"MongoDB queue startup check failed ({type(exc).__name__}).") from None
    finally:
        close()


if __name__ == "__main__":
    asyncio.run(_check_connection())
