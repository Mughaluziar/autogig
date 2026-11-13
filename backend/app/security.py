"""Security layer — headers, rate limiting, request IDs, optional API-key auth.

Cybersecurity posture for the in-memory phase:
- SecurityHeadersMiddleware: hardened HTTP response headers on every request.
- RateLimitMiddleware: per-IP sliding-window rate limit (abuse protection).
- ApiKeyMiddleware: personal API keys (routers/api_keys.py) authenticate a
  request as the key's owner. Separately, when API_KEY env is set, all other
  non-GET requests require that X-API-Key header. Disabled by default in
  local dev.
- Every request gets an X-Request-Id for traceability (audit correlation).
"""
import time
import uuid
from collections import defaultdict, deque
from datetime import timedelta

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from . import auth, db
from .access import store as access_store
from .config import get_settings
from .routers.api_keys import KEY_PREFIX, hash_key, is_active

# Sliding window: max N requests per IP per 60s window
_RATE_WINDOW = 60.0
_RATE_MAX = 240
_hits: dict[str, deque] = defaultdict(deque)
# Credential endpoints get a much tighter per-IP budget (brute force, signup
# and reset-email abuse) on top of the general limit.
_AUTH_RATE_MAX = 20
_AUTH_PATHS = ("/auth/login", "/auth/signup", "/auth/forgot-password", "/auth/reset-password",
               "/auth/verify-email", "/auth/resend-verification", "/auth/change-password")
_auth_hits: dict[str, deque] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    # uvicorn --proxy-headers (see render.yaml) already rewrites client.host
    # from X-Forwarded-For when the proxy is trusted.
    return request.client.host if request.client else "unknown"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request.state.request_id = uuid.uuid4().hex[:12]
        response = await call_next(request)
        response.headers["X-Request-Id"] = request.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["X-XSS-Protection"] = "0"
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        ip = _client_ip(request)
        now = time.monotonic()
        if request.method == "POST" and request.url.path.endswith(_AUTH_PATHS):
            aq = _auth_hits[ip]
            while aq and now - aq[0] > _RATE_WINDOW:
                aq.popleft()
            if len(aq) >= _AUTH_RATE_MAX:
                return JSONResponse(
                    {"detail": "Too many attempts. Wait a minute and try again."}, status_code=429,
                    headers={"Retry-After": str(int(_RATE_WINDOW))},
                )
            aq.append(now)
        q = _hits[ip]
        while q and now - q[0] > _RATE_WINDOW:
            q.popleft()
        if len(q) >= _RATE_MAX:
            return JSONResponse(
                {"detail": "Rate limit exceeded"}, status_code=429,
                headers={"Retry-After": str(int(_RATE_WINDOW))},
            )
        q.append(now)
        return await call_next(request)


# Paths a personal API key may never call, relative to the API prefix: a
# leaked key must not mint more keys, change sign-in details or move the team.
_KEY_BLOCKED = ("/api-keys", "/auth/", "/team")
_READ_METHODS = ("GET", "HEAD", "OPTIONS")
_TOUCH_EVERY = timedelta(seconds=60)


def _personal_key(request: Request) -> str | None:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() == "bearer" and token.strip().startswith(KEY_PREFIX):
        return token.strip()
    header = request.headers.get("x-api-key", "").strip()
    return header if header.startswith(KEY_PREFIX) else None


async def _authenticate_personal_key(request: Request, raw: str) -> JSONResponse | None:
    """Swap a valid personal key for a short-lived session token on this
    request, so every route's normal session guard applies unchanged.
    Returns an error response when the key can't be used."""
    try:
        key = await access_store.find_key_by_hash(hash_key(raw))
        account = await db.find_user(key["email"]) if key else None
    except Exception:
        return JSONResponse({"detail": "Account service is temporarily unavailable."}, status_code=503)
    if (not key or not is_active(key) or not account or account["id"] != key["user_id"]
            or account.get("role") in getattr(auth, "RETIRED_ROLES", ())):
        return JSONResponse({"detail": "Invalid, expired or revoked API key."}, status_code=401,
                            headers={"WWW-Authenticate": "Bearer"})
    prefix = get_settings().api_prefix
    path = request.url.path
    relative = path[len(prefix):] if prefix and path.startswith(prefix) else path
    if relative.startswith(_KEY_BLOCKED):
        return JSONResponse({"detail": "API keys can't manage keys, sign-in details or your team. Sign in instead."},
                            status_code=403)
    if request.method not in _READ_METHODS and "write" not in key.get("scopes", []):
        return JSONResponse({"detail": "This API key is read-only."}, status_code=403)
    token = auth.create_access_token(db._public_user(account))
    headers = [(k, v) for k, v in request.scope["headers"] if k not in (b"authorization", b"x-api-key")]
    headers.append((b"authorization", f"Bearer {token}".encode()))
    request.scope["headers"] = headers
    request.state.api_key_id = key["id"]
    stamp = access_store.now()
    last = key.get("last_used_at")
    if not last or stamp - last >= _TOUCH_EVERY:
        try:
            await access_store.touch_key(key["id"], stamp)
        except Exception:
            pass  # bookkeeping only — never fail the request over it
    return None


class ApiKeyMiddleware(BaseHTTPMiddleware):
    """API-key authentication.

    Personal keys (apk_…) sent as a Bearer token or X-API-Key act as their
    owner — see _authenticate_personal_key. A request with a valid personal
    key is a known caller, so the global gate below doesn't apply to it.

    Global gate: set API_KEY in backend/.env to require X-API-Key on
    POST/PATCH/DELETE. Health + GETs stay open (dashboard read paths).
    Disabled when unset.
    """

    _SAFE_PREFIXES = ("/health", "/docs", "/openapi.json", "/api/meta")

    async def dispatch(self, request: Request, call_next):
        raw = _personal_key(request)
        if raw:
            error = await _authenticate_personal_key(request, raw)
            return error or await call_next(request)
        api_key = getattr(get_settings(), "api_key", None) or None
        if not api_key:
            return await call_next(request)
        # The inbound webhook has its own constant-time Bearer secret check.
        # Exempt it from the general browser/API key so mail providers can post.
        # Same for provider webhooks, which verify an HMAC signature, and Sign
        # in with Apple's form post (its single-use state authenticates it).
        if request.url.path.endswith(("/inbox/inbound", "/orders/webhooks/nango", "/payments/stripe/webhook",
                                      "/auth/oauth/apple/callback")):
            return await call_next(request)
        # Invoice pay links: clients pay from a public page with no API key.
        # The link token authorises checkout, and the amount comes from the
        # stored invoice, never the request.
        if "/pay/" in request.url.path and request.url.path.endswith("/checkout"):
            return await call_next(request)
        if request.method in ("GET", "HEAD", "OPTIONS") or request.url.path.startswith(self._SAFE_PREFIXES):
            return await call_next(request)
        if request.headers.get("x-api-key") != api_key:
            return JSONResponse({"detail": "Invalid or missing API key"}, status_code=401)
        return await call_next(request)
