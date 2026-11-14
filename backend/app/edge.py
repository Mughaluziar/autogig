"""Edge proof: lets the API tell a request that came through our own Vercel proxy from one sent straight to the API.

The Next.js middleware (middleware.ts) signs every proxied /api request with a secret that exists only in the two
servers' environments: headers X-Edge-Ts (unix seconds), X-Edge-Ip (the client address Vercel saw) and X-Edge-Sig =
hex HMAC-SHA256(secret, "ts\\nMETHOD\\npath\\nip"). This module verifies them. A verified request's client IP is trusted
(no proxy-hop guessing); anything else is a direct request and keeps the socket/X-Forwarded-For handling in
security.client_ip. With REQUIRE_EDGE_PROOF=true direct requests to browser-facing routes are refused (403), so the
public Render URL cannot be used to get around the frontend's protections.

The browser never sees the secret: it is added server-side on the way to the API and is not part of any response.
Rotation: set the new value as EDGE_SHARED_SECRET and the old one as EDGE_SHARED_SECRET_PREVIOUS on both sides."""
import hashlib
import hmac
import time

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from .config import get_settings

HEADER_TS, HEADER_IP, HEADER_SIG = "x-edge-ts", "x-edge-ip", "x-edge-sig"

# Machine callers that legitimately reach the API directly (their own signature or secret authenticates them) and
# the health check. Relative to the API prefix.
DIRECT_ALLOWED_SUFFIXES = ("/inbox/inbound", "/payments/stripe/webhook", "/orders/webhooks/nango")
DIRECT_ALLOWED_PREFIXES = ("/auth/oauth/",)       # provider redirects (the callback URL is configured by the operator)
DIRECT_ALLOWED_EXACT = ("/health",)


def sign(secret: str, ts: str, method: str, path: str, ip: str) -> str:
    """`path` is the URL path after one round of percent-decoding (what the framework reports as request.url.path)."""
    message = f"{ts}\n{method.upper()}\n{path}\n{ip}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def _secrets() -> list[str]:
    s = get_settings()
    return [v for v in (s.edge_shared_secret, s.edge_shared_secret_previous) if v and v.strip()]


def verify(request: Request, now: float | None = None) -> tuple[bool, str]:
    """(verified, reason). The reason is for diagnostics only; it never contains the secret or signature."""
    secrets_ = _secrets()
    if not secrets_:
        return False, "not configured"
    ts = request.headers.get(HEADER_TS, "")
    ip = request.headers.get(HEADER_IP, "")
    sig = request.headers.get(HEADER_SIG, "")
    if not (ts and ip and sig):
        return False, "absent"
    try:
        age = abs((now if now is not None else time.time()) - int(ts))
    except ValueError:
        return False, "invalid timestamp"
    if age > get_settings().edge_max_skew_seconds:
        return False, "expired"
    if len(ip) > 64:
        return False, "invalid"
    path = request.url.path
    for secret in secrets_:
        if hmac.compare_digest(sign(secret, ts, request.method, path, ip), sig):
            return True, "verified"
    return False, "invalid signature"


def direct_allowed(request: Request) -> bool:
    prefix = get_settings().api_prefix
    path = request.url.path
    relative = path[len(prefix):] if prefix and path.startswith(prefix) else path
    if path in DIRECT_ALLOWED_EXACT or relative in DIRECT_ALLOWED_EXACT:
        return True
    if relative.endswith(DIRECT_ALLOWED_SUFFIXES) or relative.startswith(DIRECT_ALLOWED_PREFIXES):
        return True
    # Personal API keys come from scripts, not from the website; they have their own per-key checks and limits.
    auth_header = request.headers.get("authorization", "")
    token = auth_header.partition(" ")[2].strip() if auth_header.lower().startswith("bearer ") else ""
    return token.startswith("apk_") or request.headers.get("x-api-key", "").startswith("apk_")


class EdgeProofMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Whatever the caller sent in these headers is never trusted unless the signature checks out.
        verified, reason = verify(request)
        request.state.edge_verified = verified
        request.state.edge_reason = reason
        request.state.edge_ip = request.headers.get(HEADER_IP, "")[:64] if verified else None
        if not verified and get_settings().require_edge_proof and not direct_allowed(request) and request.method != "OPTIONS":
            return JSONResponse({"detail": "Requests must come through the website."}, status_code=403)
        return await call_next(request)
