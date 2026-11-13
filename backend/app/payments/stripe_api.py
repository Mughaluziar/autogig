"""Minimal Stripe REST client: Checkout Sessions (one-off payments and plan
subscriptions), the billing portal, and webhook signatures.

Calls the HTTP API with httpx (no SDK dependency). Debit and credit cards both
use the `card` payment method: Checkout can't restrict a card's funding type,
so the method the payer picks is a preference, and the webhook records the
real funding type from the charge when Stripe reports it. Crypto uses
Stripe's stablecoin payment method (`crypto`, USDC), which has to be enabled
on the Stripe account first.
"""
import hashlib
import hmac
import logging
import time

import httpx

from ..config import Settings

log = logging.getLogger("autopilot.payments")

API_BASE = "https://api.stripe.com/v1"
_TIMEOUT = httpx.Timeout(15.0, connect=5.0)
# Checkout Sessions must stay open at least 30 minutes; a little over avoids
# clock-skew rejections.
SESSION_TTL_SECONDS = 31 * 60
SIGNATURE_TOLERANCE_SECONDS = 300


class StripeError(Exception):
    """Stripe rejected the call or couldn't be reached. Nothing was charged."""


def configured(settings: Settings) -> bool:
    return bool(settings.stripe_secret_key)


def crypto_enabled(settings: Settings) -> bool:
    return configured(settings) and settings.payments_crypto_enabled


def _headers(settings: Settings) -> dict:
    return {"Authorization": f"Bearer {settings.stripe_secret_key}", "Stripe-Version": "2024-06-20"}


async def create_checkout_session(
    settings: Settings, *, amount_cents: int, name: str, method: str, metadata: dict,
    success_url: str, cancel_url: str, client_reference_id: str,
) -> dict:
    """Create a one-off Checkout Session for a fixed USD amount. Returns
    {"id", "url"}."""
    pm_type = "crypto" if method == "crypto" else "card"
    form = {
        "mode": "payment",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": str(amount_cents),
        "line_items[0][price_data][product_data][name]": name[:250],
        "payment_method_types[0]": pm_type,
        "success_url": success_url,
        "cancel_url": cancel_url,
        "client_reference_id": client_reference_id,
        "expires_at": str(int(time.time()) + SESSION_TTL_SECONDS),
    }
    for k, v in metadata.items():
        form[f"metadata[{k}]"] = str(v)
        form[f"payment_intent_data[metadata][{k}]"] = str(v)
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.post(f"{API_BASE}/checkout/sessions", data=form, headers=_headers(settings))
    except httpx.HTTPError as exc:
        log.warning("stripe checkout create failed: %s", exc)
        raise StripeError("The payment provider couldn't be reached.") from exc
    if res.status_code >= 400:
        try:
            message = res.json().get("error", {}).get("message", "")
        except ValueError:
            message = ""
        log.warning("stripe checkout create rejected (%s): %s", res.status_code, message)
        raise StripeError(message or "The payment provider rejected the request.")
    body = res.json()
    if not body.get("url"):
        raise StripeError("The payment provider returned no checkout page.")
    return {"id": body.get("id", ""), "url": body["url"]}


async def _post(settings: Settings, path: str, form: dict, what: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.post(f"{API_BASE}{path}", data=form, headers=_headers(settings))
    except httpx.HTTPError as exc:
        log.warning("stripe %s failed: %s", what, exc)
        raise StripeError("The payment provider couldn't be reached.") from exc
    if res.status_code >= 400:
        try:
            message = res.json().get("error", {}).get("message", "")
        except ValueError:
            message = ""
        log.warning("stripe %s rejected (%s): %s", what, res.status_code, message)
        raise StripeError(message or "The payment provider rejected the request.")
    try:
        return res.json()
    except ValueError as exc:
        raise StripeError("The payment provider sent an unreadable reply.") from exc


async def create_subscription_session(
    settings: Settings, *, amount_cents: int, name: str, interval: str, trial_days: int, metadata: dict,
    success_url: str, cancel_url: str, client_reference_id: str, customer_id: str | None = None,
    customer_email: str | None = None,
) -> dict:
    """Checkout Session for a recurring plan, with an optional free trial.
    Card wallets (Apple Pay, Google Pay) show up on Stripe's page when they're
    enabled on the account. Returns {"id", "url"}."""
    form = {
        "mode": "subscription",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": str(amount_cents),
        "line_items[0][price_data][recurring][interval]": interval,
        "line_items[0][price_data][product_data][name]": name[:250],
        "payment_method_types[0]": "card",
        "allow_promotion_codes": "true",
        "success_url": success_url,
        "cancel_url": cancel_url,
        "client_reference_id": client_reference_id,
    }
    if trial_days > 0:
        form["subscription_data[trial_period_days]"] = str(trial_days)
        # No card on file when the trial ends: cancel instead of billing nothing.
        form["subscription_data[trial_settings][end_behavior][missing_payment_method]"] = "cancel"
    if customer_id:
        form["customer"] = customer_id
    elif customer_email:
        form["customer_email"] = customer_email
    for k, v in metadata.items():
        form[f"metadata[{k}]"] = str(v)
        form[f"subscription_data[metadata][{k}]"] = str(v)
    body = await _post(settings, "/checkout/sessions", form, "subscription checkout")
    if not body.get("url"):
        raise StripeError("The payment provider returned no checkout page.")
    return {"id": body.get("id", ""), "url": body["url"]}


async def create_portal_session(settings: Settings, *, customer_id: str, return_url: str) -> str:
    """Stripe's hosted billing portal: change card, see invoices, cancel."""
    body = await _post(settings, "/billing_portal/sessions",
                       {"customer": customer_id, "return_url": return_url}, "billing portal")
    if not body.get("url"):
        raise StripeError("The payment provider returned no billing page.")
    return body["url"]


async def set_cancel_at_period_end(settings: Settings, subscription_id: str, cancel: bool) -> dict:
    """Cancel (or resume) a subscription at the end of the current period."""
    return await _post(settings, f"/subscriptions/{subscription_id}",
                       {"cancel_at_period_end": "true" if cancel else "false"}, "subscription update")


async def payment_method_kind(settings: Settings, payment_intent_id: str) -> str | None:
    """Best effort: "credit", "debit" or "crypto" from the charge, else None."""
    if not payment_intent_id:
        return None
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=4.0)) as client:
            res = await client.get(
                f"{API_BASE}/payment_intents/{payment_intent_id}",
                params={"expand[]": "latest_charge"}, headers=_headers(settings),
            )
        if res.status_code >= 400:
            return None
        details = ((res.json().get("latest_charge") or {}).get("payment_method_details") or {})
    except (httpx.HTTPError, ValueError, AttributeError):
        return None
    if details.get("type") == "crypto":
        return "crypto"
    funding = (details.get("card") or {}).get("funding")
    return funding if funding in ("credit", "debit") else None


def verify_signature(payload: bytes, header: str, secret: str, *,
                     tolerance: int = SIGNATURE_TOLERANCE_SECONDS, now: float | None = None) -> bool:
    """Check a Stripe-Signature header: `t=<unix>,v1=<hex>[,v1=...]`, where
    v1 is HMAC-SHA256 of "<t>.<raw body>" with the endpoint's signing secret.
    Rejects timestamps outside the tolerance in either direction."""
    if not header or not secret:
        return False
    timestamp, signatures = None, []
    for part in header.split(","):
        key, _, value = part.strip().partition("=")
        if key == "t":
            timestamp = value
        elif key == "v1" and value:
            signatures.append(value)
    if not timestamp or not signatures:
        return False
    try:
        ts = int(timestamp)
    except ValueError:
        return False
    current = time.time() if now is None else now
    if abs(current - ts) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, sig) for sig in signatures)
