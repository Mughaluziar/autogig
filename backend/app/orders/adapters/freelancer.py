"""Freelancer.com — awarded projects read through the official REST API.

An order is a project awarded to the connected freelancer: the freelancer's
awarded bid supplies the amount and status, the project supplies the title,
client and currency, and milestones come from the milestones endpoint.

Sources (developers.freelancer.com):
  GET /users/0.1/self/                                   result.id
  GET /projects/0.1/bids/?bidders[]=&award_statuses[]=   award_status, frontend_bid_status,
                                                         complete_status, amount, time_awarded
  GET /projects/0.1/projects/{id}/                       owner_id, title, currency.code, status
  GET /projects/0.1/milestones/?bidders[]=&projects[]=   result.milestones keyed by id
Freelancer.com has no webhooks, so orders are polled.

Credentials: Nango has no Freelancer.com provider and per-user OAuth is not
built yet, so the only credential is the platform owner's
FREELANCER_OAUTH_TOKEN. Only owner users can connect it, as one account.
Production calls also need FREELANCER_API_APPROVED (written permission).
"""
import asyncio
import re
import time
from dataclasses import dataclass

import httpx

from ...config import get_settings
from ..models import Kind, Milestone, OrderSignal, OrderStatus, Source
from .base import AccessRevoked, AccountIdentity, AdapterError, EmailRule, OrderAdapter

_I = re.I
_API_BASE = "https://www.freelancer.com/api"
_SANDBOX_BASE = "https://www.freelancer-sandbox.com/api"
_LIST_LIMIT = 50


def _iso(ts) -> str | None:
    try:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(int(ts))) if ts else None
    except (TypeError, ValueError):
        return None


def _status(bid: dict, milestones: list[dict]) -> OrderStatus:
    award = str(bid.get("award_status") or "").lower()
    if award in ("revoked", "canceled", "cancelled", "rejected"):
        return OrderStatus.CANCELLED
    if any(str(m.get("status") or "").lower() == "disputed" for m in milestones):
        return OrderStatus.DISPUTED
    if str(bid.get("complete_status") or "").lower() == "complete" \
            or str(bid.get("frontend_bid_status") or "").lower() == "complete":
        return OrderStatus.COMPLETED
    if award == "awarded" and bid.get("time_accepted"):
        return OrderStatus.ACTIVE
    if award in ("awarded", "pending"):
        # Awarded by the client, not yet accepted by the freelancer.
        return OrderStatus.OFFER
    return OrderStatus.UNKNOWN


@dataclass
class FreelancerAdapter(OrderAdapter):
    key: str = "freelancer"
    platform: str = "Freelancer.com"
    email_domains: tuple[str, ...] = ("freelancer.com",)
    # Not a Nango provider: the transport is the platform owner's token.
    connection_kind: str = "platform_token"
    email_kind: Kind = Kind.PROJECT
    email_rules: tuple[EmailRule, ...] = (
        EmailRule(re.compile(r"\baward\b.*\b(?:revoked|cancel)", _I), OrderStatus.CANCELLED),
        EmailRule(re.compile(r"\bmilestone\b.*\b(?:released|paid)\b", _I), OrderStatus.ACTIVE),
        EmailRule(re.compile(r"\b(?:been |you(?:'|’)?ve been )?awarded\b", _I), OrderStatus.OFFER),
    )
    # Project links end in the numeric project id on some notification
    # formats; a wrong guess is caught by the title fallback in verify().
    order_id_pattern: re.Pattern = re.compile(r"freelancer\.com/projects/(?:[^\s/?#]+/)*?(\d{6,10})(?=[/?#\s]|$)", _I)
    limitations: tuple[str, ...] = (
        "Nango has no Freelancer.com provider and per-user OAuth isn't built yet, so only the platform "
        "owner's account (FREELANCER_OAUTH_TOKEN) can be connected, as a single account.",
        "Production calls need Freelancer.com's written API permission (FREELANCER_API_APPROVED).",
        "Freelancer.com has no webhooks, so orders are checked every 15 minutes.",
        "Bids carry no currency; the project's currency is used.",
    )

    def api_enabled(self, settings) -> bool:
        if not settings.freelancer_oauth_token:
            return False
        return bool(settings.freelancer_sandbox or settings.freelancer_api_approved)

    def environment_label(self, settings) -> str:
        # Sandbox orders are real API responses but not real work.
        return " (sandbox)" if settings.freelancer_sandbox else ""

    # ---- transport ----------------------------------------------------------
    async def _get(self, path: str, params: list[tuple[str, str]] | None = None) -> dict | None:
        """GET a Freelancer.com endpoint; None means 404."""
        settings = get_settings()
        if not self.api_enabled(settings):
            raise AdapterError("Freelancer.com API access is not approved in this environment.", retryable=False)
        base = _SANDBOX_BASE if settings.freelancer_sandbox else _API_BASE
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
                response = await client.get(f"{base}{path}", params=params,
                                            headers={"freelancer-oauth-v1": settings.freelancer_oauth_token})
        except httpx.HTTPError as exc:
            raise AdapterError("Could not reach the Freelancer.com API.") from exc
        if response.status_code == 404:
            return None
        if response.status_code in (401, 403):
            raise AccessRevoked("Freelancer.com rejected the API token or its scopes.")
        if response.status_code == 429 or response.status_code >= 500:
            raise AdapterError(f"Freelancer.com API returned {response.status_code}.")
        try:
            payload = response.json()
        except ValueError:
            raise AdapterError("Freelancer.com returned an unreadable response.")
        if response.status_code >= 400 or not isinstance(payload, dict) or payload.get("status") == "error":
            raise AdapterError(f"Freelancer.com API returned {response.status_code}.", retryable=False)
        result = payload.get("result")
        return result if isinstance(result, dict) else {}

    # ---- API ------------------------------------------------------------------
    async def identify(self, account: dict) -> AccountIdentity:
        result = await self._get("/users/0.1/self/")
        if not result or not result.get("id"):
            raise AdapterError("Freelancer.com did not return the account's user id.", retryable=False)
        return AccountIdentity(external_account_id=str(result["id"]), handle=str(result.get("username") or ""))

    async def _project(self, project_id: str) -> dict | None:
        return await self._get(f"/projects/0.1/projects/{project_id}/")

    async def _milestones(self, bidder_id: str, project_ids: list[str]) -> dict[str, list[dict]]:
        if not project_ids:
            return {}
        params = [("bidders[]", bidder_id)] + [("projects[]", pid) for pid in project_ids]
        result = await self._get("/projects/0.1/milestones/", params) or {}
        raw = result.get("milestones") or {}
        rows = raw.values() if isinstance(raw, dict) else raw
        grouped: dict[str, list[dict]] = {}
        for m in rows:
            if isinstance(m, dict) and str(m.get("bidder_id")) == bidder_id:
                grouped.setdefault(str(m.get("project_id")), []).append(m)
        return grouped

    def _signal(self, bid: dict, project: dict, milestones: list[dict]) -> OrderSignal:
        currency = (project.get("currency") or {}).get("code")
        seo = project.get("seo_url")
        return OrderSignal(
            platform=self.platform, source=Source.API_SYNC, external_order_id=str(bid["project_id"]),
            kind=Kind.PROJECT, title=project.get("title") or None,
            client_id=str(project.get("owner_id") or bid.get("project_owner_id") or "") or None,
            amount=float(bid["amount"]) if bid.get("amount") is not None else None, currency=currency,
            pricing=str(project.get("type") or "").lower() or None,
            status=_status(bid, milestones),
            created_at=_iso(bid.get("time_awarded")) or _iso(project.get("time_submitted")),
            updated_at=_iso(project.get("time_updated")),
            url=f"https://www.freelancer.com/projects/{seo}" if seo else None,
            account_external_id=str(bid.get("bidder_id")) if bid.get("bidder_id") is not None else None,
            milestones=[
                Milestone(external_id=str(m.get("transaction_id") or m.get("id")), title=str(m.get("reason") or "")[:200],
                          amount=float(m["amount"]) if m.get("amount") is not None else None,
                          currency=(m.get("currency") or {}).get("code") or currency,
                          status=str(m.get("status") or ""), created_at=_iso(m.get("time_created")))
                for m in milestones if m.get("transaction_id") or m.get("id")
            ],
            authoritative=True,
        )

    async def _bids(self, bidder_id: str, extra: list[tuple[str, str]]) -> list[dict]:
        params = [("bidders[]", bidder_id), ("limit", str(_LIST_LIMIT))] + extra
        for status in ("awarded", "pending", "revoked", "canceled"):
            params.append(("award_statuses[]", status))
        result = await self._get("/projects/0.1/bids/", params) or {}
        return [b for b in result.get("bids") or [] if isinstance(b, dict) and b.get("project_id")
                and str(b.get("bidder_id")) == bidder_id and b.get("award_status")]

    async def _build(self, account: dict, bids: list[dict]) -> list[OrderSignal]:
        bidder_id = str(account["external_account_id"])
        semaphore = asyncio.Semaphore(4)

        async def project(pid: str):
            async with semaphore:
                return pid, await self._project(pid)

        project_ids = list(dict.fromkeys(str(b["project_id"]) for b in bids))
        projects = dict(await asyncio.gather(*(project(pid) for pid in project_ids)))
        milestones = await self._milestones(bidder_id, project_ids)
        return [self._signal(b, projects[str(b["project_id"])], milestones.get(str(b["project_id"]), []))
                for b in bids if projects.get(str(b["project_id"]))]

    async def list_orders(self, account: dict) -> list[OrderSignal]:
        if not account.get("external_account_id"):
            raise AdapterError("The Freelancer.com account id is unknown; reconnect the account.", retryable=False)
        return await self._build(account, await self._bids(str(account["external_account_id"]), []))

    async def fetch_order(self, account: dict, external_order_id: str) -> OrderSignal | None:
        if not re.fullmatch(r"\d{1,12}", external_order_id or "") or not account.get("external_account_id"):
            return None
        bids = await self._bids(str(account["external_account_id"]), [("projects[]", external_order_id)])
        # The project must exist AND carry this account's award.
        signals = await self._build(account, bids[:1])
        return signals[0] if signals else None

    # ---- email ---------------------------------------------------------------
    def email_title(self, subject: str, body: str) -> str | None:
        match = re.search(r"project\s+[\"“']?(.+?)[\"”']?\s*$", subject, _I)
        return (match.group(1).strip() if match else super().email_title(subject, body)) or None
