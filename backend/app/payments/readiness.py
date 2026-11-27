"""Stripe readiness: what the platform owner checks before (and after) switching online payment on.

GET /api/payments/stripe/readiness (routers/payments.py) runs the config checks, which read settings only, and with
probe=true asks Stripe for the account's activation flags and the registered webhook endpoints. Every check is
{id, label, status: pass|warn|fail, detail}. Nothing secret is returned: keys appear as their prefix and last four
characters, and Stripe's own error text (which can echo part of a key) is never passed on.

REQUIRED_EVENTS is the one list of webhook events the endpoint must be subscribed to; docs/payments.md quotes it
and a test keeps every event the webhook handles inside it.
"""
from urllib.parse import urlsplit

from ..config import Settings, _is_https_origin
from . import stripe_api

REQUIRED_EVENTS = (
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
    "charge.refunded",
    "charge.dispute.created",
    "charge.dispute.updated",
    "charge.dispute.closed",
)
WEBHOOK_PATH = "/payments/stripe/webhook"
_KEY_MODES = {"sk_test_": "test", "sk_live_": "live", "rk_test_": "restricted-test", "rk_live_": "restricted-live"}


def key_mode(key: str | None) -> str:
    """"test", "live", "restricted-test", "restricted-live", "unknown", or "off" when unset."""
    key = (key or "").strip()
    if not key:
        return "off"
    return next((mode for prefix, mode in _KEY_MODES.items() if key.startswith(prefix)), "unknown")


def mask(secret: str | None) -> str:
    """Prefix up to the last underscore of the type marker, plus the last four characters, and only when the
    secret is long enough that those don't give much of it away."""
    secret = (secret or "").strip()
    if not secret:
        return ""
    head = next((p for p in (*_KEY_MODES, "whsec_") if secret.startswith(p)), "")
    return f"{head}…{secret[-4:]}" if len(secret) >= len(head) + 16 else f"{head}…"


def webhook_url(settings: Settings) -> str | None:
    """Where Stripe must send events, when the API's public address is known."""
    base = settings.public_api_url.strip().rstrip("/")
    return f"{base}{settings.api_prefix}{WEBHOOK_PATH}" if base else None


def _check(check_id: str, label: str, status: str, detail: str) -> dict:
    return {"id": check_id, "label": label, "status": status, "detail": detail}


def config_checks(settings: Settings) -> list[dict]:
    """No network: what the settings say. The production guard (config.production_problems) is consulted
    directly, so these checks refuse exactly what a production deploy would refuse."""
    guard = settings.production_problems()
    refused = lambda name: next((p for p in guard if name in p), None)  # noqa: E731
    production = settings.environment == "production"
    checks = []

    key = (settings.stripe_secret_key or "").strip()
    mode = key_mode(key)
    if mode == "off":
        checks.append(_check("secret_key", "Secret key", "fail",
                             "STRIPE_SECRET_KEY is not set: checkout returns 503 and nothing is charged."))
    elif mode == "unknown":
        checks.append(_check("secret_key", "Secret key", "fail",
                             "STRIPE_SECRET_KEY doesn't look like a secret key (sk_test_, sk_live_, rk_test_ or rk_live_). "
                             "A publishable key (pk_) can't create payments."))
    else:
        checks.append(_check("secret_key", "Secret key", "pass", f"Set ({mask(key)})."))
        problem = refused("STRIPE_SECRET_KEY")
        if mode.endswith("live"):
            checks.append(_check("mode", "Mode", "fail" if problem else "warn",
                                 f"Live key. The production guard refuses it for this release: {problem}" if problem
                                 else "Live key: real cards are charged."))
        elif mode == "restricted-test":
            checks.append(_check("mode", "Mode", "warn",
                                 "Test mode with a restricted key. It needs write access to Checkout Sessions, Customer "
                                 "portal and Subscriptions, and read access to PaymentIntents, Account and Webhook "
                                 "Endpoints (for the live check)."))
        else:
            checks.append(_check("mode", "Mode", "pass", "Test mode: no real money moves."))

    secret = (settings.stripe_webhook_secret or "").strip()
    if not secret:
        checks.append(_check("webhook_secret", "Webhook signing secret", "fail",
                             "STRIPE_WEBHOOK_SECRET is not set: the webhook refuses every call (503), so nothing is ever "
                             "marked paid."))
    elif not secret.startswith("whsec_"):
        checks.append(_check("webhook_secret", "Webhook signing secret", "fail",
                             "STRIPE_WEBHOOK_SECRET doesn't start with whsec_: copy the endpoint's signing secret, not an "
                             "API key."))
    else:
        checks.append(_check("webhook_secret", "Webhook signing secret", "pass", f"Set ({mask(secret)})."))

    site = settings.public_site_url.strip()
    if site:
        problem = refused("PUBLIC_SITE_URL")
        ok = _is_https_origin(site)
        checks.append(_check("site_url", "Return address", "pass" if ok else "fail",
                             f"Stripe returns clients to {site.rstrip('/')}." if ok
                             else problem or "PUBLIC_SITE_URL must be an https:// origin without a path."))
    else:
        effective = settings.site_url
        https = _is_https_origin(effective)
        checks.append(_check("site_url", "Return address", "warn" if https or not production else "fail",
                             f"PUBLIC_SITE_URL is blank, so Stripe returns clients to the first CORS origin ({effective})"
                             + ("." if https else ", which isn't https.") + " Set PUBLIC_SITE_URL explicitly."))

    url = webhook_url(settings)
    if url:
        https = urlsplit(url).scheme == "https"
        checks.append(_check("webhook_url", "Webhook address", "pass" if https else "warn",
                             f"Register {url} in the Stripe Dashboard." if https
                             else f"{url} isn't https: Stripe only delivers live events to https endpoints."))
    else:
        checks.append(_check("webhook_url", "Webhook address", "warn",
                             f"PUBLIC_API_URL is blank, so the live check matches endpoints by path (…{settings.api_prefix}"
                             f"{WEBHOOK_PATH})."))

    if settings.payments_crypto_enabled:
        problem = refused("PAYMENTS_CRYPTO_ENABLED")
        checks.append(_check("crypto", "Crypto (USDC)", "fail" if problem else "warn",
                             f"The production guard refuses it for this release: {problem}" if problem
                             else "On: Stripe must have enabled stablecoin payments on the account, or crypto checkout fails."))
    else:
        checks.append(_check("crypto", "Crypto (USDC)", "pass", "Off: clients pay by card."))
    return checks


def _probe_failure(check_id: str, label: str, what: str, exc: stripe_api.StripeError) -> dict:
    if exc.status == 401:
        detail = "Stripe rejected the secret key (401)."
    elif exc.status == 403:
        detail = f"The key isn't allowed to read {what} (403): give the restricted key read access."
    elif exc.status:
        detail = f"Stripe answered {exc.status} when reading {what}."
    else:
        detail = f"Stripe couldn't be reached to read {what}."
    return _check(check_id, label, "fail", detail)


def _same_endpoint(found: str, expected: str | None, prefix: str) -> bool:
    try:
        got = urlsplit(found)
    except ValueError:
        return False
    if expected:
        want = urlsplit(expected)
        return (got.scheme, (got.hostname or "").lower(), got.port, got.path.rstrip("/")) == \
            (want.scheme, (want.hostname or "").lower(), want.port, want.path.rstrip("/"))
    return got.path.rstrip("/").endswith(f"{prefix}{WEBHOOK_PATH}")


async def probe(settings: Settings) -> tuple[list[dict], dict | None, list[dict] | None]:
    """Live calls to Stripe (read-only). Returns (checks, account summary, matching endpoints)."""
    live = key_mode(settings.stripe_secret_key).endswith("live")
    checks: list[dict] = []
    account = endpoints = None
    try:
        acct = await stripe_api.retrieve_account(settings)
    except stripe_api.StripeError as exc:
        checks.append(_probe_failure("account", "Stripe account", "the account", exc))
    else:
        account = {
            "chargesEnabled": bool(acct.get("charges_enabled")), "payoutsEnabled": bool(acct.get("payouts_enabled")),
            "detailsSubmitted": bool(acct.get("details_submitted")), "country": str(acct.get("country") or "")[:2],
            "defaultCurrency": str(acct.get("default_currency") or "")[:3],
        }
        checks.append(_check("charges", "Charges", "pass" if account["chargesEnabled"] else "fail" if live else "warn",
                             "The account can take payments." if account["chargesEnabled"]
                             else "The account can't take live payments yet: finish activation in the Stripe Dashboard."
                             + ("" if live else " Test payments still work.")))
        checks.append(_check("payouts", "Payouts", "pass" if account["payoutsEnabled"] else "warn",
                             "Payouts to the bank account are on." if account["payoutsEnabled"]
                             else "Payouts are off: add and verify a bank account in the Stripe Dashboard."))
        checks.append(_check("details", "Business details", "pass" if account["detailsSubmitted"] else "warn",
                             "Submitted." if account["detailsSubmitted"]
                             else "Not submitted: Stripe needs the business details before going live."))
        currency = account["defaultCurrency"]
        checks.append(_check("currency", "Currency", "pass" if currency in ("usd", "") else "warn",
                             "Invoices are charged in USD." if currency in ("usd", "")
                             else f"Invoices are charged in USD; Stripe converts them to {currency.upper()} for payout."))
    try:
        found = await stripe_api.list_webhook_endpoints(settings)
    except stripe_api.StripeError as exc:
        checks.append(_probe_failure("endpoint", "Webhook endpoint", "webhook endpoints", exc))
        return checks, account, endpoints
    expected = webhook_url(settings)
    endpoints = []
    for e in found:
        if not _same_endpoint(str(e.get("url") or ""), expected, settings.api_prefix):
            continue
        subscribed = [str(x) for x in e.get("enabled_events") or []]
        missing = [] if "*" in subscribed else [ev for ev in REQUIRED_EVENTS if ev not in subscribed]
        endpoints.append({"id": str(e.get("id") or "")[:100], "url": str(e.get("url") or "")[:500],
                          "status": str(e.get("status") or "")[:20], "livemode": bool(e.get("livemode")),
                          "allEvents": "*" in subscribed, "missingEvents": missing})
    where = expected or f"…{settings.api_prefix}{WEBHOOK_PATH}"
    if not endpoints:
        checks.append(_check("endpoint", "Webhook endpoint", "fail",
                             f"No endpoint for {where} in this Stripe mode (test and live endpoints are separate)."))
        return checks, account, endpoints
    enabled = [e for e in endpoints if e["status"] == "enabled"]
    checks.append(_check("endpoint", "Webhook endpoint", "pass" if enabled else "fail",
                         f"Registered and enabled ({where})." if enabled else f"Registered but disabled ({where})."))
    if len(endpoints) > 1:
        checks.append(_check("endpoint_count", "Duplicate endpoints", "warn",
                             f"{len(endpoints)} endpoints point here. Stripe signs each with its own secret, so only one "
                             "matches STRIPE_WEBHOOK_SECRET and the other deliveries fail. Delete the extra ones."))
    best = (enabled or endpoints)[0]
    if best["missingEvents"]:
        checks.append(_check("events", "Subscribed events", "fail", "Missing: " + ", ".join(best["missingEvents"]) + "."))
    else:
        checks.append(_check("events", "Subscribed events", "pass",
                             "Subscribed to all events." if best["allEvents"] else "Every required event is subscribed."))
    return checks, account, endpoints


def summary(checks: list[dict]) -> str:
    statuses = {c["status"] for c in checks}
    return "fail" if "fail" in statuses else "warn" if "warn" in statuses else "pass"


async def report(settings: Settings, *, probe_stripe: bool) -> dict:
    checks = config_checks(settings)
    account = endpoints = None
    probed = probe_stripe and stripe_api.configured(settings) and key_mode(settings.stripe_secret_key) != "unknown"
    if probed:
        live_checks, account, endpoints = await probe(settings)
        checks += live_checks
    return {
        "summary": summary(checks), "mode": key_mode(settings.stripe_secret_key), "key": mask(settings.stripe_secret_key),
        "environment": settings.environment, "webhookUrl": webhook_url(settings), "requiredEvents": list(REQUIRED_EVENTS),
        "probed": probed, "checks": checks, "account": account, "endpoints": endpoints,
    }
