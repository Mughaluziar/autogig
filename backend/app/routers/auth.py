"""Accounts — signup, email verification, login, social sign-in and the session.

POST /api/auth/signup                 create an account -> {token, user, verification}
POST /api/auth/login                  verify credentials -> {token, user}
GET  /api/auth/me                     the signed-in user (validates a stored token)
POST /api/auth/verify-email {code}    confirm the emailed code -> fresh {token, user}
POST /api/auth/resend-verification    email a new code (once a minute, 5 an hour)
POST /api/auth/change-password        {currentPassword, newPassword}
GET  /api/auth/providers              which social sign-ins are configured
GET  /api/auth/oauth/{p}/start        -> 303 to Google / Apple / GitHub / Microsoft
GET  /api/auth/oauth/{p}/callback     provider returns here (Apple POSTs)
POST /api/auth/oauth/exchange {code}  one-time handoff code -> {token, user}

Signup, login, providers and the OAuth endpoints are public; the rest need a
bearer token. A password signup must confirm its email before its session can
reach anything but /me, /verify-email and /resend-verification (app/auth.py).
See docs/social-sign-in.md.
"""
import asyncio
import hashlib
import hmac
import logging
import re
import secrets
import time
from urllib.parse import parse_qs, urlencode, urlparse

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, field_validator

from .. import db, email as mail, oauth, repo, session as sessions
from ..auth import (
    MIN_PASSWORD_LENGTH, RETIRED_ROLES, SIGNUP_ROLES, check_login_allowed, clear_login_failures,
    _token_from, create_access_token, current_user, hash_password, is_owner, needs_rehash,
    record_login_failure, verify_password,
)
from ..config import get_settings

log = logging.getLogger("autopilot.auth")

router = APIRouter(prefix="/auth", tags=["auth"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
RETIRED_DETAIL = ("Client accounts have been retired. To pay an invoice, use the pay link you were sent, "
                  "or create a freelancer or agency account.")

CODE_TTL_SECONDS = 15 * 60
CODE_MAX_ATTEMPTS = 5
RESEND_COOLDOWN_SECONDS = 60
RESENDS_PER_HOUR = 5


def _db_unavailable() -> HTTPException:
    return HTTPException(503, "Account service is temporarily unavailable. Please try again.")


# --------------------------------------------------------------------------- #
# Email verification
# --------------------------------------------------------------------------- #
def verification_enforced() -> bool:
    """Verification is required when a code can actually reach the user: an
    email provider is configured, or this isn't production (the API then
    returns the code itself for local development)."""
    s = get_settings()
    return s.email_verification and (mail.enabled() or s.environment != "production")


def _needs_verification(doc: dict) -> bool:
    return not db.is_email_verified(doc) and verification_enforced()


def _code_hash(email: str, code: str) -> str:
    key = get_settings().secret_key.encode()
    return hmac.new(key, f"{email}:{code}".encode(), hashlib.sha256).hexdigest()


async def _issue_code(doc: dict, sent_at: list[float]) -> dict:
    """Store a fresh code (hash only) and email it. Returns what the client
    may know: whether it was sent, and the code itself only for local dev."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    stamp = time.time()
    await db.update_user(doc["email"], {"verify": {
        "code_hash": _code_hash(doc["email"], code), "expires_at": stamp + CODE_TTL_SECONDS,
        "attempts": 0, "sent_at": [t for t in sent_at if stamp - t < 3600] + [stamp],
    }})
    out: dict = {"required": True, "sent": False, "expiresInSeconds": CODE_TTL_SECONDS,
                 "retryAfterSeconds": RESEND_COOLDOWN_SECONDS}
    if mail.enabled():
        subject, html = mail.verification_email(doc.get("name", ""), code, CODE_TTL_SECONDS // 60)
        out["sent"] = await mail.send_email(doc["email"], subject, html)
        if not out["sent"]:
            out["detail"] = "We couldn't send the email just now. Try resending the code."
    elif get_settings().environment != "production":
        # No email provider outside production: hand the code to the page,
        # which labels it development-only.
        out["devCode"] = code
    return out


def _send_welcome(doc: dict) -> None:
    # Fire-and-forget, never blocks or fails the request.
    if mail.enabled():
        subject, html = mail.welcome_email(doc.get("name", ""), doc["role"])
        asyncio.create_task(mail.send_email(doc["email"], subject, html))


def _session(doc: dict, **extra) -> dict:
    user = db._public_user(doc)
    pending = _needs_verification(doc)
    return {
        "ok": True,
        "token": create_access_token(user, email_verified=not pending, session_version=doc.get("session_version", 0)),
        "user": {**user, "owner": is_owner(user), "verificationRequired": pending},
        **extra,
    }


# --------------------------------------------------------------------------- #
# Signup
# --------------------------------------------------------------------------- #
LINK_PLATFORMS = {
    "upwork": "Upwork", "fiverr": "Fiverr", "freelancer": "Freelancer.com", "toptal": "Toptal",
    "peopleperhour": "PeoplePerHour", "guru": "Guru", "contra": "Contra", "linkedin": "LinkedIn",
    "github": "GitHub", "other": "Other",
}
# platform -> (accepted hosts, profile URL for a bare username, username pattern)
_LINK_RULES: dict[str, tuple[tuple[str, ...], str | None, str | None]] = {
    "upwork": (("upwork.com",), None, None),
    "fiverr": (("fiverr.com",), "https://www.fiverr.com/{}", r"[A-Za-z0-9_]{3,30}"),
    "freelancer": (("freelancer.com",), "https://www.freelancer.com/u/{}", r"[A-Za-z0-9_.-]{3,40}"),
    "toptal": (("toptal.com",), "https://www.toptal.com/resume/{}", r"[A-Za-z0-9-]{3,60}"),
    "peopleperhour": (("peopleperhour.com",), None, None),
    "guru": (("guru.com",), None, None),
    "contra": (("contra.com",), "https://contra.com/{}", r"[A-Za-z0-9_-]{2,40}"),
    "linkedin": (("linkedin.com",), "https://www.linkedin.com/in/{}", r"[A-Za-z0-9_-]{3,100}"),
    "github": (("github.com",), "https://github.com/{}", r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})"),
    "other": ((), None, None),
}


def normalize_linked_account(platform: str, value: str) -> str:
    """The profile URL for `value` (a URL or a bare username) on `platform`.
    Raises ValueError with a message the user can act on."""
    platform, value = platform.strip().lower(), value.strip()
    if platform not in _LINK_RULES:
        raise ValueError("Choose a supported platform.")
    if not value:
        raise ValueError("Enter your profile link or username.")
    if len(value) > 300:
        raise ValueError("That profile link is too long.")
    hosts, template, pattern = _LINK_RULES[platform]
    label = f"{LINK_PLATFORMS[platform]} " if platform != "other" else ""
    username = value.lstrip("@")
    is_username = bool(pattern and re.fullmatch(pattern, username))
    if "/" not in value and not re.match(r"^https?:", value, re.I) and ("." not in value or is_username):
        if template and is_username:
            return template.format(username)
        raise ValueError(f"Paste the full link to your {label}profile.")
    url = value if re.match(r"^https?://", value, re.I) else f"https://{value}"
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme.lower() not in ("http", "https") or not host or "." not in host:
        raise ValueError(f"Enter a valid link to your {label}profile.")
    if hosts and not any(host == h or host.endswith(f".{h}") for h in hosts):
        raise ValueError(f"That isn't a {label}link.")
    if hosts and parsed.path.strip("/") == "":
        raise ValueError(f"Link to your {label}profile, not the home page.")
    return f"https://{host}{parsed.path.rstrip('/')}" + (f"?{parsed.query}" if parsed.query else "")


class LinkedAccount(BaseModel):
    platform: str = Field(max_length=20)
    url: str = Field(max_length=300)


class SignupProfile(BaseModel):
    country: str = Field(default="", max_length=64)
    hourlyRate: float | None = Field(default=None, ge=0, le=10_000)
    skills: list[str] = Field(default_factory=list, max_length=30)
    experience: str = Field(default="", max_length=20)
    availability: str = Field(default="", max_length=20)
    teamSize: str = Field(default="", max_length=20)
    bio: str = Field(default="", max_length=1000)
    linkedAccount: LinkedAccount | None = None

    @field_validator("skills")
    @classmethod
    def _skills(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for s in v:
            s = s.strip()[:40]
            if s and s.lower() not in {o.lower() for o in out}:
                out.append(s)
        return out


class SignupBody(BaseModel):
    name: str = Field(default="", max_length=120)
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)
    role: str = "admin"
    company: str = Field(default="", max_length=120)
    profile: SignupProfile | None = None


class LoginBody(BaseModel):
    email: str = ""
    password: str = ""
    role: str = ""


def _profile_doc(profile: SignupProfile | None) -> dict:
    if profile is None:
        return {}
    out = {k: v for k, v in profile.model_dump(exclude={"linkedAccount"}).items() if v not in ("", None, [])}
    for key in ("country", "experience", "availability", "teamSize", "bio"):
        if key in out:
            out[key] = out[key].strip()
    if profile.linkedAccount:
        try:
            url = normalize_linked_account(profile.linkedAccount.platform, profile.linkedAccount.url)
        except ValueError as e:
            raise HTTPException(422, str(e))
        platform = profile.linkedAccount.platform.strip().lower()
        out["linkedAccount"] = {"platform": platform, "label": LINK_PLATFORMS[platform], "url": url}
    return out


@router.post("/signup")
async def signup(body: SignupBody, request: Request, response: Response):
    email = body.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(422, "Enter a valid email address.")
    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(422, f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    if body.role in RETIRED_ROLES:
        raise HTTPException(422, "Client accounts are no longer offered. Choose another account type.")
    if body.role not in SIGNUP_ROLES:
        raise HTTPException(422, "Choose a valid account type.")
    profile = _profile_doc(body.profile)
    try:
        user = await db.create_user(body.name, email, hash_password(body.password), body.role, body.company or None,
                                    extra={"email_verified": False, "profile": profile})
    except HTTPException:
        raise
    except Exception:
        raise _db_unavailable()
    sent_at: list[float] = []
    if not user:
        # A signup that never confirmed its email (a typo, or abandoned) must
        # not lock the address: a new signup replaces it. Only while
        # verification is enforced: otherwise unverified accounts are usable.
        existing = await db.find_user(email) if verification_enforced() else None
        if not existing or not db.is_pending_signup(existing) or await db.email_has_identity(email):
            raise HTTPException(409, "An account with this email already exists.")
        sent_at = [t for t in existing["verify"].get("sent_at", []) if time.time() - t < 3600]
        if sent_at and time.time() - sent_at[-1] < RESEND_COOLDOWN_SECONDS:
            wait = int(RESEND_COOLDOWN_SECONDS - (time.time() - sent_at[-1])) + 1
            raise HTTPException(429, f"A code was just sent to this email. Wait {wait} seconds and try again.",
                                headers={"Retry-After": str(wait)})
        if len(sent_at) >= RESENDS_PER_HOUR:
            raise HTTPException(429, "Too many codes were sent to this email. Try again in an hour.",
                                headers={"Retry-After": "3600"})
        user = await db.replace_pending_user(email, body.name, hash_password(body.password), body.role,
                                             body.company or None, extra={"profile": profile})
        if not user:
            raise HTTPException(409, "An account with this email already exists.")
    await repo.log_activity(user["id"], "Operator", f"Account created ({body.role})")
    doc = await db.find_user(email) or {}
    if verification_enforced():
        verification = await _issue_code(doc, sent_at)
    else:
        verification = {"required": False}
        _send_welcome(doc)
    return sessions.issue(request, response, _session(doc, verification=verification))


@router.post("/login")
async def login(body: LoginBody, request: Request, response: Response):
    email = body.email.strip().lower()
    await check_login_allowed(email)
    try:
        doc = await db.find_user(email)
    except Exception:
        raise _db_unavailable()
    if doc is None or not verify_password(doc, body.password):
        await record_login_failure(email)
        raise HTTPException(401, "Invalid email or password.")
    if doc["role"] in RETIRED_ROLES:
        raise HTTPException(403, RETIRED_DETAIL)
    # Enforce the account's real role — a freelancer can't sign in as admin.
    if body.role and doc["role"] != body.role:
        raise HTTPException(
            403, f"This account is registered as '{doc['role']}' — select that role above to sign in.",
        )
    await clear_login_failures(email)
    if needs_rehash(doc):
        try:
            await db.update_password_hash(email, hash_password(body.password))
        except Exception:
            pass  # the old hash still works; the upgrade retries on the next login
    await repo.log_activity(doc["id"], "Operator", f"Signed in as {doc['role']}")
    return sessions.issue(request, response, _session(doc))


async def _session_doc(session: dict) -> dict:
    try:
        doc = await db.find_user(session["email"])
    except Exception:
        raise _db_unavailable()
    # The email was re-registered (a pending signup replaced): the old session
    # belongs to an account that no longer exists.
    if doc is None or doc["id"] != session["id"]:
        raise HTTPException(401, "This account no longer exists.")
    if doc["role"] in RETIRED_ROLES:
        raise HTTPException(401, RETIRED_DETAIL)
    return doc


@router.get("/me")
async def me(request: Request, response: Response, session: dict = Depends(current_user)):
    doc = await _session_doc(session)
    user = db._public_user(doc)
    pending = _needs_verification(doc)
    out: dict = {"user": {**user, "owner": is_owner(user), "verificationRequired": pending}}
    if getattr(request.state, "token_pending", False) and not pending:
        # Verified since this token was issued (e.g. the code was entered on
        # another device): without a fresh token every other route would 403.
        out["token"] = create_access_token(user, email_verified=True, session_version=doc.get("session_version", 0))
    return sessions.issue(request, response, out)


class VerifyBody(BaseModel):
    code: str = Field(max_length=20)


@router.post("/verify-email")
async def verify_email(body: VerifyBody, request: Request, response: Response, session: dict = Depends(current_user)):
    doc = await _session_doc(session)
    if db.is_email_verified(doc):
        return sessions.issue(request, response, _session(doc, alreadyVerified=True))
    pending = doc.get("verify") or {}
    code = re.sub(r"\D", "", body.code)
    if not pending.get("code_hash"):
        raise HTTPException(400, "Request a new code to continue.")
    if pending.get("expires_at", 0) < time.time():
        raise HTTPException(400, "This code has expired. Request a new one.")
    if pending.get("attempts", 0) >= CODE_MAX_ATTEMPTS:
        raise HTTPException(429, "Too many wrong attempts. Request a new code.")
    if len(code) != 6 or not hmac.compare_digest(pending["code_hash"], _code_hash(doc["email"], code)):
        attempts = pending.get("attempts", 0) + 1
        await db.update_user(doc["email"], {"verify.attempts": attempts} if db.enabled()
                             else {"verify": {**pending, "attempts": attempts}})
        left = CODE_MAX_ATTEMPTS - attempts
        raise HTTPException(400, "That code isn't right." + (f" {left} attempt{'s' if left != 1 else ''} left."
                                                               if left > 0 else " Request a new code."))
    doc = await db.update_user(doc["email"], {"email_verified": True}, unset=("verify",)) or doc
    await repo.log_activity(doc["id"], "Operator", "Email address verified")
    _send_welcome(doc)
    return sessions.issue(request, response, _session(doc))


@router.post("/resend-verification")
async def resend_verification(session: dict = Depends(current_user)):
    doc = await _session_doc(session)
    if db.is_email_verified(doc):
        return {"ok": True, "alreadyVerified": True}
    if not verification_enforced():
        return {"ok": True, "required": False}
    sent_at = [t for t in (doc.get("verify") or {}).get("sent_at", []) if time.time() - t < 3600]
    if sent_at and time.time() - sent_at[-1] < RESEND_COOLDOWN_SECONDS:
        wait = int(RESEND_COOLDOWN_SECONDS - (time.time() - sent_at[-1])) + 1
        raise HTTPException(429, f"Wait {wait} seconds before requesting another code.",
                            headers={"Retry-After": str(wait)})
    if len(sent_at) >= RESENDS_PER_HOUR:
        raise HTTPException(429, "Too many codes requested. Try again in an hour.", headers={"Retry-After": "3600"})
    return {"ok": True, **(await _issue_code(doc, sent_at))}


class ChangePasswordBody(BaseModel):
    currentPassword: str = Field(default="", max_length=200)
    newPassword: str = Field(max_length=200)


@router.post("/change-password")
async def change_password(body: ChangePasswordBody, request: Request, response: Response,
                          session: dict = Depends(current_user)):
    doc = await _session_doc(session)
    email = doc["email"]
    # Accounts made with social sign-in have no password until they set one.
    if doc.get("password_hash"):
        await check_login_allowed(email)
        if not verify_password(doc, body.currentPassword):
            await record_login_failure(email)
            raise HTTPException(400, "Your current password is incorrect.")
        if body.currentPassword == body.newPassword:
            raise HTTPException(422, "Choose a password different from your current one.")
    if len(body.newPassword) < MIN_PASSWORD_LENGTH:
        raise HTTPException(422, f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    await db.update_password_hash(email, hash_password(body.newPassword))
    await clear_login_failures(email)
    # Every other session of this account ends; this one continues on a fresh token.
    doc = await db.update_user(email, {"session_version": doc.get("session_version", 0) + 1}) or doc
    await repo.log_activity(doc["id"], "Operator", "Password changed")
    fresh = create_access_token(db._public_user(doc), email_verified=not _needs_verification(doc),
                                session_version=doc.get("session_version", 0))
    return sessions.issue(request, response, {"ok": True, "token": fresh})


@router.post("/logout")
async def logout(request: Request, response: Response):
    """End this session: revoke its id server-side and clear the cookies. Safe to
    call when already signed out. A cookie session needs its CSRF token."""
    token, source = _token_from(request)
    if token:
        try:
            claims = jwt.decode(token, get_settings().secret_key, algorithms=["HS256"], options={"verify_exp": False})
        except jwt.InvalidTokenError:
            claims = None
        if claims:
            if source == "cookie":
                sessions.check_csrf(request, claims.get("jti", ""))
            await sessions.revoke_jti(claims.get("jti", ""), int(claims.get("exp", time.time() + 3600)))
            await repo.log_activity(claims["sub"], "Operator", "Signed out")
    sessions.clear_session_cookies(request, response)
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Password reset — emailed single-use link. The token is random, only its
# SHA-256 is stored, it expires in 30 minutes, and the response never says
# whether an account exists.
# --------------------------------------------------------------------------- #
RESET_TTL_SECONDS = 30 * 60
RESET_COOLDOWN_SECONDS = 60


class ForgotBody(BaseModel):
    email: str = Field(max_length=254)


class ResetBody(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(max_length=200)


@router.post("/forgot-password")
async def forgot_password(body: ForgotBody):
    email = body.email.strip().lower()
    generic = {"ok": True, "message": "If an account exists for that email, a reset link is on its way."}
    if not _EMAIL_RE.match(email):
        return generic
    try:
        doc = await db.find_user(email)
    except Exception:
        raise _db_unavailable()
    if not doc or doc.get("role") in RETIRED_ROLES or not doc.get("password_hash"):
        return generic  # unknown, retired, or social-only account: say nothing
    last = (doc.get("reset") or {}).get("sent_at", 0)
    if time.time() - last < RESET_COOLDOWN_SECONDS:
        return generic
    token = secrets.token_urlsafe(32)
    await db.update_user(email, {"reset": {
        "hash": hashlib.sha256(token.encode()).hexdigest(),
        "expires_at": time.time() + RESET_TTL_SECONDS, "sent_at": time.time(),
    }})
    link = f"{get_settings().site_url}/reset-password?token={token}"
    sent = False
    if mail.enabled():
        subject, html = mail.reset_email(doc.get("name", ""), link, RESET_TTL_SECONDS // 60)
        sent = await mail.send_email(email, subject, html)
    await repo.log_activity(doc["id"], "Operator", "Password reset requested")
    # Without an email provider (local development only) hand the link back so the flow can be completed.
    if not sent and get_settings().environment != "production":
        return {**generic, "devResetLink": link}
    return generic


@router.post("/reset-password")
async def reset_password(body: ResetBody):
    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(422, f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    try:
        doc = await db.find_user_by_reset_hash(hashlib.sha256(body.token.encode()).hexdigest())
    except Exception:
        raise _db_unavailable()
    reset = (doc or {}).get("reset") or {}
    if not doc or reset.get("expires_at", 0) < time.time():
        raise HTTPException(400, "This reset link is invalid or has expired. Request a new one.")
    email = doc["email"]
    await db.update_password_hash(email, hash_password(body.password))
    # Single use; and every existing session of the account ends.
    await db.update_user(email, {"session_version": doc.get("session_version", 0) + 1}, unset=("reset",))
    await clear_login_failures(email)
    await repo.log_activity(doc["id"], "Operator", "Password reset completed")
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Social sign-in
# --------------------------------------------------------------------------- #
@router.get("/providers")
async def providers():
    s = get_settings()
    if not verification_enforced():
        delivery = "off"
    else:
        delivery = "email" if mail.enabled() else "dev"
    return {
        "providers": [{"id": p.id, "name": p.name, "configured": oauth.configured(p.id, s)}
                      for p in oauth.PROVIDERS.values()],
        # Outside production the sign-in pages list unconfigured providers,
        # disabled, so developers can see what's available.
        "showUnconfigured": s.environment != "production",
        "emailVerification": {"enforced": verification_enforced(), "delivery": delivery},
    }


# Where to land after social sign-in: a same-origin relative path (query
# allowed), never "//", a backslash or a scheme. The frontend re-checks it.
_NEXT_RE = re.compile(r"^/(?![/\\])[A-Za-z0-9/_\-.~%?=&+]{0,300}$")


def _to_app(path: str, params: dict) -> RedirectResponse:
    return RedirectResponse(f"{get_settings().site_url}{path}?{urlencode(params)}", status_code=303)


def _fail(reason: str) -> RedirectResponse:
    return _to_app("/login", {"oauth_error": reason})


@router.get("/oauth/{provider}/start")
async def oauth_start(provider: str, role: str = "admin", next: str = ""):
    if provider not in oauth.PROVIDERS:
        raise HTTPException(404, "Unknown sign-in provider.")
    if not oauth.configured(provider):
        return _fail("not_configured")
    state = secrets.token_urlsafe(32)
    verifier, challenge = oauth.pkce_pair() if oauth.PROVIDERS[provider].pkce else (None, None)
    nonce = secrets.token_urlsafe(24) if provider == "apple" else None
    await oauth.save_state(state, {
        "provider": provider, "role": role if role in SIGNUP_ROLES else "admin",
        "next": next if _NEXT_RE.match(next or "") else "", "verifier": verifier, "nonce": nonce,
    })
    return RedirectResponse(oauth.authorize_url(provider, state, challenge=challenge, nonce=nonce), status_code=303)


async def _account_for(ident: oauth.Identity, provider: str, role: str) -> tuple[dict, bool]:
    """The account this provider identity signs in to, creating or linking it.
    Returns (user document, created)."""
    linked = await db.find_identity(provider, ident.subject)
    doc = await db.find_user(linked["email"]) if linked else None
    if doc is None:
        doc = await db.find_user(ident.email)
        if doc is not None:
            # Only an email the provider vouches for may join an existing account.
            if not ident.email_verified:
                raise oauth.OAuthError("email_conflict")
            if doc["role"] in RETIRED_ROLES:
                raise oauth.OAuthError("retired")
            await db.link_identity(provider, ident.subject, doc["email"])
            if not db.is_email_verified(doc):
                doc = await db.update_user(doc["email"], {"email_verified": True}, unset=("verify",)) or doc
            return doc, False
        name = ident.name or ident.email.split("@")[0].replace(".", " ").title()
        created = await db.create_user(name, ident.email, "", role, None, extra={
            "email_verified": ident.email_verified, "profile": {}, "auth_provider": provider,
        })
        if created is None:  # a concurrent signup took the email
            raise oauth.OAuthError("email_conflict")
        await db.link_identity(provider, ident.subject, ident.email)
        doc = await db.find_user(ident.email) or {}
        await repo.log_activity(doc["id"], "Operator", f"Account created with {oauth.PROVIDERS[provider].name} ({role})")
        return doc, True
    if doc["role"] in RETIRED_ROLES:
        raise oauth.OAuthError("retired")
    return doc, False


async def _finish(provider: str, state: str, code: str, error: str, apple_user: str = "") -> RedirectResponse:
    if provider not in oauth.PROVIDERS:
        return _fail("unknown_provider")
    pending = await oauth.take_state(state or "")
    if not pending or pending.get("provider") != provider:
        return _fail("expired")
    if error:
        return _fail("denied" if error in ("access_denied", "user_cancelled_authorize") else "provider_error")
    if not code or len(code) > 2000:
        return _fail("provider_error")
    if not oauth.configured(provider):
        return _fail("not_configured")
    try:
        ident = await oauth.identify(provider, code, verifier=pending.get("verifier"), nonce=pending.get("nonce"),
                                     apple_user=apple_user)
        doc, created = await _account_for(ident, provider, pending["role"])
    except oauth.OAuthError as e:
        return _fail(e.reason)
    except Exception:
        log.exception("social sign-in failed", extra={"provider": provider})
        return _fail("server_error")
    if created and _needs_verification(doc):
        await _issue_code(doc, [])
    elif created:
        _send_welcome(doc)
    if not created:
        await repo.log_activity(doc["id"], "Operator", f"Signed in with {oauth.PROVIDERS[provider].name}")
    handoff = await oauth.create_handoff({"email": doc["email"], "created": created, "next": pending.get("next", "")})
    return _to_app("/auth/callback", {"code": handoff})


@router.get("/oauth/{provider}/callback")
async def oauth_callback(provider: str, state: str = "", code: str = "", error: str = ""):
    return await _finish(provider, state, code, error)


@router.post("/oauth/{provider}/callback")
async def oauth_callback_post(provider: str, request: Request):
    # Sign in with Apple uses response_mode=form_post (urlencoded).
    raw = (await request.body())[:20_000].decode("utf-8", "replace")
    form = {k: v[0] for k, v in parse_qs(raw).items() if v}
    return await _finish(provider, form.get("state", ""), form.get("code", ""), form.get("error", ""),
                         apple_user=form.get("user", "")[:2000])


class ExchangeBody(BaseModel):
    code: str = Field(max_length=200)


@router.post("/oauth/exchange")
async def oauth_exchange(body: ExchangeBody, request: Request, response: Response):
    handoff = await oauth.take_handoff(body.code)
    if not handoff:
        raise HTTPException(400, "This sign-in link has expired. Sign in again.")
    doc = await db.find_user(handoff["email"])
    if doc is None:
        raise HTTPException(400, "This sign-in link has expired. Sign in again.")
    return sessions.issue(request, response, _session(doc, newAccount=bool(handoff.get("created")), next=handoff.get("next") or ""))
