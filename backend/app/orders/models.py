"""Canonical order model shared by every marketplace adapter.

Adapters translate platform data into `OrderSignal`s. The ingestion service
(service.py) is the only code that turns signals into stored orders, so
deduplication, verification and auditing behave the same for every platform.
"""
from dataclasses import dataclass, field
from enum import Enum


class Verification(str, Enum):
    # The platform's own API, called with this connected account's credentials,
    # returned the order. Nothing else may produce this state.
    VERIFIED = "verified"
    # Detected but not yet confirmed: awaiting a check, a retry, or an API
    # connection for the account.
    PENDING = "pending"
    # Verification was attempted and could not complete (repeated API errors
    # or revoked access). It can be retried.
    FAILED = "failed"
    # The platform contradicted the signal (order not found on the account,
    # or it belongs to another account), or the user dismissed it.
    REJECTED = "rejected"
    # The platform offers no permitted way to verify orders (for example,
    # Fiverr has no seller API). Never counted as confirmed.
    UNVERIFIABLE = "unverifiable"


class OrderStatus(str, Enum):
    OFFER = "offer"              # offer/award made, work not started
    ACTIVE = "active"
    PAUSED = "paused"
    DELIVERED = "delivered"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"
    DISPUTED = "disputed"
    UNKNOWN = "unknown"


class Source(str, Enum):
    API_SYNC = "api_sync"    # scheduled or manual poll of the platform API
    WEBHOOK = "webhook"      # push event — a hint; verified by an API fetch
    EMAIL = "email"          # notification email — never proof on its own


class Kind(str, Enum):
    ORDER = "order"
    CONTRACT = "contract"
    PROJECT = "project"


@dataclass
class Milestone:
    external_id: str
    title: str = ""
    amount: float | None = None
    currency: str | None = None
    status: str = ""
    created_at: str | None = None

    def as_dict(self) -> dict:
        return {"externalId": self.external_id, "title": self.title, "amount": self.amount,
                "currency": self.currency, "status": self.status, "createdAt": self.created_at}


@dataclass
class OrderSignal:
    """One observation of an order from one source.

    `authoritative` is True only when an adapter fetched the order from the
    platform's API using the connected account's own credentials. Email and
    webhook signals are never authoritative.
    """
    platform: str
    source: Source
    external_order_id: str | None = None
    kind: Kind = Kind.ORDER
    title: str | None = None
    client_name: str | None = None
    client_id: str | None = None
    amount: float | None = None
    currency: str | None = None
    # "fixed" or "hourly". For hourly work `amount` is a rate, not a total,
    # so only fixed-price orders can back an early payment.
    pricing: str | None = None
    status: OrderStatus | None = None
    created_at: str | None = None
    updated_at: str | None = None
    url: str | None = None
    # The freelancer-side account id the platform reports for this order;
    # compared with the connected account to catch misattribution.
    account_external_id: str | None = None
    milestones: list[Milestone] = field(default_factory=list)
    authoritative: bool = False
    # Identifies the signal itself (an email Message-ID, a webhook delivery
    # id) so a replayed delivery is recognised.
    signal_ref: str | None = None
