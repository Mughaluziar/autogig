"""Upwork OAuth 2.0 and GraphQL, called directly with httpx.

Flow (authorization code grant, confidential client):
  1. authorize_url() sends the user to Upwork with a single-use `state`.
  2. Upwork redirects to UPWORK_REDIRECT_URI with `code`; exchange_code()
     swaps it for an access token and a refresh token.
  3. access_token() hands out a valid access token, refreshing it shortly
     before it expires. graphql() retries once with a fresh token on a 401.

Tokens are encrypted before they're stored (app/crypto.py) and never leave
the backend. A refresh token Upwork rejects marks the connection
`needs_reauth`; the user then reconnects.

Endpoints, from Upwork's OAuth 2.0 and GraphQL docs:
  authorize  https://www.upwork.com/ab/account-security/oauth2/authorize
  token      https://www.upwork.com/api/v3/oauth2/token
  graphql    https://api.upwork.com/graphql
"""
import logging
from datetime import timedelta
from urllib.parse import urlencode

import httpx

from .. import crypto
from ..config import Settings, get_settings
from . import store

log = logging.getLogger("autopilot.upwork")

AUTHORIZE_URL = "https://www.upwork.com/ab/account-security/oauth2/authorize"
TOKEN_URL = "https://www.upwork.com/api/v3/oauth2/token"
GRAPHQL_URL = "https://api.upwork.com/graphql"
# Refresh this long before the access token expires.
REFRESH_MARGIN = timedelta(minutes=5)
# Upwork documents 24-hour access tokens; used when a response omits expires_in.
DEFAULT_TOKEN_TTL = timedelta(hours=24)
_TIMEOUT = httpx.Timeout(20.0, connect=5.0)

IDENTIFY_QUERY = "query { user { id nid name } }"


class UpworkAuthError(Exception):
    """Upwork rejected the credentials (bad code, revoked or expired refresh
    token, 401). The user needs to reconnect; retrying won't help."""


class UpworkCallError(Exception):
    """Upwork couldn't be reached or answered with a server error. Retryable."""


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
def missing_settings(settings: Settings) -> list[str]:
    missing = [name for name, value in (
        ("UPWORK_CLIENT_ID", settings.upwork_client_id),
        ("UPWORK_CLIENT_SECRET", settings.upwork_client_secret),
        ("UPWORK_REDIRECT_URI", settings.upwork_redirect_uri),
    ) if not (value or "").strip()]
    if crypto.key_problem(settings.token_encryption_key):
        missing.append("TOKEN_ENCRYPTION_KEY")
    return missing


def oauth_configured(settings: Settings) -> bool:
    return not missing_settings(settings)


def connect_enabled(settings: Settings) -> bool:
    """Users may connect Upwork accounts: OAuth is configured and Upwork has
    approved commercial use in writing."""
    return oauth_configured(settings) and settings.upwork_commercial_approved


def connect_blocker(settings: Settings) -> str | None:
    """Why connecting is off here, in words a user can act on; None when on."""
    if not settings.upwork_commercial_approved:
        return "Upwork hasn't approved commercial API access for this app yet."
    missing = missing_settings(settings)
    if missing:
        return f"Upwork sign-in isn't configured on the server ({', '.join(missing)})."
    return None


def authorize_url(settings: Settings, state: str) -> str:
    return f"{AUTHORIZE_URL}?" + urlencode({
        "response_type": "code",
        "client_id": settings.upwork_client_id,
        "redirect_uri": settings.upwork_redirect_uri,
        "state": state,
    })


# --------------------------------------------------------------------------- #
# HTTP (tests replace these two functions)
# --------------------------------------------------------------------------- #
async def _token_request(form: dict) -> tuple[int, dict | None]:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
            res = await client.post(TOKEN_URL, data=form, headers={"Accept": "application/json"})
    except httpx.HTTPError as exc:
        log.warning("Upwork token endpoint unreachable: %s", type(exc).__name__)
        raise UpworkCallError("Couldn't reach Upwork.") from exc
    try:
        body = res.json() if res.content else None
    except ValueError:
        body = None
    return res.status_code, body if isinstance(body, dict) else None


async def _graphql_request(access_token: str, body: dict) -> tuple[int, dict | None]:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
            res = await client.post(GRAPHQL_URL, json=body, headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            })
    except httpx.HTTPError as exc:
        log.warning("Upwork GraphQL unreachable: %s", type(exc).__name__)
        raise UpworkCallError("Couldn't reach the Upwork API.") from exc
    try:
        payload = res.json() if res.content else None
    except ValueError:
        payload = None
    return res.status_code, payload if isinstance(payload, dict) else None


# --------------------------------------------------------------------------- #
# Tokens
# --------------------------------------------------------------------------- #
async def _tokens(form: dict) -> dict:
    settings = get_settings()
    status, body = await _token_request({
        **form, "client_id": settings.upwork_client_id, "client_secret": settings.upwork_client_secret,
    })
    if status >= 500 or status == 429:
        raise UpworkCallError(f"Upwork's token endpoint returned {status}.")
    if status >= 400 or not body or not body.get("access_token"):
        # The body may echo request details; log only the OAuth error code.
        log.warning("Upwork token request rejected: status=%s error=%s", status, (body or {}).get("error"))
        raise UpworkAuthError("Upwork rejected the authorization.")
    return body


async def exchange_code(code: str) -> dict:
    return await _tokens({"grant_type": "authorization_code", "code": code,
                          "redirect_uri": get_settings().upwork_redirect_uri})


async def _refresh(refresh_token: str) -> dict:
    return await _tokens({"grant_type": "refresh_token", "refresh_token": refresh_token})


def token_fields(tokens: dict, *, keep_refresh: str | None = None) -> dict:
    """Encrypted token fields to store. Upwork may or may not rotate the
    refresh token; keep the current one when the response has none."""
    try:
        ttl = timedelta(seconds=max(60, int(float(tokens.get("expires_in")))))
    except (TypeError, ValueError):
        ttl = DEFAULT_TOKEN_TTL
    refresh = tokens.get("refresh_token")
    return {
        "access_token": crypto.encrypt(tokens["access_token"]),
        "refresh_token": crypto.encrypt(refresh) if refresh else keep_refresh,
        "expires_at": store.now() + ttl,
        "status": "active",
        "last_refreshed_at": store.now(),
    }


def _fresh(conn: dict) -> bool:
    expires = conn.get("expires_at")
    return bool(expires and expires - REFRESH_MARGIN > store.now())


async def mark_needs_reauth(connection_id: str) -> None:
    await store.update_connection(connection_id, {"status": "needs_reauth"})


async def access_token(conn: dict, *, force_refresh: bool = False) -> str:
    """A valid access token for this connection, refreshing it if needed."""
    if conn.get("status") != "active":
        raise UpworkAuthError("This Upwork connection needs to be reconnected.")
    try:
        if not force_refresh and _fresh(conn):
            return crypto.decrypt(conn["access_token"])
        if not conn.get("refresh_token"):
            await mark_needs_reauth(conn["id"])
            raise UpworkAuthError("Upwork didn't issue a refresh token; reconnect the account.")
        refresh_token = crypto.decrypt(conn["refresh_token"])
    except crypto.DecryptError as exc:
        # Usually a TOKEN_ENCRYPTION_KEY rotated out too early.
        await mark_needs_reauth(conn["id"])
        raise UpworkAuthError("The stored Upwork credentials can't be read; reconnect the account.") from exc
    try:
        tokens = await _refresh(refresh_token)
    except UpworkAuthError:
        # Another request may have refreshed (and rotated) the token first.
        latest = await store.get_connection(conn["id"])
        if latest and latest["version"] != conn["version"] and latest.get("status") == "active" and _fresh(latest):
            return crypto.decrypt(latest["access_token"])
        await mark_needs_reauth(conn["id"])
        raise
    fields = token_fields(tokens, keep_refresh=conn.get("refresh_token"))
    if await store.update_connection(conn["id"], fields, expect_version=conn["version"]) is None:
        # A concurrent refresh stored its tokens first. Ours is still valid to use.
        log.info("Upwork token refreshed concurrently for connection %s", conn["id"])
    return tokens["access_token"]


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
async def identify(token: str) -> dict:
    """The Upwork user behind an access token: {id, nid, name}."""
    status, payload = await _graphql_request(token, {"query": IDENTIFY_QUERY, "variables": {}})
    if status in (401, 403):
        raise UpworkAuthError("Upwork rejected the new token.")
    if status >= 400 or not payload:
        raise UpworkCallError(f"Upwork API returned {status}.")
    user = ((payload.get("data") or {}).get("user")) or {}
    if not user.get("id"):
        raise UpworkCallError("Upwork didn't return the account's user id.")
    return {"id": str(user["id"]), "nid": str(user.get("nid") or ""), "name": str(user.get("name") or "")}


async def graphql(connection_id: str, user_id: str | None, query: str,
                  variables: dict | None = None) -> tuple[int, dict | None]:
    """Run a GraphQL request as this connection. Returns (status, payload);
    callers decide what non-auth errors mean. Raises UpworkAuthError when the
    account must be reconnected and UpworkCallError when Upwork is unreachable."""
    conn = await store.get_connection(connection_id, user_id)
    if not conn:
        raise UpworkAuthError("This Upwork connection no longer exists.")
    body = {"query": query, "variables": variables or {}}
    status, payload = await _graphql_request(await access_token(conn), body)
    if status != 401:
        return status, payload
    # Revoked early or expired out of band: refresh once and retry.
    conn = await store.get_connection(connection_id, user_id) or conn
    status, payload = await _graphql_request(await access_token(conn, force_refresh=True), body)
    if status == 401:
        await mark_needs_reauth(connection_id)
        raise UpworkAuthError("Upwork rejected the account's access.")
    return status, payload
