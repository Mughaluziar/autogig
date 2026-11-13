"""Adapter contract for marketplace order integrations.

An adapter knows one platform: how to reach its API (if any), how to read its
notification emails, and what it cannot do. It never stores anything. The
ingestion service (orders/service.py) owns deduplication, verification state,
retries and the audit trail, so adding a platform means writing one adapter
and registering it in adapters/__init__.py.
"""
import re
from dataclasses import dataclass, field
from datetime import timedelta

from ..models import Kind, OrderSignal, OrderStatus, Source


class AdapterError(Exception):
    """A platform call failed. `retryable` errors are retried with backoff."""

    def __init__(self, message: str, *, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


class AccessRevoked(AdapterError):
    """The platform rejected the account's credentials or scopes (401/403).
    The account needs to be reconnected; retrying will not help."""

    def __init__(self, message: str):
        super().__init__(message, retryable=False)


@dataclass(frozen=True)
class AccountIdentity:
    external_account_id: str
    handle: str = ""


@dataclass(frozen=True)
class Capability:
    """What an integration can do in principle, and whether it is on here."""
    platform: str
    key: str
    # Methods the platform permits in principle: api_poll, webhook, email.
    detection: tuple[str, ...]
    # "api" when orders can be confirmed against the platform, else "none".
    verification: str
    status_sync: bool
    # True when this environment has the approvals/credentials to call the API.
    api_enabled: bool
    connection: str                    # "upwork_oauth", "nango", "platform_token" or "email"
    limitations: tuple[str, ...] = ()
    email_domains: tuple[str, ...] = ()
    email_parser_validated: bool = False
    max_cache_hours: int | None = None

    def as_dict(self) -> dict:
        return {
            "platform": self.platform, "key": self.key, "detection": list(self.detection),
            "verification": self.verification, "statusSync": self.status_sync,
            "apiEnabled": self.api_enabled, "connection": self.connection,
            "limitations": list(self.limitations), "emailDomains": list(self.email_domains),
            "emailParserValidated": self.email_parser_validated,
            "maxCacheHours": self.max_cache_hours,
        }


@dataclass(frozen=True)
class EmailRule:
    """Subject pattern -> what the notification means."""
    pattern: re.Pattern
    status: OrderStatus


_MONEY = re.compile(
    r"(?P<cur>US\$|\$|USD|EUR|€|GBP|£)\s?(?P<amt>\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)",
)
_CURRENCY_CODES = {"US$": "USD", "$": "USD", "USD": "USD", "EUR": "EUR", "€": "EUR", "GBP": "GBP", "£": "GBP"}


def parse_money(text: str) -> tuple[float | None, str | None]:
    match = _MONEY.search(text or "")
    if not match:
        return None, None
    try:
        return float(match.group("amt").replace(",", "")), _CURRENCY_CODES[match.group("cur")]
    except (ValueError, KeyError):
        return None, None


@dataclass
class OrderAdapter:
    """Base adapter. Subclasses override what their platform supports."""
    key: str = ""
    platform: str = ""
    email_domains: tuple[str, ...] = ()
    # How the API is reached: "upwork_oauth" (per-user OAuth straight to
    # Upwork, app/upwork/), "nango" (per-user OAuth through Nango),
    # "platform_token" (the platform owner's configured token), or "email"
    # (no API — notification emails only).
    connection_kind: str = "email"
    # Nango provider config key when connection_kind is "nango".
    integration_id: str | None = None
    # Platform terms that cap how long API data may be kept.
    max_cache_age: timedelta | None = None
    email_rules: tuple[EmailRule, ...] = ()
    order_id_pattern: re.Pattern | None = None
    email_kind: Kind = Kind.ORDER
    email_parser_validated: bool = False
    limitations: tuple[str, ...] = field(default_factory=tuple)

    def environment_label(self, settings) -> str:
        """Suffix for account labels when the API is a test environment."""
        return ""

    @property
    def has_api(self) -> bool:
        return self.connection_kind != "email"

    # ---- environment ------------------------------------------------------
    def api_enabled(self, settings) -> bool:
        """True when credentials and every approval switch for order reads are set."""
        return False

    def capability(self, settings) -> Capability:
        detection = ["email"] if self.email_domains else []
        if self.has_api:
            detection.insert(0, "api_poll")
        return Capability(
            platform=self.platform, key=self.key, detection=tuple(detection),
            verification="api" if self.has_api else "none", status_sync=self.has_api,
            api_enabled=self.api_enabled(settings), connection=self.connection_kind,
            limitations=self.limitations, email_domains=self.email_domains,
            email_parser_validated=self.email_parser_validated,
            max_cache_hours=int(self.max_cache_age.total_seconds() // 3600) if self.max_cache_age else None,
        )

    # ---- API (override when the platform has one) ----------------------------
    async def identify(self, account: dict) -> AccountIdentity:
        raise AdapterError(f"{self.platform} has no account API.", retryable=False)

    async def list_orders(self, account: dict) -> list[OrderSignal]:
        raise AdapterError(f"{self.platform} has no order API.", retryable=False)

    async def fetch_order(self, account: dict, external_order_id: str) -> OrderSignal | None:
        """Return the order as the platform reports it for this account, or
        None when the platform says it does not exist for this account."""
        raise AdapterError(f"{self.platform} has no order API.", retryable=False)

    def webhook_order_ids(self, payload: dict) -> list[str]:
        """Order ids named by a provider webhook that Nango forwarded.

        Return [] for events that aren't about orders. A webhook is only a
        hint: the service fetches each id from the API before storing it, so
        a forged or replayed delivery can't create or confirm an order.
        """
        return []

    # ---- notification email -------------------------------------------------
    def parse_email(self, subject: str, body: str, *, message_ref: str | None = None,
                    received_at: str | None = None) -> OrderSignal | None:
        """Turn a notification email into an unverified signal, or None when
        the email is not about an order. Email content is user-forwarded and
        sender headers can be spoofed, so the result is never authoritative."""
        subject = subject or ""
        rule = next((r for r in self.email_rules if r.pattern.search(subject)), None)
        if rule is None:
            return None
        text = f"{subject}\n{body or ''}"
        order_id = None
        if self.order_id_pattern is not None:
            match = self.order_id_pattern.search(text)
            order_id = match.group(1) if match else None
        amount, currency = parse_money(text)
        return OrderSignal(
            platform=self.platform, source=Source.EMAIL, external_order_id=order_id,
            kind=self.email_kind, title=self.email_title(subject, body), client_name=self.email_client(subject, body),
            amount=amount, currency=currency, status=rule.status, created_at=received_at or None,
            signal_ref=message_ref, authoritative=False,
        )

    def email_title(self, subject: str, body: str) -> str | None:
        return re.sub(r"\s+", " ", subject).strip()[:200] or None

    def email_client(self, subject: str, body: str) -> str | None:
        return None
