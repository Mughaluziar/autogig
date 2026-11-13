"""Personal API keys — call the Autopilot API from your own scripts.

GET    /api/api-keys         -> the caller's keys (never the secret)
POST   /api/api-keys         {name, scopes, expiresInDays} -> {key, secret}; the secret is shown once
DELETE /api/api-keys/{id}    -> revoke

A key acts as the account that created it. Send it as
`Authorization: Bearer apk_…` (or `X-API-Key: apk_…`); security.py's
ApiKeyMiddleware checks it and swaps in a short-lived session for the
request. "read" keys can only make GET requests. Keys can never manage keys,
change sign-in details or manage the team — those need a real sign-in.
"""
import hashlib
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import repo
from ..access import store
from ..auth import current_user

router = APIRouter(prefix="/api-keys", tags=["api-keys"])

KEY_PREFIX = "apk_"
SCOPES = ("read", "write")
EXPIRY_DAYS = (30, 90, 365)
MAX_ACTIVE_KEYS = 10


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _iso(value) -> str | None:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ") if value else None


def is_active(key: dict) -> bool:
    if key.get("revoked_at"):
        return False
    expires = key.get("expires_at")
    return not (expires and expires <= store.now())


def key_view(k: dict) -> dict:
    status = "revoked" if k.get("revoked_at") else ("active" if is_active(k) else "expired")
    return {
        "id": k["id"], "name": k["name"], "prefix": k["prefix"], "scopes": k["scopes"], "status": status,
        "createdAt": _iso(k["created_at"]), "expiresAt": _iso(k.get("expires_at")),
        "lastUsedAt": _iso(k.get("last_used_at")), "revokedAt": _iso(k.get("revoked_at")),
    }


@router.get("")
async def list_keys(user: dict = Depends(current_user)):
    return [key_view(k) for k in await store.list_keys(user["id"])]


class CreateKeyBody(BaseModel):
    name: str
    scopes: list[str] = ["read"]
    expiresInDays: int | None = 90


@router.post("")
async def create_key(body: CreateKeyBody, user: dict = Depends(current_user)):
    name = body.name.strip()
    if not 1 <= len(name) <= 60:
        raise HTTPException(422, "Give the key a name (up to 60 characters).")
    scopes = sorted(set(body.scopes))
    if not scopes or any(s not in SCOPES for s in scopes):
        raise HTTPException(422, "Scopes must be read, or read and write.")
    if "write" in scopes and "read" not in scopes:
        scopes = ["read", "write"]
    if body.expiresInDays is not None and body.expiresInDays not in EXPIRY_DAYS:
        raise HTTPException(422, "Expiry must be 30, 90 or 365 days, or never.")
    active = [k for k in await store.list_keys(user["id"]) if is_active(k)]
    if len(active) >= MAX_ACTIVE_KEYS:
        raise HTTPException(409, f"You can have up to {MAX_ACTIVE_KEYS} active keys. Revoke one first.")
    secret = KEY_PREFIX + secrets.token_urlsafe(32)
    expires = store.now() + timedelta(days=body.expiresInDays) if body.expiresInDays else None
    key = await store.create_key(user["id"], hash_key(secret), {
        "name": name, "prefix": secret[:12], "scopes": scopes, "email": user["email"], "expires_at": expires,
    })
    await repo.log_activity(user["id"], "Security", f"API key \"{name}\" created ({' + '.join(scopes)})")
    return {"key": key_view(key), "secret": secret}


@router.delete("/{key_id}")
async def revoke_key(key_id: str, user: dict = Depends(current_user)):
    key = await store.revoke_key(user["id"], key_id)
    if not key:
        raise HTTPException(404, "Key not found.")
    await repo.log_activity(user["id"], "Security", f"API key \"{key['name']}\" revoked", "warning")
    return {"key": key_view(key)}
