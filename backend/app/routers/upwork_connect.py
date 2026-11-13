"""Connect Upwork accounts directly over OAuth 2.0 (no Nango).

Signed in (any role):
  GET    /api/upwork/connections         the caller's connections + whether connecting is on
  POST   /api/upwork/oauth/start         {returnTo} -> {authorizeUrl}
  DELETE /api/upwork/connections/{id}    disconnect and delete the stored tokens

Public (Upwork redirects the browser here; the single-use state names the user):
  GET    /api/upwork/oauth/callback      ?code&state -> 303 to the app

The callback stores the tokens encrypted and sends the browser back to
`returnTo` with ?upwork=connected&connectionId=… (or ?upwork=error&reason=…).
The orders page then adds the connection as an order account; job search
uses the newest active connection. See docs/upwork-oauth.md.
"""
import hashlib
import logging
import secrets
from datetime import timedelta
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from .. import repo
from ..auth import current_user
from ..config import get_settings
from ..orders import store as order_store
from ..upwork import client, store

log = logging.getLogger("autopilot.upwork")

router = APIRouter(tags=["upwork"])
public_router = APIRouter(tags=["upwork"])

STATE_TTL = timedelta(minutes=10)
MAX_CONNECTIONS = 25
# Where the callback may send the browser back to. Never a URL from the request.
RETURN_PATHS = ("/dashboard/orders", "/dashboard/accounts")
DEFAULT_RETURN = "/dashboard/accounts"
KIND = "upwork_oauth"


def _hash(state: str) -> str:
    return hashlib.sha256(state.encode()).hexdigest()


def _iso(value) -> str | None:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ") if value else None


def connection_out(conn: dict) -> dict:
    # Never the tokens, encrypted or not.
    return {
        "id": conn["id"], "handle": conn.get("handle") or "", "name": conn.get("name") or "",
        "status": conn.get("status", "active"), "connectedAt": _iso(conn.get("created_at")),
        "lastRefreshedAt": _iso(conn.get("last_refreshed_at")),
    }


async def newest_active_connection(user_id: str) -> dict | None:
    return next((c for c in await store.list_connections(user_id) if c.get("status") == "active"), None)


@router.get("/upwork/connections")
async def list_connections(user: dict = Depends(current_user)):
    settings = get_settings()
    return {
        "canConnect": client.connect_enabled(settings),
        "reason": client.connect_blocker(settings),
        "connections": [connection_out(c) for c in await store.list_connections(user["id"])],
    }


class StartBody(BaseModel):
    returnTo: str = Field(default=DEFAULT_RETURN, max_length=100)


@router.post("/upwork/oauth/start")
async def start(body: StartBody, user: dict = Depends(current_user)):
    settings = get_settings()
    blocker = client.connect_blocker(settings)
    if blocker:
        raise HTTPException(503, blocker)
    if body.returnTo not in RETURN_PATHS:
        raise HTTPException(422, "Unsupported return page.")
    state = secrets.token_urlsafe(32)
    await store.save_state(_hash(state), {
        "user_id": user["id"], "return_to": body.returnTo, "expires_at": store.now() + STATE_TTL,
    })
    return {"authorizeUrl": client.authorize_url(settings, state)}


def _back(path: str, *, connection_id: str | None = None, reason: str | None = None) -> RedirectResponse:
    """Send the browser back to the app. Only a short reason code travels in
    the URL, never Upwork's error text."""
    target = path if path in RETURN_PATHS else DEFAULT_RETURN
    params = {"upwork": "error", "reason": reason} if reason else {"upwork": "connected", "connectionId": connection_id}
    return RedirectResponse(f"{get_settings().site_url}{target}?{urlencode(params)}", status_code=303)


@public_router.get("/upwork/oauth/callback")
async def callback(state: str = "", code: str = "", error: str = ""):
    pending = await store.take_state(_hash(state)) if 20 <= len(state) <= 200 else None
    if not pending or pending["expires_at"] <= store.now():
        return _back(DEFAULT_RETURN, reason="expired")
    return_to, user_id = pending["return_to"], pending["user_id"]
    if error:
        return _back(return_to, reason="denied" if error == "access_denied" else "upwork_error")
    if not code or len(code) > 2000:
        return _back(return_to, reason="upwork_error")
    if not client.connect_enabled(get_settings()):
        return _back(return_to, reason="not_enabled")
    try:
        tokens = await client.exchange_code(code)
        identity = await client.identify(tokens["access_token"])
    except client.UpworkAuthError:
        return _back(return_to, reason="rejected")
    except client.UpworkCallError:
        return _back(return_to, reason="unreachable")

    existing = await store.list_connections(user_id)
    if len(existing) >= MAX_CONNECTIONS and not any(c["upwork_user_id"] == identity["id"] for c in existing):
        return _back(return_to, reason="too_many")
    conn, created = await store.upsert_connection(user_id, identity["id"], {
        **client.token_fields(tokens), "handle": identity["nid"] or identity["name"], "name": identity["name"],
    })
    if not created:
        # A reconnect: order accounts on this connection can sync again.
        for account in await order_store.accounts_using_connection(user_id, KIND, conn["id"]):
            if account.get("status") == "needs_reauth":
                await order_store.update_account(user_id, account["id"], {
                    "status": "active", "next_sync_at": order_store.now(), "consecutive_failures": 0,
                    "last_sync_error": None,
                })
    label = conn.get("handle") or "an account"
    await repo.log_activity(user_id, "Integrations", f"{'Connected' if created else 'Reconnected'} Upwork account {label}")
    return _back(return_to, connection_id=conn["id"])


@router.delete("/upwork/connections/{connection_id}")
async def disconnect(connection_id: str, user: dict = Depends(current_user)):
    conn = await store.get_connection(connection_id[:64], user["id"])
    if not conn:
        raise HTTPException(404, "Upwork connection not found.")
    accounts = await order_store.accounts_using_connection(user["id"], KIND, conn["id"])
    for account in accounts:
        if account.get("status") != "disabled":
            await order_store.update_account(user["id"], account["id"], {
                "status": "needs_reauth", "next_sync_at": None,
                "last_sync_error": "The Upwork connection was removed. Connect the account again to resume syncing.",
            })
    await store.delete_connection(user["id"], conn["id"])
    await repo.log_activity(user["id"], "Integrations", f"Disconnected Upwork account {conn.get('handle') or ''}".strip())
    return {"ok": True, "accountsAffected": len([a for a in accounts if a.get("status") != "disabled"])}
