"""Social sign-in — Google, Apple, GitHub and Microsoft (OAuth 2.0 / OpenID Connect).

Flow (routers/auth.py):
  GET  /api/auth/oauth/<provider>/start?role=&next=   -> 303 to the provider
  GET  /api/auth/oauth/<provider>/callback            -> Google, GitHub, Microsoft
  POST /api/auth/oauth/apple/callback                 -> Apple (response_mode=form_post)
  POST /api/auth/oauth/exchange {code}                -> {token, user}

The state sent to the provider is random, stored only as a SHA-256 hash, single
use and valid for 10 minutes; it carries the PKCE verifier (Google, GitHub,
Microsoft) or the OIDC nonce (Apple) server-side. The callback never puts a
session token in a URL: it redirects to the app's /auth/callback with a
one-time handoff code (2 minutes, single use), which the page trades for the
session over POST.

A provider is offered only when its credentials and PUBLIC_API_URL are set.
Every network call goes through _post_form/_get_json/_apple_keys so tests can
stand in for the providers.
"""
import base64
import hashlib
import json
import secrets
import time
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
import jwt

from . import db
from .config import Settings, get_settings

STATE_TTL = timedelta(minutes=10)
HANDOFF_TTL = timedelta(minutes=2)
APPLE_ISSUER = "https://appleid.apple.com"
# Personal Microsoft accounts sign in through this tenant; their email is the
# account's own, verified address.
MS_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad"


class OAuthError(Exception):
    """Sign-in failed. `reason` is a short code that's safe to put in a URL."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass
class Identity:
    subject: str
    email: str
    email_verified: bool
    name: str


@dataclass(frozen=True)
class Provider:
    id: str
    name: str
    pkce: bool


PROVIDERS: dict[str, Provider] = {
    "google": Provider("google", "Google", pkce=True),
    "apple": Provider("apple", "Apple", pkce=False),
    "github": Provider("github", "GitHub", pkce=True),
    "microsoft": Provider("microsoft", "Microsoft", pkce=True),
}


def configured(provider: str, settings: Settings | None = None) -> bool:
    s = settings or get_settings()
    if not s.public_api_url.strip():
        return False
    if provider == "google":
        return bool(s.google_client_id and s.google_client_secret)
    if provider == "github":
        return bool(s.github_client_id and s.github_client_secret)
    if provider == "microsoft":
        return bool(s.microsoft_client_id and s.microsoft_client_secret)
    if provider == "apple":
        return bool(s.apple_client_id and s.apple_team_id and s.apple_key_id and s.apple_private_key)
    return False


def redirect_uri(provider: str, settings: Settings | None = None) -> str:
    s = settings or get_settings()
    return f"{s.public_api_url.strip().rstrip('/')}{s.api_prefix}/auth/oauth/{provider}/callback"


def _ms_base(s: Settings) -> str:
    tenant = (s.microsoft_tenant or "common").strip() or "common"
    return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0"


# --------------------------------------------------------------------------- #
# Authorization URL
# --------------------------------------------------------------------------- #
def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def authorize_url(provider: str, state: str, *, challenge: str | None = None, nonce: str | None = None) -> str:
    s = get_settings()
    redirect = redirect_uri(provider, s)
    if provider == "google":
        params = {"client_id": s.google_client_id, "redirect_uri": redirect, "response_type": "code",
                  "scope": "openid email profile", "state": state, "prompt": "select_account"}
        base = "https://accounts.google.com/o/oauth2/v2/auth"
    elif provider == "github":
        params = {"client_id": s.github_client_id, "redirect_uri": redirect, "scope": "read:user user:email",
                  "state": state, "allow_signup": "true"}
        base = "https://github.com/login/oauth/authorize"
    elif provider == "microsoft":
        params = {"client_id": s.microsoft_client_id, "redirect_uri": redirect, "response_type": "code",
                  "response_mode": "query", "scope": "openid email profile", "state": state,
                  "prompt": "select_account"}
        base = f"{_ms_base(s)}/authorize"
    elif provider == "apple":
        params = {"client_id": s.apple_client_id, "redirect_uri": redirect, "response_type": "code",
                  "response_mode": "form_post", "scope": "name email", "state": state, "nonce": nonce or ""}
        base = f"{APPLE_ISSUER}/auth/authorize"
    else:
        raise OAuthError("unknown_provider")
    if challenge:
        params.update(code_challenge=challenge, code_challenge_method="S256")
    return f"{base}?{urlencode(params)}"


# --------------------------------------------------------------------------- #
# Network — replaced in tests
# --------------------------------------------------------------------------- #
async def _post_form(url: str, data: dict, headers: dict | None = None) -> tuple[int, dict]:
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            res = await http.post(url, data=data, headers={"Accept": "application/json", **(headers or {})})
    except httpx.HTTPError:
        raise OAuthError("unreachable")
    try:
        return res.status_code, res.json()
    except ValueError:
        return res.status_code, {}


async def _get_json(url: str, token: str, headers: dict | None = None) -> tuple[int, object]:
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            res = await http.get(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json",
                                               **(headers or {})})
    except httpx.HTTPError:
        raise OAuthError("unreachable")
    try:
        return res.status_code, res.json()
    except ValueError:
        return res.status_code, {}


_apple_cache: dict = {"keys": None, "at": 0.0}


async def _apple_keys() -> list[dict]:
    if _apple_cache["keys"] and time.time() - _apple_cache["at"] < 3600:
        return _apple_cache["keys"]
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            res = await http.get(f"{APPLE_ISSUER}/auth/keys")
        keys = res.json().get("keys", []) if res.status_code == 200 else []
    except (httpx.HTTPError, ValueError):
        raise OAuthError("unreachable")
    if keys:
        _apple_cache.update(keys=keys, at=time.time())
    return keys


# --------------------------------------------------------------------------- #
# Code exchange + identity
# --------------------------------------------------------------------------- #
def apple_client_secret(s: Settings) -> str:
    """Apple's client secret is a short-lived ES256 JWT signed with the
    Sign in with Apple key."""
    key = (s.apple_private_key or "").replace("\\n", "\n").strip()
    now = int(time.time())
    claims = {"iss": s.apple_team_id, "iat": now, "exp": now + 300, "aud": APPLE_ISSUER, "sub": s.apple_client_id}
    try:
        return jwt.encode(claims, key, algorithm="ES256", headers={"kid": s.apple_key_id})
    except (ValueError, TypeError, jwt.PyJWTError):
        raise OAuthError("not_configured")


async def _exchange(provider: str, code: str, verifier: str | None) -> dict:
    s = get_settings()
    form = {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri(provider, s)}
    if provider == "google":
        url = "https://oauth2.googleapis.com/token"
        form.update(client_id=s.google_client_id, client_secret=s.google_client_secret)
    elif provider == "github":
        url = "https://github.com/login/oauth/access_token"
        form.update(client_id=s.github_client_id, client_secret=s.github_client_secret)
    elif provider == "microsoft":
        url = f"{_ms_base(s)}/token"
        form.update(client_id=s.microsoft_client_id, client_secret=s.microsoft_client_secret)
    else:  # apple
        url = f"{APPLE_ISSUER}/auth/token"
        form.update(client_id=s.apple_client_id, client_secret=apple_client_secret(s))
    if verifier:
        form["code_verifier"] = verifier
    status, body = await _post_form(url, form)
    if status != 200 or not isinstance(body, dict) or body.get("error") or not body.get("access_token"):
        raise OAuthError("rejected")
    return body


def _truthy(value) -> bool:
    return value is True or (isinstance(value, str) and value.lower() == "true") or value == 1


async def _google(tokens: dict) -> Identity:
    status, info = await _get_json("https://openidconnect.googleapis.com/v1/userinfo", tokens["access_token"])
    if status != 200 or not isinstance(info, dict) or not info.get("sub"):
        raise OAuthError("rejected")
    return Identity(str(info["sub"]), str(info.get("email") or ""), _truthy(info.get("email_verified")),
                    str(info.get("name") or ""))


async def _github(tokens: dict) -> Identity:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "Autopilot"}
    status, user = await _get_json("https://api.github.com/user", tokens["access_token"], headers)
    if status != 200 or not isinstance(user, dict) or not user.get("id"):
        raise OAuthError("rejected")
    status, emails = await _get_json("https://api.github.com/user/emails", tokens["access_token"], headers)
    emails = emails if status == 200 and isinstance(emails, list) else []
    verified = [e for e in emails if isinstance(e, dict) and e.get("verified") and e.get("email")]
    pick = next((e for e in verified if e.get("primary")), verified[0] if verified else None)
    if pick:
        return Identity(str(user["id"]), pick["email"], True, str(user.get("name") or user.get("login") or ""))
    return Identity(str(user["id"]), str(user.get("email") or ""), False, str(user.get("name") or user.get("login") or ""))


def _unverified_claims(id_token: str, audience: str) -> dict:
    """Claims of an ID token received straight from the provider's token
    endpoint over TLS (OIDC Core 3.1.3.7 lets TLS stand in for the signature
    here); the audience and expiry are still checked."""
    try:
        claims = jwt.decode(id_token, options={"verify_signature": False})
    except jwt.PyJWTError:
        raise OAuthError("rejected")
    aud = claims.get("aud")
    if (aud != audience and not (isinstance(aud, list) and audience in aud)) or claims.get("exp", 0) < time.time():
        raise OAuthError("rejected")
    return claims


async def _microsoft(tokens: dict) -> Identity:
    s = get_settings()
    if not tokens.get("id_token"):
        raise OAuthError("rejected")
    claims = _unverified_claims(tokens["id_token"], s.microsoft_client_id or "")
    subject = f"{claims.get('tid', '')}:{claims.get('oid') or claims.get('sub')}"
    email = str(claims.get("email") or "")
    # Work accounts can carry an email their tenant never proved it owns, so it
    # only counts as verified for personal accounts or a domain-verified tenant.
    verified = bool(email) and (claims.get("tid") == MS_CONSUMER_TENANT or _truthy(claims.get("xms_edov")))
    if not email and "@" in str(claims.get("preferred_username") or ""):
        email = str(claims["preferred_username"])
    return Identity(subject, email, verified, str(claims.get("name") or ""))


async def verify_apple_id_token(id_token: str, nonce: str) -> dict:
    s = get_settings()
    try:
        kid = jwt.get_unverified_header(id_token).get("kid")
    except jwt.PyJWTError:
        raise OAuthError("rejected")
    key = next((k for k in await _apple_keys() if k.get("kid") == kid), None)
    if not key:
        raise OAuthError("rejected")
    try:
        claims = jwt.decode(id_token, jwt.PyJWK(key).key, algorithms=["RS256"],
                            audience=s.apple_client_id, issuer=APPLE_ISSUER)
    except jwt.PyJWTError:
        raise OAuthError("rejected")
    if not nonce or not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
        raise OAuthError("rejected")
    return claims


async def _apple(tokens: dict, nonce: str, user_json: str) -> Identity:
    if not tokens.get("id_token"):
        raise OAuthError("rejected")
    claims = await verify_apple_id_token(tokens["id_token"], nonce)
    name = ""
    # Apple sends the name once, on the first sign-in, in the form post.
    try:
        parsed = json.loads(user_json) if user_json else {}
        n = parsed.get("name") or {}
        name = " ".join(p for p in (n.get("firstName"), n.get("lastName")) if p)
    except (ValueError, AttributeError):
        pass
    return Identity(str(claims["sub"]), str(claims.get("email") or ""), _truthy(claims.get("email_verified")), name)


async def identify(provider: str, code: str, *, verifier: str | None, nonce: str | None, apple_user: str = "") -> Identity:
    tokens = await _exchange(provider, code, verifier)
    if provider == "google":
        ident = await _google(tokens)
    elif provider == "github":
        ident = await _github(tokens)
    elif provider == "microsoft":
        ident = await _microsoft(tokens)
    else:
        ident = await _apple(tokens, nonce or "", apple_user)
    ident.email = ident.email.strip().lower()
    if not ident.email or "@" not in ident.email or len(ident.email) > 254:
        raise OAuthError("no_email")
    return ident


# --------------------------------------------------------------------------- #
# Pending states and session handoffs — MongoDB, in memory without it
# --------------------------------------------------------------------------- #
_mem: dict[str, dict[str, dict]] = {"states": {}, "handoffs": {}, "signup_proofs": {}}


def reset_memory() -> None:
    for items in _mem.values():
        items.clear()
    _apple_cache.update(keys=None, at=0.0)


def now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _aware(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    out = deepcopy({k: v for k, v in doc.items() if k != "_id"})
    exp = out.get("expires_at")
    if isinstance(exp, datetime) and exp.tzinfo is None:
        out["expires_at"] = exp.replace(tzinfo=timezone.utc)
    return out


async def ensure_indexes() -> None:
    if not db.enabled():
        return
    mdb = db._get_db()
    await mdb.oauth_states.create_index("expires_at", expireAfterSeconds=0)
    await mdb.oauth_handoffs.create_index("expires_at", expireAfterSeconds=0)
    await mdb.oauth_signup_proofs.create_index("expires_at", expireAfterSeconds=0)


async def _put(kind: str, raw: str, fields: dict, ttl: timedelta) -> None:
    doc = {**fields, "_id": _hash(raw), "created_at": now(), "expires_at": now() + ttl}
    if not db.enabled():
        _mem[kind][doc["_id"]] = deepcopy(doc)
        return
    await getattr(db._get_db(), f"oauth_{kind}").insert_one(doc)


async def _take(kind: str, raw: str) -> dict | None:
    """Return and delete in one step (single use); None when missing or expired."""
    if not 20 <= len(raw) <= 200:
        return None
    key = _hash(raw)
    if not db.enabled():
        doc = _aware(_mem[kind].pop(key, None))
    else:
        doc = _aware(await getattr(db._get_db(), f"oauth_{kind}").find_one_and_delete({"_id": key}))
    if not doc or doc["expires_at"] <= now():
        return None
    return doc


async def save_state(state: str, fields: dict) -> None:
    await _put("states", state, fields, STATE_TTL)


async def take_state(state: str) -> dict | None:
    return await _take("states", state)


async def create_handoff(fields: dict) -> str:
    code = secrets.token_urlsafe(32)
    await _put("handoffs", code, fields, HANDOFF_TTL)
    return code


async def take_handoff(code: str) -> dict | None:
    return await _take("handoffs", code)


async def create_signup_proof(email_key: str) -> str:
    code = secrets.token_urlsafe(24)
    await _put("signup_proofs", code, {"email_key": email_key}, timedelta(minutes=15))
    return code


async def take_signup_proof(code: str, email_key: str) -> bool:
    proof = await _take("signup_proofs", code)
    return proof is not None and secrets.compare_digest(proof["email_key"], email_key)
