"""Authentication — password hashing, signed access tokens, request guards.

Every API route except the public ones (routers/public.py, /auth/login,
/auth/signup, /health) requires an `Authorization: Bearer <token>` header.
Tokens are HS256 JWTs signed with SECRET_KEY and carry the user's id, email
and role, so guards don't need a database round-trip.

Roles
  admin       agency operator — the main dashboard
  freelancer  freelancer portal
  investor    investor portal (capital pool); investing also needs
              identity verification and accredited attestation
  client      retired: no new signups and no sign-in. Clients pay invoices
              through pay links without an account.

Email verification: tokens issued to a password signup that hasn't confirmed
its email carry `ev: false`, and such a session can only reach the
verification endpoints until it swaps in the token /auth/verify-email returns.
Platform owners (emails listed in OWNER_EMAILS) can also reach platform-wide
endpoints — credential vault, all users, audit log, demo reset — and pass
every role check.
"""
import hashlib
import hmac
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, Request

from . import db, session as sessions
from .config import get_settings

ROLES = ("admin", "freelancer", "client", "investor")
# Roles a new account can choose. "client" stays in ROLES only so existing
# documents still parse.
SIGNUP_ROLES = ("admin", "freelancer", "investor")
RETIRED_ROLES = ("client",)
MIN_PASSWORD_LENGTH = 8
_ALGORITHM = "HS256"
_ph = PasswordHasher()


# --------------------------------------------------------------------------- #
# Passwords
# --------------------------------------------------------------------------- #
def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(user_doc: dict, password: str) -> bool:
    stored = user_doc.get("password_hash", "")
    if stored.startswith("$argon2"):
        try:
            return _ph.verify(stored, password)
        except (VerificationError, InvalidHashError):
            return False
    # Legacy salted SHA-256 from before argon2 — the login route upgrades the
    # hash after the first successful check.
    legacy = hashlib.sha256(f"{user_doc.get('salt', '')}.{password}".encode()).hexdigest()
    return hmac.compare_digest(stored, legacy)


def needs_rehash(user_doc: dict) -> bool:
    stored = user_doc.get("password_hash", "")
    return not stored.startswith("$argon2") or _ph.check_needs_rehash(stored)


# --------------------------------------------------------------------------- #
# Tokens
# --------------------------------------------------------------------------- #
def create_access_token(user: dict, *, email_verified: bool = True, session_version: int = 0) -> str:
    settings = get_settings()
    now = int(time.time())
    claims = {
        "sub": user["id"],
        "email": user["email"],
        "role": user["role"],
        "jti": uuid.uuid4().hex,      # this session; revoked individually on logout
        "sv": session_version,        # account-wide revocation (password change/reset)
        "iat": now,
        "exp": now + settings.access_token_expire_minutes * 60,
    }
    if not email_verified:
        claims["ev"] = False
    return jwt.encode(claims, settings.secret_key, algorithm=_ALGORITHM)


# What a session that still has to confirm its email may call.
_DELETION_PENDING_PATHS = ("/auth/me", "/auth/logout", "/me/deletion", "/me/export", "/me/terms")
_UNVERIFIED_PATHS = ("/auth/me", "/auth/verify-email", "/auth/resend-verification")


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(401, detail, headers={"WWW-Authenticate": "Bearer"})


def _token_from(request: Request) -> tuple[str, str]:
    """(token, source). A bearer header wins; otherwise the HttpOnly session cookie."""
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() == "bearer" and token:
        return token, "bearer"
    cookie = request.cookies.get(sessions.SESSION_COOKIE, "")
    return (cookie, "cookie") if cookie else ("", "")


async def current_user(request: Request) -> dict:
    token, source = _token_from(request)
    if not token:
        raise _unauthorized("Not signed in.")
    try:
        claims = jwt.decode(token, get_settings().secret_key, algorithms=[_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Session expired — please sign in again.")
    except jwt.InvalidTokenError:
        raise _unauthorized("Invalid session token.")
    if source == "cookie" and request.method in sessions.UNSAFE:
        sessions.check_csrf(request, claims.get("jti", ""))
    if await sessions.is_revoked(claims.get("jti", "")):
        raise _unauthorized("Session ended — please sign in again.")
    try:
        account = await db.find_user(claims["email"])
    except Exception:
        raise HTTPException(503, "Account service is temporarily unavailable.")
    if account is None or account.get("id") != claims["sub"] or account.get("session_version", 0) != claims.get("sv", 0):
        raise _unauthorized("Session ended — please sign in again.")
    if account.get("deletion_scheduled_for"):
        # Deletion is scheduled: the account is locked until the date; only cancelling, exporting and signing out work.
        prefix = get_settings().api_prefix
        if request.url.path not in {f"{prefix}{p}" for p in _DELETION_PENDING_PATHS}:
            raise HTTPException(403, "This account is scheduled for deletion. Cancel the deletion in Settings to continue.")
    if claims.get("ev") is False:
        prefix = get_settings().api_prefix
        if request.url.path not in {f"{prefix}{p}" for p in _UNVERIFIED_PATHS}:
            raise HTTPException(403, "Verify your email address to continue.")
    user = {"id": claims["sub"], "email": claims["email"], "role": claims["role"]}
    request.state.user = user
    request.state.claims = claims
    request.state.auth_source = source
    # A pending-verification token (ev: false) can outlive the pending state:
    # the code may be confirmed from another device. /auth/me swaps it.
    request.state.token_pending = claims.get("ev") is False
    return user


def is_owner(user: dict) -> bool:
    return user["email"].lower() in get_settings().owner_email_set


def require_roles(*roles: str):
    def guard(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles and not is_owner(user):
            raise HTTPException(403, "Your account doesn't have access to this area.")
        return user
    return guard


def require_owner(user: dict = Depends(current_user)) -> dict:
    if not is_owner(user):
        raise HTTPException(403, "Platform owner access required.")
    return user


# --------------------------------------------------------------------------- #
# Login throttling — per email. Persisted in MongoDB (collection
# `login_failures`, TTL = the window) so it survives restarts and is shared by
# every API instance; in-process memory only when no database is configured.
# --------------------------------------------------------------------------- #
_LOGIN_WINDOW = 15 * 60.0
_LOGIN_MAX_FAILURES = 5
_failures: dict[str, deque] = defaultdict(deque)


def _lockout() -> HTTPException:
    return HTTPException(
        429, "Too many failed sign-in attempts. Try again in 15 minutes.",
        headers={"Retry-After": str(int(_LOGIN_WINDOW))},
    )


async def check_login_allowed(email: str) -> None:
    if db.enabled():
        since = datetime.now(timezone.utc) - timedelta(seconds=_LOGIN_WINDOW)
        count = await db._get_db().login_failures.count_documents({"key": email, "at": {"$gt": since}})
        if count >= _LOGIN_MAX_FAILURES:
            raise _lockout()
        return
    q = _failures[email]
    now = time.monotonic()
    while q and now - q[0] > _LOGIN_WINDOW:
        q.popleft()
    if len(q) >= _LOGIN_MAX_FAILURES:
        raise _lockout()


async def record_login_failure(email: str) -> None:
    if db.enabled():
        await db._get_db().login_failures.insert_one({"key": email, "at": datetime.now(timezone.utc)})
        return
    _failures[email].append(time.monotonic())


async def clear_login_failures(email: str) -> None:
    if db.enabled():
        await db._get_db().login_failures.delete_many({"key": email})
        return
    _failures.pop(email, None)
