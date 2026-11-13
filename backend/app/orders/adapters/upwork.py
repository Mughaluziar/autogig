"""Upwork — offers read through the official GraphQL API.

On Upwork a client places work with a freelancer by sending an offer, so the
offer is the order. The account is bound by its own OAuth connection: the
`user` query only returns the signed-in freelancer's offers.

Sources (Upwork GraphQL reference; docs/platform-matrix.md):
  * `user { id nid name }` identifies the account.
  * `user { offer(pagination: ...) }` lists the freelancer's offers with a
    lifecycle `state` (Pending | Active | Paused | Ended).
  * `offer(id:)` returns one offer with its terms and milestones; its state
    is an OfferState (SUBMITTED, ACCEPTED, FUNDED, CANCELED, ...).
  * Reads need "Offer - Read-Only Access" plus "Common Entities - Read-Only
    Access". API data may not be cached for more than 24 hours.

Known gaps:
  * The queries follow the published reference but have not been run against
    an approved app; run a contract test before enabling in production.
  * Upwork "Subscriptions" (webhooks) cover offers, but each needs Upwork's
    approval and the docs don't say how deliveries are authenticated, so
    this adapter polls instead.
  * Only the token's default organization is read (no X-Upwork-API-TenantId).

The account's API connection is a direct Upwork OAuth connection
(app/upwork/); tokens are refreshed there.
"""
import re
from dataclasses import dataclass
from datetime import timedelta

from ...config import get_settings
from ...upwork import client as upwork_client
from ..models import Kind, Milestone, OrderSignal, OrderStatus, Source
from .base import AccessRevoked, AccountIdentity, AdapterError, EmailRule, OrderAdapter

_I = re.I
_LIST_LIMIT = 50
_DETAIL_BATCH = 25

_IDENTIFY = "query { user { id nid name } }"

_LIST = """
query freelancerOffers {
  user {
    offer(pagination: { first: %d }) {
      edges { node {
        id title type state
        company { id name }
        startDateTime offerCreatedDateTime lastUpdatedDateTime
      } }
    }
  }
}
""" % _LIST_LIMIT

_OFFER_FIELDS = """
  id title type state
  client { id name }
  offerTerms {
    fixedPriceTerm { budget { rawValue currency } }
    hourlyTerms { rate { rawValue currency } }
  }
  milestones { id description state depositAmount { rawValue currency } createdDateTime }
"""

# Contract lifecycle from the offers list.
_LIFECYCLE = {
    "pending": OrderStatus.OFFER, "active": OrderStatus.ACTIVE,
    "paused": OrderStatus.PAUSED, "ended": OrderStatus.COMPLETED,
}
# OfferState from offer(id:). ACCEPTED/FUNDED say the offer became a
# contract but not where the contract is now, so they map to None (keep
# whatever lifecycle status the list last reported).
_OFFER_STATE = {
    "submitted": OrderStatus.OFFER, "pending_vendor_acceptance": OrderStatus.OFFER,
    "accepted": None, "funded": None,
    "rejected": OrderStatus.CANCELLED, "expired": OrderStatus.CANCELLED, "canceled": OrderStatus.CANCELLED,
    "cancelled": OrderStatus.CANCELLED, "withdrawn": OrderStatus.CANCELLED,
}


def _money(value) -> tuple[float | None, str | None]:
    if isinstance(value, list):
        value = value[0] if value else None
    if isinstance(value, dict):
        raw = value.get("rawValue")
        try:
            return (float(raw) if raw not in (None, "") else None), value.get("currency")
        except (TypeError, ValueError):
            return None, value.get("currency")
    try:
        return (float(value) if value not in (None, "") else None), None
    except (TypeError, ValueError):
        return None, None


def _first(value):
    return value[0] if isinstance(value, list) and value else value


@dataclass
class UpworkAdapter(OrderAdapter):
    key: str = "upwork"
    platform: str = "Upwork"
    email_domains: tuple[str, ...] = ("upwork.com",)
    connection_kind: str = "upwork_oauth"
    integration_id: str | None = None
    max_cache_age: timedelta | None = timedelta(hours=24)
    email_kind: Kind = Kind.CONTRACT
    email_rules: tuple[EmailRule, ...] = (
        EmailRule(re.compile(r"\b(?:offer|contract)\b.*\b(?:cancel|withdrawn|declined|expired)", _I), OrderStatus.CANCELLED),
        EmailRule(re.compile(r"\bcontract\b.*\b(?:ended|closed|complete)", _I), OrderStatus.COMPLETED),
        EmailRule(re.compile(r"\bcontract\b.*\bpaused\b", _I), OrderStatus.PAUSED),
        EmailRule(re.compile(r"\bcontract\b.*\b(?:started|begun|begins)\b|\byou(?:'|’)?ve been hired\b", _I), OrderStatus.ACTIVE),
        EmailRule(re.compile(r"\b(?:new |received an |sent you an )?offer\b", _I), OrderStatus.OFFER),
    )
    # Only an explicit offer link gives an id from the same id space as
    # offer(id:). Contract/workroom ids differ, so they are not used.
    order_id_pattern: re.Pattern = re.compile(r"upwork\.com/\S*?/offers?/(\d{6,})", _I)
    limitations: tuple[str, ...] = (
        "Needs Upwork commercial API approval and the \"Offer - Read-Only Access\" permission "
        "(UPWORK_COMMERCIAL_APPROVED and UPWORK_OFFERS_READ_APPROVED).",
        "Upwork webhooks (Subscriptions) need Upwork's approval and don't document how deliveries are "
        "authenticated, so orders are checked every 15 minutes instead.",
        "Only the account's default organization is read; agency organizations are not selected.",
        "Upwork's API terms allow API data to be kept for at most 24 hours. If an account stops syncing, "
        "its order details are cleared until the next successful sync.",
        "The queries follow Upwork's GraphQL reference but have not yet been tested against an approved app.",
    )

    def api_enabled(self, settings) -> bool:
        return bool(settings.upwork_offers_read_approved and upwork_client.connect_enabled(settings))

    # ---- transport ----------------------------------------------------------
    async def _graphql(self, account: dict, query: str, variables: dict | None = None) -> dict:
        connection = account.get("connection") or {}
        if not connection.get("connectionId"):
            raise AdapterError("This Upwork account has no API connection.", retryable=False)
        if not self.api_enabled(get_settings()):
            raise AdapterError("Upwork API access is not approved in this environment.", retryable=False)
        try:
            status, payload = await upwork_client.graphql(connection["connectionId"], account.get("user_id"),
                                                          query, variables)
        except upwork_client.UpworkAuthError as exc:
            raise AccessRevoked(str(exc)) from exc
        except upwork_client.UpworkCallError as exc:
            raise AdapterError(str(exc)) from exc
        if status in (401, 403):
            raise AccessRevoked("Upwork rejected the account's access (expired token or missing permission).")
        if status == 429 or status >= 500:
            raise AdapterError(f"Upwork API returned {status}.")
        if status >= 400 or not isinstance(payload, dict):
            raise AdapterError(f"Upwork API returned {status}.", retryable=False)
        if payload.get("data") is None:
            errors = payload.get("errors") or []
            message = str((_first(errors) or {}).get("message", "unknown error"))[:200] if errors else "no data"
            raise AdapterError(f"Upwork rejected the query: {message}", retryable=False)
        return payload["data"]

    # ---- API ------------------------------------------------------------------
    async def identify(self, account: dict) -> AccountIdentity:
        data = await self._graphql(account, _IDENTIFY)
        user = data.get("user") or {}
        if not user.get("id"):
            raise AdapterError("Upwork did not return the account's user id.", retryable=False)
        return AccountIdentity(external_account_id=str(user["id"]), handle=str(user.get("nid") or user.get("name") or ""))

    def _from_offer(self, node: dict, status: OrderStatus | None) -> OrderSignal:
        terms = node.get("offerTerms") or {}
        amount, currency = _money((_first(terms.get("fixedPriceTerm")) or {}).get("budget"))
        pricing = "fixed" if amount is not None else None
        if amount is None:
            amount, currency = _money((_first(terms.get("hourlyTerms")) or {}).get("rate"))
            pricing = "hourly" if amount is not None else None
        kind = str(node.get("type") or "").lower()
        if kind in ("hourly", "fixedprice", "fixed_price"):
            pricing = "hourly" if kind == "hourly" else "fixed"
        client = node.get("client") or node.get("company") or {}
        milestones = []
        for m in node.get("milestones") or []:
            if not isinstance(m, dict) or not m.get("id"):
                continue
            m_amount, m_currency = _money(m.get("depositAmount"))
            milestones.append(Milestone(external_id=str(m["id"]), title=str(m.get("description") or "")[:200],
                                        amount=m_amount, currency=m_currency or currency,
                                        status=str(m.get("state") or ""), created_at=m.get("createdDateTime")))
        return OrderSignal(
            platform=self.platform, source=Source.API_SYNC, external_order_id=str(node["id"]), kind=Kind.CONTRACT,
            title=(node.get("title") or None), client_name=client.get("name"),
            client_id=str(client["id"]) if client.get("id") else None,
            amount=amount, currency=currency, pricing=pricing, status=status,
            created_at=node.get("offerCreatedDateTime") or node.get("startDateTime"),
            # No deep link: the reference doesn't document an offer URL format.
            updated_at=node.get("lastUpdatedDateTime"), milestones=milestones, authoritative=True,
        )

    async def _details(self, account: dict, ids: list[str]) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for start in range(0, len(ids), _DETAIL_BATCH):
            chunk = ids[start:start + _DETAIL_BATCH]
            # Aliased fields fetch several offers in one request; ids travel
            # as variables, never interpolated into the query text.
            params = ", ".join(f"$id{i}: ID!" for i in range(len(chunk)))
            body = "\n".join(f"o{i}: offer(id: $id{i}) {{ {_OFFER_FIELDS} }}" for i in range(len(chunk)))
            data = await self._graphql(account, f"query offers({params}) {{ {body} }}",
                                       {f"id{i}": value for i, value in enumerate(chunk)})
            for i, value in enumerate(chunk):
                node = data.get(f"o{i}")
                if isinstance(node, dict):
                    out[value] = node
        return out

    async def list_orders(self, account: dict) -> list[OrderSignal]:
        data = await self._graphql(account, _LIST)
        edges = (((data.get("user") or {}).get("offer") or {}).get("edges")) or []
        nodes = [e.get("node") for e in edges if isinstance(e, dict) and isinstance(e.get("node"), dict)]
        nodes = [n for n in nodes if n.get("id")]
        details = await self._details(account, [str(n["id"]) for n in nodes]) if nodes else {}
        signals = []
        for node in nodes:
            merged = {**node, **details.get(str(node["id"]), {})}
            # The list's lifecycle state is the current one; keep it over
            # the detail query's OfferState.
            status = _LIFECYCLE.get(str(node.get("state") or "").lower(), OrderStatus.UNKNOWN)
            merged["title"] = node.get("title") or merged.get("title")
            signals.append(self._from_offer(merged, status))
        return signals

    async def fetch_order(self, account: dict, external_order_id: str) -> OrderSignal | None:
        if not re.fullmatch(r"[A-Za-z0-9_~-]{1,64}", external_order_id or ""):
            return None
        node = (await self._details(account, [external_order_id])).get(external_order_id)
        if not node or not node.get("id"):
            return None
        state = str(node.get("state") or "").lower()
        return self._from_offer(node, _OFFER_STATE.get(state, OrderStatus.UNKNOWN))

    # ---- email ---------------------------------------------------------------
    def email_title(self, subject: str, body: str) -> str | None:
        # "Your contract has started: Build a dashboard" -> "Build a dashboard"
        tail = subject.split(":", 1)[1] if ":" in subject else subject
        return re.sub(r"\s+", " ", tail).strip().strip("\"'“”").strip()[:200] or None
