"""Unified orders — detection, verification and tracking across marketplaces.

GET    /api/orders                         filtered list + summary counts
GET    /api/orders/capabilities            per-platform detection/verification support
GET    /api/orders/events                  audit trail (detections, checks, sync failures)
GET    /api/orders/accounts                connected marketplace accounts
POST   /api/orders/accounts                connect an account (API via Upwork OAuth / owner token, or email-only)
PATCH  /api/orders/accounts/{id}           rename
DELETE /api/orders/accounts/{id}           disconnect (orders are kept)
POST   /api/orders/accounts/{id}/sync      poll the platform now
POST   /api/orders/accounts/{id}/inbound   create or rotate the account's forwarding address
GET    /api/orders/{id}                    one order + its audit trail
POST   /api/orders/{id}/verify             re-check with the platform now
POST   /api/orders/{id}/dismiss            mark an unverified order as not genuine
PATCH  /api/orders/{id}/account            link an unassigned order to an account
POST   /api/orders/webhooks/nango          Nango-forwarded provider webhooks (signed)
"""
import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from .. import repo
from ..auth import current_user, is_owner
from ..config import get_settings
from ..integrations import _nango_integrations_allowed, verify_nango_connection
from ..orders import service, store
from ..orders.adapters import UNSUPPORTED_PLATFORMS, all_adapters, get_adapter
from ..orders.adapters.base import AdapterError
from ..orders.models import OrderStatus, Verification
from ..upwork import client as upwork_client
from ..upwork import store as upwork_store

log = logging.getLogger("autopilot.orders.api")
router = APIRouter(tags=["orders"])

MAX_ACCOUNTS = 25


def _iso(value) -> str | None:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return value


def _inbound_address(account: dict) -> str | None:
    domain = get_settings().inbound_email_domain
    token = account.get("inbound_token")
    return f"o-{token}@{domain}" if domain and token and account.get("status") != "disabled" else None


def account_out(account: dict) -> dict:
    connection = account.get("connection") or {}
    return {
        "id": account["id"],
        "platform": account["platform"],
        "label": account.get("label") or account["platform"],
        "handle": account.get("handle") or "",
        "externalAccountId": account.get("external_account_id"),
        "connection": connection.get("kind", "email"),
        "status": account.get("status", "active"),
        "inboundAddress": _inbound_address(account),
        "lastSyncAt": _iso(account.get("last_sync_at")),
        "lastSyncStatus": account.get("last_sync_status"),
        "lastSyncError": account.get("last_sync_error"),
        "consecutiveFailures": account.get("consecutive_failures", 0),
        "nextSyncAt": _iso(account.get("next_sync_at")),
        "createdAt": _iso(account.get("created_at")),
    }


def order_out(order: dict, accounts: dict[str, dict]) -> dict:
    account = accounts.get(order.get("account_id") or "")
    label = (account or {}).get("label")
    if account and account.get("status") == "disabled":
        label = f"{label} (disconnected)"
    return {
        "id": order["id"],
        "platform": order["platform"],
        "accountId": order.get("account_id"),
        "accountLabel": label or ("Unassigned" if not order.get("account_id") else "Removed account"),
        "externalOrderId": order.get("external_order_id"),
        "kind": order.get("kind"),
        "title": order.get("title"),
        "clientName": order.get("client_name"),
        "clientId": order.get("client_id"),
        "amount": order.get("amount"),
        "currency": order.get("currency"),
        "pricing": order.get("pricing"),
        "status": order.get("status"),
        "statusSource": order.get("status_source"),
        "url": order.get("url"),
        "milestones": order.get("milestones") or [],
        "orderCreatedAt": _iso(order.get("order_created_at")),
        "detectedAt": _iso(order.get("detected_at")),
        "arrivedAt": _iso(order.get("arrived_at")),
        "updatedAt": _iso(order.get("updated_at")),
        "lastSyncedAt": _iso(order.get("last_synced_at")),
        "detectedVia": order.get("detected_via") or [],
        "dataExpired": bool(order.get("data_expired")),
        "verification": {
            "status": order.get("verification_status"),
            "reason": order.get("verification_reason"),
            "attempts": order.get("verification_attempts", 0),
            "lastAttemptAt": _iso(order.get("last_verification_at")),
            "nextAttemptAt": _iso(order.get("next_verify_at")),
            "verifiedAt": _iso(order.get("verified_at")),
            "evidence": order.get("verification_evidence"),
            "dismissed": bool(order.get("dismissed")),
        },
    }


def event_out(event: dict) -> dict:
    return {
        "id": event["id"], "type": event.get("type"), "message": event.get("message"),
        "status": event.get("status", "info"), "orderId": event.get("order_id"),
        "accountId": event.get("account_id"), "platform": event.get("platform"),
        "data": event.get("data") or {}, "time": _iso(event.get("created_at")),
    }


async def _accounts_by_id(user_id: str) -> dict[str, dict]:
    return {a["id"]: a for a in await store.list_accounts(user_id)}


def _parse_day(value: str | None, *, end: bool = False) -> datetime | None:
    if not value:
        return None
    try:
        day = datetime.strptime(value[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(422, "Dates must be YYYY-MM-DD.")
    return day + timedelta(days=1) if end else day


# --------------------------------------------------------------------------- #
# Orders
# --------------------------------------------------------------------------- #
@router.get("/orders")
async def list_orders(
    platform: str | None = None,
    account: str | None = None,
    status: str | None = None,
    verification: str | None = None,
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=300, ge=1, le=1000),
    user: dict = Depends(current_user),
):
    if status and status not in {s.value for s in OrderStatus}:
        raise HTTPException(422, "Unknown order status.")
    if verification and verification not in {v.value for v in Verification}:
        raise HTTPException(422, "Unknown verification status.")
    filters = {
        "platform": platform, "account_id": account, "status": status, "verification_status": verification,
        "date_from": _parse_day(date_from), "date_to": _parse_day(date_to, end=True), "q": (q or "").strip() or None,
    }
    accounts = await _accounts_by_id(user["id"])
    rows = await store.list_orders(user["id"], filters, limit=limit)
    by_verification = {v.value: 0 for v in Verification}
    verified_value: dict[str, float] = {}
    for row in rows:
        by_verification[row.get("verification_status") or "pending"] = \
            by_verification.get(row.get("verification_status") or "pending", 0) + 1
        if row.get("verification_status") == Verification.VERIFIED.value and row.get("amount") is not None:
            currency = row.get("currency") or "USD"
            verified_value[currency] = round(verified_value.get(currency, 0) + float(row["amount"]), 2)
    return {
        "orders": [order_out(o, accounts) for o in rows],
        "summary": {"total": len(rows), "byVerification": by_verification, "verifiedValue": verified_value},
    }


async def verify_upwork_connection(user_id: str, connection_id: str) -> dict:
    """The browser reports the connection id after the OAuth redirect, so it
    is untrusted until it's confirmed to be this user's live connection."""
    conn = await upwork_store.get_connection(connection_id, user_id)
    if not conn:
        raise HTTPException(404, "That Upwork connection wasn't found. Connect the account again.")
    if conn.get("status") != "active":
        raise HTTPException(409, "That Upwork connection needs to be reconnected first.")
    return conn


def _api_connect_ready(adapter, settings, allowed: set[str], user: dict) -> bool:
    if not adapter.api_enabled(settings):
        return False
    if adapter.connection_kind == "upwork_oauth":
        return upwork_client.connect_enabled(settings)
    if adapter.connection_kind == "nango":
        return bool(settings.nango_secret_key and adapter.integration_id in allowed)
    # The platform token belongs to the owner's own marketplace account.
    return adapter.connection_kind == "platform_token" and is_owner(user)


@router.get("/orders/capabilities")
async def capabilities(user: dict = Depends(current_user)):
    settings = get_settings()
    allowed = _nango_integrations_allowed(settings)
    inbound_ready = bool(settings.inbound_email_domain and settings.inbound_email_webhook_secret)
    email_platforms = {p.strip().lower() for p in settings.inbound_email_platforms.split(",") if p.strip()}
    rows = []
    for adapter in all_adapters():
        cap = adapter.capability(settings).as_dict()
        cap["canConnectApi"] = _api_connect_ready(adapter, settings, allowed, user)
        cap["integrationId"] = adapter.integration_id
        cap["emailReady"] = inbound_ready and adapter.platform.lower() in email_platforms
        rows.append(cap)
    return {
        "platforms": rows,
        "unsupported": UNSUPPORTED_PLATFORMS,
        "scheduler": bool(settings.redis_url),
        "inboundEmail": inbound_ready,
    }


@router.get("/orders/events")
async def list_events(
    account: str | None = None,
    type: str | None = Query(default=None, max_length=40),
    limit: int = Query(default=200, ge=1, le=500),
    user: dict = Depends(current_user),
):
    rows = await store.list_events(user["id"], account_id=account, event_type=type, limit=limit)
    return [event_out(e) for e in rows]


# --------------------------------------------------------------------------- #
# Connected accounts
# --------------------------------------------------------------------------- #
class AccountCreateBody(BaseModel):
    platform: str = Field(min_length=1, max_length=60)
    label: str = Field(default="", max_length=80)
    # "api" connects through the platform's API; "email" adds an email-only
    # account. OAuth accounts (Upwork, Nango) also pass the connectionId the
    # connect flow returned.
    mode: Literal["api", "email"] = "email"
    connection_id: str | None = Field(default=None, alias="connectionId", max_length=200)


class AccountUpdateBody(BaseModel):
    label: str = Field(min_length=1, max_length=80)


def _new_inbound_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(24)
    return token, hashlib.sha256(token.encode()).hexdigest()


@router.get("/orders/accounts")
async def list_accounts(user: dict = Depends(current_user)):
    return [account_out(a) for a in await store.list_accounts(user["id"]) if a.get("status") != "disabled"]


@router.post("/orders/accounts")
async def create_account(body: AccountCreateBody, background: BackgroundTasks, user: dict = Depends(current_user)):
    adapter = get_adapter(body.platform)
    if adapter is None:
        raise HTTPException(422, "Order tracking is not available for this platform.")
    existing = [a for a in await store.list_accounts(user["id"]) if a.get("status") != "disabled"]
    if len(existing) >= MAX_ACCOUNTS:
        raise HTTPException(409, f"You can connect up to {MAX_ACCOUNTS} accounts.")
    settings = get_settings()
    fields: dict = {
        "platform": adapter.platform, "label": body.label.strip() or adapter.platform, "status": "active",
        "consecutive_failures": 0, "last_sync_at": None, "next_sync_at": None,
    }
    use_api = body.mode == "api" or bool(body.connection_id)
    if use_api:
        if not adapter.has_api:
            raise HTTPException(422, f"{adapter.platform} has no API connection; add it as an email-only account.")
        if not _api_connect_ready(adapter, settings, _nango_integrations_allowed(settings), user):
            if adapter.connection_kind == "platform_token" and adapter.api_enabled(settings):
                raise HTTPException(403, f"Only the platform owner can connect the configured {adapter.platform} account.")
            raise HTTPException(503, f"{adapter.platform} API access is not enabled in this environment.")
        if adapter.connection_kind == "upwork_oauth":
            if not body.connection_id:
                raise HTTPException(422, "Connect the Upwork account first; the connection id is missing.")
            if any((a.get("connection") or {}).get("connectionId") == body.connection_id for a in existing):
                raise HTTPException(409, "This connection is already added.")
            await verify_upwork_connection(user["id"], body.connection_id)
            connection = {"kind": "upwork_oauth", "connectionId": body.connection_id}
        elif adapter.connection_kind == "nango":
            if not body.connection_id:
                raise HTTPException(422, "Connect the account first; the connection id is missing.")
            if any((a.get("connection") or {}).get("connectionId") == body.connection_id for a in existing):
                raise HTTPException(409, "This connection is already added.")
            await verify_nango_connection(user["id"], adapter.integration_id, body.connection_id)
            connection = {"kind": "nango", "integrationId": adapter.integration_id,
                          "connectionId": body.connection_id}
        else:
            connection = {"kind": adapter.connection_kind}
        try:
            identity = await adapter.identify({"connection": connection, "platform": adapter.platform,
                                               "user_id": user["id"]})
        except AdapterError as exc:
            raise HTTPException(502, f"Could not read the {adapter.platform} account: {exc}")
        if any(a["platform"] == adapter.platform and a.get("external_account_id") == identity.external_account_id
               for a in existing):
            raise HTTPException(409, f"This {adapter.platform} account is already connected.")
        fields.update(connection=connection, external_account_id=identity.external_account_id,
                      handle=identity.handle, next_sync_at=store.now())
        if not body.label.strip() and identity.handle:
            fields["label"] = f"{adapter.platform} · {identity.handle}"
    else:
        if not adapter.email_rules:
            raise HTTPException(422, f"{adapter.platform} order emails are not supported; connect it through its API.")
        fields.update(connection={"kind": "email"}, external_account_id=None, handle="")
    if settings.inbound_email_domain and settings.inbound_email_webhook_secret:
        token, token_hash = _new_inbound_token()
        fields.update(inbound_token=token, inbound_token_hash=token_hash)
    if use_api:
        fields["label"] += adapter.environment_label(settings)
    account = await store.add_account(user["id"], fields)
    await service._event(user["id"], "account_connected",
                         f"Connected {account['label']} ({'API' if use_api else 'email only'})",
                         account_id=account["id"], status="success")
    await repo.log_activity(user["id"], "Order Sync", f"Connected {adapter.platform} account {account['label']}")
    if use_api:
        background.add_task(_safe_sync, user["id"], account["id"])
    return account_out(account)


async def _safe_sync(user_id: str, account_id: str) -> None:
    try:
        await service.sync_account(user_id, account_id)
    except Exception:
        log.exception("background order sync failed for account %s", account_id)


async def _safe_verify(user_id: str, order_id: str) -> None:
    try:
        await service.verify(user_id, order_id)
    except Exception:
        log.exception("background order verification failed for order %s", order_id)


async def _own_account(user_id: str, account_id: str) -> dict:
    account = await store.get_account(user_id, account_id)
    if account is None or account.get("status") == "disabled":
        raise HTTPException(404, "Account not found")
    return account


@router.patch("/orders/accounts/{account_id}")
async def update_account(account_id: str, body: AccountUpdateBody, user: dict = Depends(current_user)):
    await _own_account(user["id"], account_id)
    updated = await store.update_account(user["id"], account_id, {"label": body.label.strip()})
    return account_out(updated)


@router.delete("/orders/accounts/{account_id}")
async def delete_account(account_id: str, user: dict = Depends(current_user)):
    account = await _own_account(user["id"], account_id)
    # Soft delete: orders keep their history. The forwarding address stops
    # working and the scheduler stops polling.
    await store.update_account(user["id"], account_id, {
        "status": "disabled", "inbound_token": None, "inbound_token_hash": None, "next_sync_at": None,
    })
    await service._event(user["id"], "account_disconnected", f"Disconnected {account.get('label')}",
                         account_id=account_id, status="warning")
    await repo.log_activity(user["id"], "Order Sync", f"Disconnected {account['platform']} account {account.get('label')}")
    return {"ok": True}


@router.post("/orders/accounts/{account_id}/sync")
async def sync_account(account_id: str, user: dict = Depends(current_user)):
    await _own_account(user["id"], account_id)
    result = await service.sync_account(user["id"], account_id)
    account = await store.get_account(user["id"], account_id)
    return {**result, "account": account_out(account)}


@router.post("/orders/accounts/{account_id}/inbound")
async def rotate_inbound(account_id: str, user: dict = Depends(current_user)):
    await _own_account(user["id"], account_id)
    settings = get_settings()
    if not settings.inbound_email_domain or not settings.inbound_email_webhook_secret:
        raise HTTPException(503, "Inbound email is not configured on the server.")
    token, token_hash = _new_inbound_token()
    updated = await store.update_account(user["id"], account_id,
                                         {"inbound_token": token, "inbound_token_hash": token_hash})
    await service._event(user["id"], "inbound_address_rotated", "Forwarding address changed",
                         account_id=account_id)
    return account_out(updated)


# --------------------------------------------------------------------------- #
# One order
# --------------------------------------------------------------------------- #
async def _own_order(user_id: str, order_id: str) -> dict:
    order = await store.get_order(user_id, order_id)
    if order is None:
        raise HTTPException(404, "Order not found")
    return order


@router.get("/orders/{order_id}")
async def get_order(order_id: str, user: dict = Depends(current_user)):
    order = await _own_order(user["id"], order_id)
    accounts = await _accounts_by_id(user["id"])
    events = await store.list_events(user["id"], order_id=order_id, limit=200)
    return {**order_out(order, accounts), "events": [event_out(e) for e in events]}


@router.post("/orders/{order_id}/verify")
async def verify_order(order_id: str, user: dict = Depends(current_user)):
    await _own_order(user["id"], order_id)
    try:
        order = await service.verify(user["id"], order_id)
    except service.OrderConflict:
        raise HTTPException(409, "The order is being updated; try again in a moment.")
    if order is None:
        # A title-matched email record is folded into the platform order.
        raise HTTPException(404, "Order not found")
    return order_out(order, await _accounts_by_id(user["id"]))


@router.post("/orders/{order_id}/dismiss")
async def dismiss_order(order_id: str, user: dict = Depends(current_user)):
    await _own_order(user["id"], order_id)
    order = await service.dismiss(user["id"], order_id)
    if order is None:
        raise HTTPException(409, "Verified orders are confirmed by the platform and can't be dismissed.")
    return order_out(order, await _accounts_by_id(user["id"]))


class AssignBody(BaseModel):
    account_id: str = Field(alias="accountId", min_length=1, max_length=64)


@router.patch("/orders/{order_id}/account")
async def assign_order(order_id: str, body: AssignBody, background: BackgroundTasks,
                       user: dict = Depends(current_user)):
    await _own_order(user["id"], order_id)
    account = await _own_account(user["id"], body.account_id)
    try:
        order = await service.assign_account(user["id"], order_id, account)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    if order is None:
        raise HTTPException(409, "Verified orders stay with the account the platform confirmed.")
    if service.needs_verification(order):
        background.add_task(_safe_verify, user["id"], order_id)
    return order_out(order, await _accounts_by_id(user["id"]))


# --------------------------------------------------------------------------- #
# Provider webhooks (forwarded by Nango)
# --------------------------------------------------------------------------- #
_MAX_WEBHOOK_BYTES = 256 * 1024


@router.post("/orders/webhooks/nango")
async def nango_webhook(request: Request, background: BackgroundTasks):
    """Provider webhooks that Nango forwards for a connection.

    Authenticated by Nango's X-Nango-Hmac-Sha256 header (hex HMAC-SHA256 of
    the raw body with the environment's webhook signing key). Payloads are
    hints only: each order id is fetched from the platform API with the
    account's own credentials before anything is stored. Work runs after the
    response, because Nango gives up on deliveries after 20 seconds.
    """
    key = get_settings().nango_webhook_signing_key
    if not key:
        raise HTTPException(503, "Webhook signing key is not configured.")
    raw = await request.body()
    if len(raw) > _MAX_WEBHOOK_BYTES:
        raise HTTPException(413, "Webhook payload too large.")
    expected = hmac.new(key.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(request.headers.get("x-nango-hmac-sha256", ""), expected):
        raise HTTPException(401, "Invalid webhook signature.")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(422, "Webhook body is not JSON.")
    if not isinstance(payload, dict) or payload.get("type") != "forward":
        # Auth and sync notifications from Nango itself carry no orders.
        return {"accepted": True, "matched": 0}
    provider_key = str(payload.get("providerConfigKey") or "")
    connection_id = str(payload.get("connectionId") or "")
    if not provider_key or not connection_id:
        return {"accepted": True, "matched": 0}
    accounts = await store.accounts_for_connection(provider_key, connection_id)
    inner = payload.get("payload") if isinstance(payload.get("payload"), dict) else {}
    hinted = 0
    for account in accounts:
        adapter = get_adapter(account["platform"])
        ids = [str(i) for i in (adapter.webhook_order_ids(inner) if adapter else []) if i]
        if ids:
            hinted += len(ids)
            background.add_task(_safe_hint, account["user_id"], account, ids)
    return {"accepted": True, "matched": len(accounts), "hinted": hinted}


async def _safe_hint(user_id: str, account: dict, ids: list[str]) -> None:
    try:
        await service.handle_webhook_hint(user_id, account, ids)
    except Exception:
        log.exception("webhook hint handling failed for account %s", account["id"])
