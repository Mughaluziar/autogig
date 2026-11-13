"""Order ingestion, verification and synchronisation — platform-agnostic.

Every detection path (API poll, webhook, notification email) produces an
`OrderSignal` and calls `ingest`. The rules that keep the dashboard honest
live here, once, for all platforms:

  * One stored order per (user, platform, platform order id). Replayed and
    repeated signals merge into it, never duplicate it.
  * Only an authoritative signal — fetched from the platform's API with the
    connected account's own credentials — can set `verified`. Email and
    webhook signals are hints that queue a verification fetch.
  * Once verified, an order's fields come only from the platform API; a
    later email can't overwrite them, only prompt a re-check.
  * Every detection, verification attempt, status change and sync failure
    is written to the order_events audit trail.
"""
import asyncio
import hashlib
import logging
import re
from dataclasses import dataclass, replace
from datetime import datetime, timedelta

from .. import repo
from ..config import get_settings
from . import store
from .adapters import get_adapter
from .adapters.base import AccessRevoked, AdapterError, OrderAdapter
from .models import Kind, OrderSignal, OrderStatus, Source, Verification

log = logging.getLogger("autopilot.orders")

SYNC_INTERVAL = timedelta(minutes=15)
MAX_SYNC_BACKOFF = timedelta(hours=6)
MAX_VERIFY_ATTEMPTS = 5
# An email that names no order id is matched to the account's orders by
# title. If nothing matches within this window, it is rejected.
UNMATCHED_SIGNAL_WINDOW = timedelta(hours=72)
_SIGNAL_REF_CAP = 20
_MAX_WRITE_RETRIES = 4
OFFER = OrderStatus.OFFER.value

# Fields that come from the platform and are cleared when its data-retention
# limit passes without a refresh.
API_CONNECTIONS = store.API_CONNECTION_KINDS
_PLATFORM_FIELDS = ("title", "client_name", "client_id", "amount", "currency", "pricing", "url", "milestones")


class OrderConflict(Exception):
    """Concurrent writers kept winning; the caller may retry later."""


@dataclass
class IngestResult:
    order: dict
    created: bool
    changed: bool


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _parse_dt(value: str | datetime | None) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return store._aware(value)
    try:
        return store._aware(datetime.fromisoformat(str(value).replace("Z", "+00:00")))
    except ValueError:
        return None


def dedupe_key(signal: OrderSignal) -> str:
    platform = signal.platform.lower()
    if signal.external_order_id:
        return f"{platform}:{signal.external_order_id.strip()}"
    ref = signal.signal_ref or hashlib.sha256(
        f"{signal.title}|{signal.amount}|{signal.created_at}".encode()).hexdigest()
    return f"{platform}:signal:{hashlib.sha256(ref.encode()).hexdigest()[:32]}"


def _norm_title(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def account_has_api(account: dict | None) -> bool:
    return bool(account and account.get("status") != "disabled"
                and (account.get("connection") or {}).get("kind") in API_CONNECTIONS)


async def _event(user_id: str, event_type: str, message: str, *, order: dict | None = None,
                 account_id: str | None = None, status: str = "info", data: dict | None = None) -> None:
    await store.add_event(user_id, {
        "type": event_type, "message": message[:500], "status": status,
        "order_id": order["id"] if order else None,
        "account_id": account_id or (order or {}).get("account_id"),
        "platform": (order or {}).get("platform"),
        "data": data or {},
    })


def _verification_plan(adapter: OrderAdapter, account: dict | None) -> tuple[str, str, datetime | None]:
    """Verification state for a newly detected, non-authoritative order."""
    settings = get_settings()
    if not adapter.has_api:
        return (Verification.UNVERIFIABLE.value,
                f"{adapter.platform} offers no permitted way to verify orders. Confirm it on {adapter.platform}.",
                None)
    if account is None:
        return (Verification.PENDING.value,
                "Not linked to a connected account yet. Assign it to an account to verify it.", None)
    if not account_has_api(account):
        return (Verification.PENDING.value,
                f"This {adapter.platform} account is email-only. Connect it through the {adapter.platform} API to verify orders.",
                None)
    if not adapter.api_enabled(settings):
        return (Verification.PENDING.value,
                f"{adapter.platform} API access is not approved in this environment yet.", None)
    return Verification.PENDING.value, f"Queued for verification against {adapter.platform}.", store.now()


def _platform_values(signal: OrderSignal) -> dict:
    return {
        "kind": signal.kind.value,
        "title": signal.title,
        "client_name": signal.client_name,
        "client_id": signal.client_id,
        "amount": signal.amount,
        "currency": signal.currency,
        "pricing": signal.pricing,
        "status": (signal.status or OrderStatus.UNKNOWN).value,
        "url": signal.url,
        "milestones": [m.as_dict() for m in signal.milestones],
    }


def _evidence(signal: OrderSignal, account: dict) -> dict:
    return {
        "method": "platform_api",
        "platform": signal.platform,
        "accountId": account["id"],
        "accountExternalId": account.get("external_account_id"),
        "orderExternalId": signal.external_order_id,
        "reportedAccountExternalId": signal.account_external_id,
        "checkedAt": store.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def _belongs_to_other_account(signal: OrderSignal, account: dict | None) -> bool:
    reported = signal.account_external_id
    mine = (account or {}).get("external_account_id")
    return bool(reported and mine and str(reported) != str(mine))


# --------------------------------------------------------------------------- #
# Ingestion
# --------------------------------------------------------------------------- #
def _new_order(signal: OrderSignal, account: dict | None, adapter: OrderAdapter) -> tuple[dict, list[tuple]]:
    now = store.now()
    placed = _parse_dt(signal.created_at)
    fields = {
        "dedupe_key": dedupe_key(signal),
        "platform": adapter.platform,
        "account_id": (account or {}).get("id"),
        "external_order_id": signal.external_order_id,
        **_platform_values(signal),
        "status_source": signal.source.value,
        "order_created_at": placed,
        "sort_at": placed or now,
        "detected_at": now,
        "updated_at": now,
        "detected_via": [signal.source.value],
        "signal_refs": [signal.signal_ref] if signal.signal_ref else [],
        "last_synced_at": None,
        "data_expired": False,
        "verification_attempts": 0,
        "last_verification_at": None,
        "verified_at": None,
        "verification_evidence": None,
        "next_verify_at": None,
        # What the first unverified source claimed — kept so a later API
        # check can report mismatches instead of silently replacing them.
        "claimed": {"amount": signal.amount, "currency": signal.currency, "title": signal.title}
        if not signal.authoritative else None,
    }
    events = [("order_detected", f"Detected via {signal.source.value.replace('_', ' ')}", "info", {})]
    if signal.authoritative and account is not None:
        if _belongs_to_other_account(signal, account):
            fields.update(verification_status=Verification.REJECTED.value,
                          verification_reason="The platform reports this order under a different account.")
            events.append(("verification_rejected", fields["verification_reason"], "error", {}))
        else:
            fields.update(verification_status=Verification.VERIFIED.value,
                          verification_reason=f"Confirmed by the {adapter.platform} API for this account.",
                          verified_at=now, last_verification_at=now, last_synced_at=now,
                          verification_evidence=_evidence(signal, account))
            events.append(("verified", fields["verification_reason"], "success", {}))
    else:
        status, reason, next_at = _verification_plan(adapter, account)
        fields.update(verification_status=status, verification_reason=reason, next_verify_at=next_at)
    return fields, events


def _merge(existing: dict, signal: OrderSignal, account: dict | None,
           adapter: OrderAdapter) -> tuple[dict, list[tuple]]:
    """Patch + events to fold `signal` into `existing`. An empty patch means
    the signal added nothing."""
    now = store.now()
    patch: dict = {}
    events: list[tuple] = []
    refs = existing.get("signal_refs") or []
    if signal.signal_ref and signal.signal_ref in refs:
        return {}, [("duplicate_signal", f"Ignored a repeated {signal.source.value} delivery", "info", {})]
    if signal.signal_ref:
        patch["signal_refs"] = (refs + [signal.signal_ref])[-_SIGNAL_REF_CAP:]
    via = existing.get("detected_via") or []
    if signal.source.value not in via:
        patch["detected_via"] = via + [signal.source.value]
    was_verified = existing.get("verification_status") == Verification.VERIFIED.value
    if account is not None and not existing.get("account_id"):
        patch["account_id"] = account["id"]
    elif (signal.authoritative and account is not None and existing.get("account_id") != account["id"]
          and not was_verified and not _belongs_to_other_account(signal, account)):
        # The platform confirmed it under this account; an email had guessed another.
        patch["account_id"] = account["id"]
        events.append(("account_assigned", f"Moved to {account.get('label') or account['id']}, "
                                           "where the platform confirmed it", "info", {}))
    # Evidence describes the account that owns the order, so a second account
    # that can also see it (agency contracts) doesn't overwrite it.
    owns = account is not None and (patch.get("account_id") or existing.get("account_id")) == account["id"]

    if signal.authoritative:
        if account is not None and _belongs_to_other_account(signal, account):
            if existing.get("verification_status") != Verification.REJECTED.value:
                patch.update(verification_status=Verification.REJECTED.value,
                             verification_reason="The platform reports this order under a different account.",
                             next_verify_at=None, last_verification_at=now)
                events.append(("verification_rejected", patch["verification_reason"], "error", {}))
            return patch, events
        # A field the API call didn't return (None, or no milestones) is
        # "not reported", not "cleared": offer(id:) has terms but no
        # lifecycle state, the offers list has state but no deep link.
        new_values = {k: v for k, v in _platform_values(signal).items()
                      if not (v is None or (k == "milestones" and not v) or (k == "status" and signal.status is None))}
        old_status = existing.get("status")
        for key, value in new_values.items():
            if existing.get(key) != value:
                patch[key] = value
        if existing.get("data_expired"):
            # Fields were cleared for retention; this is a refresh, not a change.
            events.append(("data_refreshed", f"{adapter.platform} data restored by a successful sync", "info", {}))
        else:
            if "status" in new_values and old_status != new_values["status"]:
                events.append(("status_changed", f"Status {old_status} → {new_values['status']}", "info",
                               {"from": old_status, "to": new_values["status"], "source": signal.source.value}))
            if was_verified and existing.get("amount") is not None and existing.get("amount") != signal.amount:
                events.append(("amount_changed", f"Amount {existing.get('amount')} → {signal.amount}", "warning",
                               {"from": existing.get("amount"), "to": signal.amount}))
            if was_verified:
                old_ms = {m.get("externalId"): m for m in existing.get("milestones") or []}
                for m in signal.milestones:
                    before = old_ms.get(m.external_id)
                    if before is None:
                        events.append(("milestone_created", f"Milestone added: {m.title or m.external_id}", "info",
                                       {"milestone": m.external_id}))
                    elif before.get("status") != m.status:
                        events.append(("milestone_status_changed",
                                       f"Milestone {m.title or m.external_id}: {before.get('status')} → {m.status}",
                                       "info", {"milestone": m.external_id}))
        placed = _parse_dt(signal.created_at)
        if placed and existing.get("order_created_at") != placed:
            patch["order_created_at"] = placed
            patch["sort_at"] = placed
        if "status" in new_values:
            patch["status_source"] = signal.source.value
        patch.update(last_synced_at=now, data_expired=False, next_verify_at=None)
        if not was_verified:
            claimed = existing.get("claimed") or {}
            for field_name in ("amount", "currency"):
                if claimed.get(field_name) is not None and claimed.get(field_name) != getattr(signal, field_name):
                    events.append(("field_mismatch",
                                   f"Notification said {field_name} {claimed.get(field_name)}; "
                                   f"{adapter.platform} reports {getattr(signal, field_name)}. Using the platform value.",
                                   "warning", {"field": field_name}))
            patch.update(verification_status=Verification.VERIFIED.value,
                         verification_reason=f"Confirmed by the {adapter.platform} API for this account.",
                         verified_at=now, next_verify_at=None, last_verification_at=now, dismissed=False)
            if owns:
                patch["verification_evidence"] = _evidence(signal, account)
            events.append(("verified", patch["verification_reason"], "success", {}))
        elif owns:
            patch["verification_evidence"] = _evidence(signal, account)
        return patch, events

    # Non-authoritative signal (email, webhook hint).
    if existing.get("verification_status") == Verification.VERIFIED.value:
        if signal.status and signal.status.value != existing.get("status"):
            # Don't take the email's word for it — re-check with the platform.
            patch["next_verify_at"] = now
            events.append(("status_hint", f"{signal.source.value.title()} reported status {signal.status.value}; "
                                          "re-checking with the platform", "info", {}))
        return patch, events

    for key, value in _platform_values(signal).items():
        if key in ("status", "milestones", "kind", "pricing"):
            continue  # pricing is only trusted from the platform API
        if value is not None and existing.get(key) in (None, ""):
            patch[key] = value
    if signal.status and signal.status.value != existing.get("status"):
        patch["status"] = signal.status.value
        patch["status_source"] = signal.source.value
        events.append(("status_changed", f"Status {existing.get('status')} → {signal.status.value} "
                                         f"(reported by {signal.source.value}, unverified)", "info",
                       {"from": existing.get("status"), "to": signal.status.value, "source": signal.source.value}))
    if "account_id" in patch and existing.get("verification_status") == Verification.PENDING.value:
        status, reason, next_at = _verification_plan(adapter, account)
        patch.update(verification_status=status, verification_reason=reason, next_verify_at=next_at)
    return patch, events


async def ingest(user_id: str, signal: OrderSignal, account: dict | None = None, *,
                 announce: bool = True) -> IngestResult:
    """Fold one signal into the user's orders. `announce=False` is for the
    first sync of a newly connected account, which backfills existing orders
    without a notification for each."""
    adapter = get_adapter(signal.platform)
    if adapter is None:
        raise ValueError(f"No order adapter for {signal.platform}")
    if signal.authoritative and account is None:
        raise ValueError("An authoritative signal must name the account it was fetched with.")
    key = dedupe_key(signal)
    for _ in range(_MAX_WRITE_RETRIES):
        existing = await store.get_order_by_key(user_id, key)
        if existing is None:
            fields, events = _new_order(signal, account, adapter)
            # When the order arrived as live work. Offers wait until they turn
            # into an order; a quiet backfill of existing orders never arrives.
            fields["arrived_at"] = store.now() if announce and fields.get("status") != OFFER else None
            order = await store.insert_order(user_id, fields)
            if order is None:
                continue  # another source inserted it first — merge instead
            for event_type, message, status, data in events:
                await _event(user_id, event_type, message, order=order, status=status,
                             data={"source": signal.source.value, **data})
            if announce:
                await _announce(user_id, order)
            return IngestResult(order, created=True, changed=True)
        patch, events = _merge(existing, signal, account, adapter)
        if not patch:
            for event_type, message, status, data in events:
                await _event(user_id, event_type, message, order=existing, status=status, data=data)
            return IngestResult(existing, created=False, changed=False)
        if (existing.get("status") == OFFER and patch.get("status") not in (None, OFFER)
                and not existing.get("arrived_at")):
            patch["arrived_at"] = store.now()
        patch["updated_at"] = store.now()
        order = await store.update_order(user_id, existing["id"], patch, expect_version=existing["version"])
        if order is None:
            continue  # concurrent update — reload and re-merge
        for event_type, message, status, data in events:
            await _event(user_id, event_type, message, order=order, status=status,
                         data={"source": signal.source.value, **data})
        if announce and any(e[0] == "verified" for e in events):
            await repo.log_activity(user_id, "Order Sync",
                                    f"Verified {order['platform']} order {order.get('external_order_id') or ''}".strip())
        meaningful = any(e[0] not in ("duplicate_signal",) for e in events)
        return IngestResult(order, created=False, changed=meaningful)
    raise OrderConflict(f"Could not store order {key} after repeated concurrent updates")


async def _announce(user_id: str, order: dict) -> None:
    verified = order.get("verification_status") == Verification.VERIFIED.value
    label = order.get("title") or order.get("external_order_id") or "New order"
    money = f" · {order['currency'] or ''} {order['amount']:,.2f}".rstrip() if order.get("amount") is not None else ""
    if verified:
        await repo.notify(user_id, f"New {order['platform']} order", f"{label}{money}", "success")
    else:
        await repo.notify(user_id, f"{order['platform']} order detected (not yet verified)",
                          f"{label}{money} — {order.get('verification_reason', '')}", "info")
    await repo.log_activity(user_id, "Order Sync",
                            f"Detected {order['platform']} order {order.get('external_order_id') or label} "
                            f"({order['verification_status']})")
    from ..integrations import emit_activepieces_event
    await emit_activepieces_event("order.detected", {
        "user_id": user_id, "order_id": order["id"], "platform": order["platform"],
        "verification": order["verification_status"],
    })


# --------------------------------------------------------------------------- #
# Verification
# --------------------------------------------------------------------------- #
async def _update_with_retry(user_id: str, order_id: str, fields: dict) -> dict | None:
    for _ in range(_MAX_WRITE_RETRIES):
        current = await store.get_order(user_id, order_id)
        if current is None:
            return None
        updated = await store.update_order(user_id, order_id, {**fields, "updated_at": store.now()},
                                           expect_version=current["version"])
        if updated is not None:
            return updated
    raise OrderConflict(f"Could not update verification for order {order_id}")


def _backoff(attempts: int) -> timedelta:
    return min(timedelta(minutes=2 ** attempts), timedelta(hours=6))


async def _absorb_unmatched(user_id: str, order: dict, remote: OrderSignal, account: dict,
                            adapter: OrderAdapter) -> dict:
    """An email that named no order id matched exactly one platform order by
    title: store the platform order (verified) and fold the email record in."""
    result = await ingest(user_id, replace(remote, authoritative=True), account)
    if result.order["id"] != order["id"]:
        await _event(user_id, "merged", f"Notification matched to {adapter.platform} order "
                                        f"{result.order.get('external_order_id')} by title", order=result.order,
                     data={"mergedOrderId": order["id"]})
        await store.delete_order(user_id, order["id"])
    return result.order


def needs_verification(order: dict | None) -> bool:
    return bool(order and order.get("verification_status") == Verification.PENDING.value
                and order.get("next_verify_at") is not None)


async def verify(user_id: str, order_id: str) -> dict | None:
    """Check one order against its platform. Safe to call repeatedly."""
    order = await store.get_order(user_id, order_id)
    if order is None:
        return None
    if order.get("verification_status") == Verification.REJECTED.value and order.get("dismissed"):
        return order
    adapter = get_adapter(order["platform"])
    account = await store.get_account(user_id, order["account_id"]) if order.get("account_id") else None
    now = store.now()
    if adapter is None:
        return order
    # A platform confirmation stays valid: a later check that can't run or
    # errors never downgrades a verified order, it only logs the attempt.
    was_verified = order.get("verification_status") == Verification.VERIFIED.value
    if not adapter.has_api or account is None or not account_has_api(account) \
            or not adapter.api_enabled(get_settings()):
        if was_verified:
            if order.get("next_verify_at") is not None:
                order = await _update_with_retry(user_id, order_id, {"next_verify_at": None})
            return order
        status, reason, _ = _verification_plan(adapter, account)
        if (status, reason) != (order.get("verification_status"), order.get("verification_reason")) \
                or order.get("next_verify_at") is not None:
            order = await _update_with_retry(user_id, order_id, {
                "verification_status": status, "verification_reason": reason, "next_verify_at": None,
            })
        return order

    attempts = int(order.get("verification_attempts") or 0) + 1
    await _event(user_id, "verification_attempt", f"Checking with {adapter.platform} (attempt {attempts})",
                 order=order)
    try:
        if order.get("external_order_id"):
            remote = await adapter.fetch_order(account, order["external_order_id"])
            matched = [remote] if remote is not None else []
        else:
            matched = [r for r in await adapter.list_orders(account)
                       if _norm_title(r.title) and _norm_title(r.title) == _norm_title(order.get("title"))]
    except AccessRevoked as exc:
        await store.update_account(user_id, account["id"], {"status": "needs_reauth", "last_sync_error": str(exc)})
        await _event(user_id, "verification_failed", str(exc), order=order, status="error")
        if was_verified:
            return await _update_with_retry(user_id, order_id, {"next_verify_at": None})
        return await _update_with_retry(user_id, order_id, {
            "verification_status": Verification.FAILED.value,
            "verification_reason": f"{adapter.platform} rejected the account's access. Reconnect the account, then retry.",
            "verification_attempts": attempts, "last_verification_at": now, "next_verify_at": None,
        })
    except AdapterError as exc:
        exhausted = attempts >= MAX_VERIFY_ATTEMPTS or not exc.retryable
        await _event(user_id, "verification_failed", f"{exc}{' — giving up' if exhausted else ' — will retry'}",
                     order=order, status="error" if exhausted else "warning")
        if was_verified:
            return await _update_with_retry(user_id, order_id, {
                "next_verify_at": None if exhausted else now + _backoff(attempts),
                "verification_attempts": attempts, "last_verification_at": now,
            })
        return await _update_with_retry(user_id, order_id, {
            "verification_status": Verification.FAILED.value if exhausted else Verification.PENDING.value,
            "verification_reason": (f"Could not reach {adapter.platform} after {attempts} attempts. Retry later."
                                    if exhausted else f"{adapter.platform} check failed; retrying automatically."),
            "verification_attempts": attempts, "last_verification_at": now,
            "next_verify_at": None if exhausted else now + _backoff(attempts),
        })

    if not order.get("external_order_id"):
        if len(matched) == 1:
            return await _absorb_unmatched(user_id, order, matched[0], account, adapter)
        age = now - (order.get("detected_at") or now)
        if age >= UNMATCHED_SIGNAL_WINDOW:
            # Not finding a title match isn't the platform contradicting the
            # email (titles get reworded), so this fails rather than rejects.
            await _event(user_id, "verification_failed", "No matching order found on the account", order=order,
                         status="error")
            return await _update_with_retry(user_id, order_id, {
                "verification_status": Verification.FAILED.value,
                "verification_reason": f"Couldn't match this notification to an order on the {adapter.platform} "
                                       "account. Check it on the platform.",
                "verification_attempts": attempts, "last_verification_at": now, "next_verify_at": None,
            })
        reason = ("Several orders on the account share this title; open the order on the platform to confirm it."
                  if len(matched) > 1 else
                  "The notification had no order ID and no matching order was found yet; will check again.")
        return await _update_with_retry(user_id, order_id, {
            "verification_status": Verification.PENDING.value, "verification_reason": reason,
            "verification_attempts": attempts, "last_verification_at": now,
            "next_verify_at": now + timedelta(hours=1),
        })

    if not matched and not order.get("last_synced_at") and _norm_title(order.get("title")):
        # The id came from an email and may have been mis-parsed; a unique
        # title match on the account is better evidence than the id.
        try:
            by_title = [r for r in await adapter.list_orders(account)
                        if _norm_title(r.title) == _norm_title(order.get("title"))]
        except AdapterError:
            by_title = []
        if len(by_title) == 1 and by_title[0].external_order_id != order["external_order_id"]:
            return await _absorb_unmatched(user_id, order, by_title[0], account, adapter)
    if not matched and was_verified:
        # It existed when verified; "gone now" is worth flagging, but it is
        # not evidence the order was never genuine.
        await _event(user_id, "verification_failed", f"{adapter.platform} no longer returns this order",
                     order=order, status="warning")
        return await _update_with_retry(user_id, order_id, {
            "verification_reason": f"Verified earlier, but {adapter.platform} no longer returns it for this account. "
                                   "Check it on the platform.",
            "verification_attempts": attempts, "last_verification_at": now, "next_verify_at": None,
        })
    if not matched:
        await _event(user_id, "verification_rejected", f"{adapter.platform} has no such order for this account",
                     order=order, status="error")
        return await _update_with_retry(user_id, order_id, {
            "verification_status": Verification.REJECTED.value,
            "verification_reason": f"{adapter.platform} has no order {order['external_order_id']} on this account.",
            "verification_attempts": attempts, "last_verification_at": now, "next_verify_at": None,
        })
    result = await ingest(user_id, replace(matched[0], authoritative=True), account)
    if result.order.get("verification_attempts") != attempts:
        return await _update_with_retry(user_id, result.order["id"], {"verification_attempts": attempts})
    return result.order


async def dismiss(user_id: str, order_id: str) -> dict | None:
    """User says a detected order isn't genuine. Verified orders can't be
    dismissed: the platform has confirmed them."""
    order = await store.get_order(user_id, order_id)
    if order is None or order.get("verification_status") == Verification.VERIFIED.value:
        return None
    updated = await _update_with_retry(user_id, order_id, {
        "verification_status": Verification.REJECTED.value, "dismissed": True,
        "verification_reason": "Dismissed by you as not genuine.", "next_verify_at": None,
    })
    await _event(user_id, "dismissed", "Dismissed by the user", order=updated, status="warning")
    return updated


async def assign_account(user_id: str, order_id: str, account: dict) -> dict | None:
    order = await store.get_order(user_id, order_id)
    if order is None or order.get("verification_status") == Verification.VERIFIED.value:
        return None
    if account["platform"] != order["platform"]:
        raise ValueError("The account is on a different platform.")
    adapter = get_adapter(order["platform"])
    status, reason, next_at = _verification_plan(adapter, account)
    updated = await _update_with_retry(user_id, order_id, {
        "account_id": account["id"], "verification_status": status, "verification_reason": reason,
        "next_verify_at": next_at, "dismissed": False,
    })
    await _event(user_id, "account_assigned", f"Linked to account {account.get('label') or account['id']}",
                 order=updated)
    return updated


# --------------------------------------------------------------------------- #
# Synchronisation
# --------------------------------------------------------------------------- #
async def sync_account(user_id: str, account_id: str) -> dict:
    account = await store.get_account(user_id, account_id)
    if account is None:
        raise LookupError("Account not found")
    adapter = get_adapter(account["platform"])
    if adapter is None or not adapter.has_api or not account_has_api(account):
        return {"status": "skipped", "reason": f"{account['platform']} orders can't be polled; "
                                               "they arrive by notification email."}
    if not adapter.api_enabled(get_settings()):
        return {"status": "skipped", "reason": f"{adapter.platform} API access is not approved in this environment."}
    now = store.now()
    try:
        remotes = await adapter.list_orders(account)
    except AdapterError as exc:
        failures = int(account.get("consecutive_failures") or 0) + 1
        revoked = isinstance(exc, AccessRevoked)
        await store.update_account(user_id, account_id, {
            "status": "needs_reauth" if revoked else account.get("status", "active"),
            "last_sync_status": "error", "last_sync_error": str(exc)[:300],
            "consecutive_failures": failures,
            "next_sync_at": None if revoked else now + min(SYNC_INTERVAL * (2 ** failures), MAX_SYNC_BACKOFF),
        })
        await _event(user_id, "sync_failed", str(exc), account_id=account_id, status="error",
                     data={"consecutiveFailures": failures})
        if revoked or failures in (3, 10):
            await repo.notify(user_id, f"{adapter.platform} order sync failing",
                              f"{account.get('label') or adapter.platform}: {exc}", "warning")
            await repo.log_activity(user_id, "Order Sync",
                                    f"{adapter.platform} sync failed for {account.get('label') or account_id}: {exc}",
                                    "error")
        return {"status": "error", "error": str(exc), "consecutiveFailures": failures}

    # The first sync backfills the account's existing orders quietly.
    backfill = account.get("last_sync_at") is None
    created = changed = skipped = 0
    for remote in remotes:
        if _belongs_to_other_account(remote, account):
            skipped += 1
            continue
        result = await ingest(user_id, replace(remote, authoritative=True), account, announce=not backfill)
        created += result.created
        changed += result.changed and not result.created

    # Emails that named no order id: match them against the list just fetched.
    by_title: dict[str, list[OrderSignal]] = {}
    for remote in remotes:
        if not _belongs_to_other_account(remote, account):
            by_title.setdefault(_norm_title(remote.title), []).append(remote)
    for order in await store.orders_for_account(user_id, account_id):
        if order.get("external_order_id") or order.get("verification_status") != Verification.PENDING.value:
            continue
        candidates = by_title.get(_norm_title(order.get("title")), []) if _norm_title(order.get("title")) else []
        if len(candidates) == 1:
            await _absorb_unmatched(user_id, order, candidates[0], account, adapter)
            changed += 1

    if backfill and created:
        await repo.notify(user_id, f"{adapter.platform} account connected",
                          f"Imported {created} existing orders from {account.get('label') or adapter.platform}.",
                          "success")

    await store.update_account(user_id, account_id, {
        "status": "active", "last_sync_at": now, "last_sync_status": "ok", "last_sync_error": None,
        "consecutive_failures": 0, "next_sync_at": now + SYNC_INTERVAL,
    })
    if created or changed:
        await _event(user_id, "sync_completed", f"{created} new, {changed} updated", account_id=account_id,
                     status="success", data={"created": created, "changed": changed, "seen": len(remotes)})
    return {"status": "ok", "seen": len(remotes), "created": created, "changed": changed, "skipped": skipped}


async def handle_webhook_hint(user_id: str, account: dict, order_ids: list[str]) -> dict:
    """Fetch each order a webhook named and store what the platform returns.
    Ids the platform doesn't confirm for this account are logged and dropped."""
    adapter = get_adapter(account["platform"])
    if adapter is None or not adapter.has_api or not account_has_api(account):
        return {"fetched": 0, "ignored": len(order_ids)}
    fetched = ignored = 0
    for order_id in list(dict.fromkeys(order_ids))[:20]:
        try:
            remote = await adapter.fetch_order(account, order_id)
        except AdapterError as exc:
            # The next scheduled poll picks it up.
            await _event(user_id, "webhook_fetch_failed", f"Couldn't fetch {order_id}: {exc}",
                         account_id=account["id"], status="warning")
            ignored += 1
            continue
        if remote is None or _belongs_to_other_account(remote, account):
            await _event(user_id, "webhook_ignored", f"Webhook named {order_id}, which "
                                                     f"{adapter.platform} doesn't show on this account",
                         account_id=account["id"], status="warning")
            ignored += 1
            continue
        await ingest(user_id, replace(remote, source=Source.WEBHOOK, authoritative=True), account)
        fetched += 1
    return {"fetched": fetched, "ignored": ignored}


async def ingest_email(user_id: str, platform: str, subject: str, body: str, *, message_ref: str | None,
                       received_at: str | None, account: dict | None = None) -> IngestResult | None:
    """Run a stored notification email through its platform's order parser."""
    adapter = get_adapter(platform)
    if adapter is None or not adapter.email_rules:
        return None
    signal = adapter.parse_email(subject, body, message_ref=message_ref, received_at=received_at)
    if signal is None:
        return None
    if account is None:
        # Only one account of this platform: the email must be about it.
        candidates = [a for a in await store.list_accounts(user_id)
                      if a["platform"] == adapter.platform and a.get("status") != "disabled"]
        account = candidates[0] if len(candidates) == 1 else None
    # Verification is left to the caller (a background task or the
    # scheduler) so an email webhook never waits on a platform API.
    return await ingest(user_id, signal, account)


# --------------------------------------------------------------------------- #
# Scheduler entry points
# --------------------------------------------------------------------------- #
async def run_due_syncs(limit: int = 200, concurrency: int = 5) -> dict:
    semaphore = asyncio.Semaphore(concurrency)
    accounts = await store.due_accounts(store.now(), limit)

    async def one(account: dict) -> str:
        async with semaphore:
            try:
                return (await sync_account(account["user_id"], account["id"]))["status"]
            except Exception:
                log.exception("order sync crashed for account %s", account["id"])
                return "error"

    outcomes = await asyncio.gather(*(one(a) for a in accounts))
    return {"accounts": len(accounts), "ok": outcomes.count("ok"), "failed": outcomes.count("error")}


async def run_due_verifications(limit: int = 200) -> dict:
    done = failed = 0
    for order in await store.due_verifications(store.now(), limit):
        try:
            await verify(order["user_id"], order["id"])
            done += 1
        except Exception:
            failed += 1
            log.exception("order verification crashed for order %s", order["id"])
    return {"checked": done, "failed": failed}


async def enforce_retention() -> dict:
    """Clear platform-sourced fields once a platform's cache limit passes
    without a refresh (Upwork's API terms cap cached data at 24 hours)."""
    from .adapters import all_adapters

    cleared = 0
    for adapter in all_adapters():
        if adapter.max_cache_age is None:
            continue
        for order in await store.expired_orders(adapter.platform, store.now() - adapter.max_cache_age):
            fields = {name: ([] if name == "milestones" else None) for name in _PLATFORM_FIELDS}
            fields.update(status=OrderStatus.UNKNOWN.value, data_expired=True)
            try:
                updated = await _update_with_retry(order["user_id"], order["id"], fields)
            except OrderConflict:
                continue
            if updated:
                cleared += 1
                await _event(order["user_id"], "data_expired",
                             f"{adapter.platform} data cleared after {adapter.max_cache_age} without a refresh "
                             "(platform API terms). It returns on the next successful sync.",
                             order=updated, status="warning")
    return {"cleared": cleared}


__all__ = [
    "IngestResult", "OrderConflict", "account_has_api", "assign_account", "dedupe_key", "dismiss",
    "enforce_retention", "ingest", "ingest_email", "needs_verification", "run_due_syncs", "run_due_verifications",
    "sync_account", "verify", "Kind", "Source",
]
