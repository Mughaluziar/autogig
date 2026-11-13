"""Browser sessions: HttpOnly cookie, CSRF token, server-side revocation.

Architecture: the browser only ever talks to the frontend origin. The frontend
proxies /api/* to this API (Next.js rewrite), so the session cookie is
first-party and SameSite=Lax works. The bearer-token path stays for API keys,
scripts and tests; it is not cookie-authenticated, so CSRF does not apply to it.

* Cookie `autopilot_session` (HttpOnly, Secure outside local http, SameSite=Lax,
  Path=/): the signed session JWT. JavaScript can never read it.
* Cookie `autopilot_csrf` (readable by JS): HMAC(secret, "csrf:"+jti). The page
  echoes it in `X-CSRF-Token` on every unsafe request. It is bound to this
  session, so a token from another session or site is useless.
* Every cookie-authenticated unsafe request must carry a matching
  `X-CSRF-Token`, and a browser `Origin` that is one of our own origins.
* Logout revokes the session's `jti` server-side (a copied cookie stops
  working). Changing or resetting the password bumps the account's
  `session_version`, which revokes every older session.
"""
import hashlib
import hmac
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, Response

from . import db
from .config import get_settings

SESSION_COOKIE = "autopilot_session"
CSRF_COOKIE = "autopilot_csrf"
MODE_HEADER = "x-session-mode"
CSRF_HEADER = "x-csrf-token"
UNSAFE = ("POST", "PUT", "PATCH", "DELETE")

# Revoked session ids (logout). MongoDB `revoked_sessions` with a TTL index; memory otherwise.
_mem_revoked: dict[str, float] = {}


def reset_memory() -> None:
    _mem_revoked.clear()


async def ensure_indexes() -> None:
    if db.enabled():
        await db._get_db().revoked_sessions.create_index("expires_at", expireAfterSeconds=0)


async def revoke_jti(jti: str, exp: int) -> None:
    if not jti:
        return
    if db.enabled():
        await db._get_db().revoked_sessions.update_one(
            {"_id": jti}, {"$set": {"expires_at": datetime.fromtimestamp(exp, timezone.utc)}}, upsert=True)
        return
    _mem_revoked[jti] = float(exp)


async def is_revoked(jti: str) -> bool:
    if not jti:
        return False
    if db.enabled():
        return await db._get_db().revoked_sessions.find_one({"_id": jti}, {"_id": 1}) is not None
    return jti in _mem_revoked


def csrf_for(jti: str) -> str:
    return hmac.new(get_settings().secret_key.encode(), f"csrf:{jti}".encode(), hashlib.sha256).hexdigest()


def cookie_mode(request: Request) -> bool:
    """The browser app asks for cookie sessions; scripts and API clients get a token in the body."""
    return request.headers.get(MODE_HEADER, "").lower() == "cookie"


def _secure(request: Request) -> bool:
    forced = get_settings().cookie_secure_flag
    if forced is not None:
        return forced
    proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip().lower()
    return get_settings().environment == "production" or proto == "https"


def set_session_cookies(request: Request, response: Response, token: str, jti: str, max_age: int) -> None:
    secure = _secure(request)
    response.set_cookie(SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=secure,
                        samesite="lax", path="/")
    response.set_cookie(CSRF_COOKIE, csrf_for(jti), max_age=max_age, httponly=False, secure=secure,
                        samesite="lax", path="/")


def clear_session_cookies(request: Request, response: Response) -> None:
    secure = _secure(request)
    for name, http_only in ((SESSION_COOKIE, True), (CSRF_COOKIE, False)):
        response.delete_cookie(name, path="/", httponly=http_only, secure=secure, samesite="lax")


def allowed_origins() -> set[str]:
    s = get_settings()
    return {o.rstrip("/").lower() for o in [*s.cors_origin_list, s.site_url] if o}


def check_origin(request: Request) -> None:
    """A browser always sends Origin on cross-site and on unsafe requests. If it
    is present it must be one of ours (stops login CSRF and cross-site posts)."""
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/").lower() not in allowed_origins():
        raise HTTPException(403, "Request blocked: unexpected origin.")


def check_csrf(request: Request, jti: str) -> None:
    check_origin(request)
    sent = request.headers.get(CSRF_HEADER, "")
    if not jti or not sent or not hmac.compare_digest(sent, csrf_for(jti)):
        raise HTTPException(403, "CSRF check failed. Reload the page and try again.")


def issue(request: Request, response: Response, payload: dict) -> dict:
    """Cookie mode: move the token out of the JSON body into HttpOnly cookies."""
    token = payload.get("token")
    if token and cookie_mode(request):
        import jwt  # claims were just signed by us; only reading jti/exp
        claims = jwt.decode(token, options={"verify_signature": False})
        max_age = max(int(claims["exp"] - datetime.now(timezone.utc).timestamp()), 0)
        set_session_cookies(request, response, token, claims.get("jti", ""), max_age)
        payload = {k: v for k, v in payload.items() if k != "token"}
    return payload
