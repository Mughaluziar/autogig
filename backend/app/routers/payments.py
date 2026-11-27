"""Invoice pay links — clients pay invoices and milestones online.

Signed in (the invoice owner):
  POST   /api/pay-links                create or refresh one invoice's link
                                       (`reopen` re-opens refunded milestones)
  GET    /api/pay-links                the caller's links, with paid, refund
                                       and dispute status
  DELETE /api/pay-links/{invoice_id}   withdraw a link (invoice deleted)
  POST   /api/pay-links/{invoice_id}/send   email the link to the client

Platform owner only:
  GET /api/payments/stripe/readiness?probe=false|true   config checks, and
                                       with probe=true Stripe's account and
                                       webhook endpoint (payments/readiness.py)
  GET /api/payments/stripe/events      recent webhook deliveries (events.py)

Public (no session; the token is the credential):
  GET  /api/pay/{token}                what the pay page shows
  POST /api/pay/{token}/checkout       {method, milestoneId?} -> {url}
  POST /api/payments/stripe/webhook    Stripe-signed events (plan and credit-pack
                                       events go to routers/billing.py)

The amount charged always comes from the stored snapshot, never from the
request. A milestone counts as paid only when Stripe's signed webhook says
so, or when the owner marks it paid by hand. Refunds and disputes follow the
rules in payments/reversals.py. See docs/payments.md.
"""
import html
import json
import logging
import re
import secrets
import time
from collections import defaultdict, deque
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

from .. import db, email as mail, repo
from ..auth import current_user, require_owner
from ..config import get_settings
from ..payments import events, readiness, reversals, store
from ..payments import stripe_api
from . import billing

log = logging.getLogger("autopilot.payments")

router = APIRouter(tags=["payments"])
public_router = APIRouter(tags=["payments"])

Method = Literal["debit", "credit", "crypto"]
METHOD_ORDER = ("debit", "credit", "crypto")
METHOD_LABEL = {"debit": "debit card", "credit": "credit card", "crypto": "crypto (USDC)", "manual": "marked paid by hand"}
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MAX_WEBHOOK_BYTES = 256 * 1024
# Each checkout creates a Stripe session; cap how fast one link can do that.
_CHECKOUT_WINDOW = 600.0
_CHECKOUT_MAX = 10
_checkout_hits: dict[str, deque] = defaultdict(deque)
# Emailing a link: per invoice and per owner, so the feature can't be used to spam.
_SEND_WINDOW = 3600.0
_SEND_MAX_PER_INVOICE = 5
_SEND_MAX_PER_USER = 30
_send_hits: dict[str, deque] = defaultdict(deque)
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _cents(amount: float) -> int:
    return int((Decimal(str(amount)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def _iso_day(value) -> str | None:
    return value.strftime("%Y-%m-%d") if value else None


# --------------------------------------------------------------------------- #
# Views
# --------------------------------------------------------------------------- #
def _dispute_view(d: dict | None) -> dict | None:
    if not d:
        return None
    return {
        "status": d.get("status") or "", "reason": d.get("reason") or "", "amount": (d.get("amount_cents") or 0) / 100,
        "openedOn": _iso_day(d.get("opened_at")), "respondBy": _iso_day(d.get("respond_by")),
        "closedOn": _iso_day(d.get("closed_at")),
    }


def _milestone_view(m: dict, *, owner: bool = False) -> dict:
    view = {
        "id": m["id"], "title": m["title"], "amount": m["amount_cents"] / 100, "due": m.get("due") or "",
        "status": m["status"], "paidOn": _iso_day(m.get("paid_at")), "paidVia": m.get("paid_via"),
        "refunded": (m.get("refunded_cents") or 0) / 100, "refundedOn": _iso_day(m.get("refunded_at")),
    }
    dispute = m.get("dispute") or None
    if owner:
        view["dispute"] = _dispute_view(dispute)
    else:
        # The payer opened it; the page only says the payment is under review, nothing of the owner's side.
        view["disputed"] = bool(dispute and dispute.get("status") not in reversals.CLOSED_DISPUTE)
    return view


def _totals(link: dict) -> dict:
    """A refunded milestone counts as unpaid (it's in `remaining`); a partial refund leaves its milestone paid.
    `refunded` is what went back to the client on the milestones."""
    total = sum(m["amount_cents"] for m in link["milestones"])
    paid = sum(m["amount_cents"] for m in link["milestones"] if m["status"] == "paid")
    refunded = sum(m.get("refunded_cents") or 0 for m in link["milestones"])
    return {"total": total / 100, "paid": paid / 100, "remaining": (total - paid) / 100, "refunded": refunded / 100}


def _owner_view(link: dict) -> dict:
    return {
        "invoiceId": link["invoice_id"], "token": link["token"], "active": link.get("active", True),
        "methods": link["methods"], "milestones": [_milestone_view(m, owner=True) for m in link["milestones"]],
        # Duplicates the client is still owed back; refunded ones and retired refunded payments don't count.
        "extraPayments": sum(1 for p in link.get("extra_payments") or [] if reversals.holds_money(p)), **_totals(link),
    }


def _breakdown_view(link: dict) -> dict:
    """Line items, discount and tax as printed on the invoice. Display only:
    what a client pays is always the milestones."""
    items = [
        {"description": i["description"], "quantity": i["quantity"], "unitPrice": i["unit_cents"] / 100,
         "amount": i["amount_cents"] / 100}
        for i in link.get("line_items") or []
    ]
    return {
        "lineItems": items,
        "subtotal": (link["subtotal_cents"] / 100) if link.get("subtotal_cents") is not None else None,
        "discount": (link.get("discount_cents") or 0) / 100,
        "taxRate": link.get("tax_rate") or 0,
        "tax": (link.get("tax_cents") or 0) / 100,
        "notes": link.get("notes") or "", "issued": link.get("issued") or "", "due": link.get("due") or "",
    }


def _public_view(link: dict) -> dict:
    settings = get_settings()
    # No user id, owner email or internal invoice id: only what's on the invoice.
    return {
        "business": link.get("business") or "", "number": link.get("number") or "",
        "client": link.get("client") or "", "description": link.get("description") or "",
        "currency": "usd", "methods": link["methods"],
        "live": stripe_api.configured(settings), "cryptoLive": stripe_api.crypto_enabled(settings),
        "milestones": [_milestone_view(m) for m in link["milestones"]], **_totals(link),
        **_breakdown_view(link),
    }


# --------------------------------------------------------------------------- #
# Owner routes
# --------------------------------------------------------------------------- #
class MilestoneIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=200)
    # Stripe's ceiling for a single USD card payment.
    amount: float = Field(gt=0, le=999_999.99)
    due: str = Field(default="", max_length=10)
    paidManually: bool = False

    @field_validator("due")
    @classmethod
    def _date(cls, v: str) -> str:
        if v and not _DATE_RE.match(v):
            raise ValueError("due must be YYYY-MM-DD")
        return v


class LineItemIn(BaseModel):
    description: str = Field(min_length=1, max_length=300)
    quantity: float = Field(gt=0, le=100_000)
    unitPrice: float = Field(ge=0, le=999_999.99)


class PayLinkIn(BaseModel):
    invoiceId: str = Field(min_length=1, max_length=64)
    number: str = Field(default="", max_length=40)
    client: str = Field(default="", max_length=200)
    description: str = Field(default="", max_length=1000)
    business: str = Field(default="", max_length=120)
    currency: str = "usd"
    methods: list[Method] = Field(min_length=1, max_length=3)
    milestones: list[MilestoneIn] = Field(min_length=1, max_length=24)
    # Optional printed breakdown. When line items are sent, the milestones
    # must add up to subtotal - discount + tax.
    lineItems: list[LineItemIn] = Field(default_factory=list, max_length=50)
    discount: float = Field(default=0, ge=0, le=9_999_999.99)
    taxRate: float = Field(default=0, ge=0, le=100)
    notes: str = Field(default="", max_length=2000)
    issued: str = Field(default="", max_length=10)
    due: str = Field(default="", max_length=10)
    # Refunded milestones (full refund or lost dispute) the owner opens for payment again.
    reopen: list[str] = Field(default_factory=list, max_length=24)

    @field_validator("reopen")
    @classmethod
    def _ids(cls, v: list[str]) -> list[str]:
        if any(not 0 < len(i) <= 64 for i in v):
            raise ValueError("reopen lists milestone ids")
        return v

    @field_validator("issued", "due")
    @classmethod
    def _dates(cls, v: str) -> str:
        if v and not _DATE_RE.match(v):
            raise ValueError("dates must be YYYY-MM-DD")
        return v

    @field_validator("currency")
    @classmethod
    def _usd(cls, v: str) -> str:
        if v.strip().lower() != "usd":
            raise ValueError("only USD invoices can be paid online")
        return "usd"

    @field_validator("milestones")
    @classmethod
    def _unique(cls, v: list[MilestoneIn]) -> list[MilestoneIn]:
        if len({m.id for m in v}) != len(v):
            raise ValueError("milestone ids must be unique")
        return v


def _merge_milestones(existing: list[dict] | None, incoming: list[MilestoneIn],
                      reopen: set[str] | frozenset = frozenset()) -> tuple[list[dict], list[dict]]:
    """New snapshot, keeping what's already been paid. A milestone paid
    online can't change amount or disappear; one marked paid by hand follows
    the owner's latest choice. A refunded one (full refund or lost dispute)
    stays refunded, so the client can't pay it online, until the owner
    re-opens it (`reopen`), marks it paid by hand or removes it; its refunded
    payment then moves to extra_payments. Returns (milestones, those payments)."""
    prev = {m["id"]: m for m in existing or []}
    out, retired = [], []
    for m in incoming:
        cents = _cents(m.amount)
        old = prev.get(m.id)
        if old and old["status"] == "paid" and old.get("paid_via") != "manual":
            if old["amount_cents"] != cents:
                raise HTTPException(409, f"“{old['title']}” was already paid online, so its amount can't change.")
            out.append(old)
            continue
        if old and old["status"] == "refunded":
            if not m.paidManually and m.id not in reopen:
                if old["amount_cents"] != cents:
                    raise HTTPException(409, f"“{old['title']}” was refunded. Re-open it before changing its amount.")
                out.append(old)
                continue
            retired.append(reversals.retire(old, "paid_by_hand" if m.paidManually else "reopened"))
            old = None
        entry = {"id": m.id, "title": m.title.strip() or "Payment", "amount_cents": cents, "due": m.due}
        if m.paidManually:
            already = old is not None and old["status"] == "paid"
            entry.update(status="paid", paid_via="manual", paid_at=old.get("paid_at") if already else store.now())
        else:
            entry.update(status="due", paid_via=None, paid_at=None)
        out.append(entry)
    kept = {m.id for m in incoming}
    for mid, old in prev.items():
        if mid in kept:
            continue
        if old["status"] == "paid" and old.get("paid_via") != "manual":
            raise HTTPException(409, f"“{old['title']}” was already paid online, so it can't be removed.")
        if old["status"] == "refunded":
            retired.append(reversals.retire(old, "removed"))
    return out, retired


def _breakdown(body: PayLinkIn) -> dict:
    """Store the printed breakdown in cents and check it matches what the
    client will actually be charged (the milestones), to the cent per line."""
    if not body.lineItems:
        return {"line_items": [], "subtotal_cents": None, "discount_cents": 0, "tax_rate": 0, "tax_cents": 0}
    items = []
    for i in body.lineItems:
        unit = _cents(i.unitPrice)
        qty = float(Decimal(str(i.quantity)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        amount = int((Decimal(unit) * Decimal(str(qty))).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        items.append({"description": i.description.strip(), "quantity": qty, "unit_cents": unit, "amount_cents": amount})
    subtotal = sum(i["amount_cents"] for i in items)
    discount = _cents(body.discount)
    if discount > subtotal:
        raise HTTPException(422, "The discount can't be more than the subtotal.")
    rate = float(Decimal(str(body.taxRate)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))
    tax = int((Decimal(subtotal - discount) * Decimal(str(rate)) / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    total = subtotal - discount + tax
    charged = sum(_cents(m.amount) for m in body.milestones)
    # Browsers round each step in floating point; allow a cent of drift per line.
    if abs(charged - total) > max(2, len(items) + 2):
        raise HTTPException(422, f"The payments add up to {_money(charged)}, but the invoice total is {_money(total)}.")
    return {"line_items": items, "subtotal_cents": subtotal, "discount_cents": discount, "tax_rate": rate, "tax_cents": tax}


async def _business_name(user: dict) -> str:
    doc = await db.find_user(user["email"]) or {}
    return (doc.get("company") or doc.get("name") or "").strip()[:120]


@router.post("/pay-links")
async def upsert_pay_link(body: PayLinkIn, user: dict = Depends(current_user)):
    business = body.business.strip() or await _business_name(user)
    methods = [m for m in METHOD_ORDER if m in body.methods]
    breakdown = _breakdown(body)
    # Retry on a version clash: the webhook may mark a milestone paid between
    # our read and write.
    for _ in range(3):
        existing = await store.get_for_invoice(user["id"], body.invoiceId)
        milestones, retired = _merge_milestones(existing["milestones"] if existing else None, body.milestones,
                                                set(body.reopen))
        fields = {
            "number": body.number.strip(), "client": body.client.strip(),
            "description": body.description.strip(), "business": business, "currency": "usd",
            "methods": methods, "active": True, "milestones": milestones,
            "notes": body.notes.strip(), "issued": body.issued, "due": body.due, **breakdown,
        }
        if retired:
            fields["extra_payments"] = (existing.get("extra_payments") or []) + retired
        if existing:
            link = await store.update(user["id"], existing["id"], fields, expect_version=existing["version"])
            for r in retired if link else []:
                if r["retired"] == "reopened":
                    title = next((m["title"] for m in milestones if m["id"] == r["milestone_id"]), "a payment")
                    await repo.log_activity(user["id"], "Payments",
                                            f"Re-opened “{title}” on {fields['number'] or 'an invoice'} for payment after a refund")
        else:
            link = await store.insert({**fields, "user_id": user["id"], "invoice_id": body.invoiceId,
                                       "token": secrets.token_urlsafe(16)})
            if link:
                await repo.log_activity(user["id"], "Payments", f"Created a pay link for {fields['number'] or 'an invoice'}")
        if link:
            return _owner_view(link)
    raise HTTPException(409, "The invoice changed while saving. Try again.")


@router.get("/pay-links")
async def list_pay_links(user: dict = Depends(current_user)):
    settings = get_settings()
    links = await store.list_for_user(user["id"])
    return {
        "live": stripe_api.configured(settings), "cryptoLive": stripe_api.crypto_enabled(settings),
        "links": [_owner_view(link) for link in links if link.get("active", True)],
    }


class SendIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    message: str = Field(default="", max_length=1000)


def _send_allowed(user_id: str, invoice_id: str) -> bool:
    now = time.monotonic()
    keys = ((f"u:{user_id}", _SEND_MAX_PER_USER), (f"i:{user_id}:{invoice_id}", _SEND_MAX_PER_INVOICE))
    for key, _ in keys:
        hits = _send_hits[key]
        while hits and now - hits[0] > _SEND_WINDOW:
            hits.popleft()
    if any(len(_send_hits[key]) >= cap for key, cap in keys):
        return False
    for key, _ in keys:
        _send_hits[key].append(now)
    return True


def _invoice_email(link: dict, message: str) -> tuple[str, str]:
    e = html.escape
    business = link.get("business") or "Your freelancer"
    number = link.get("number") or "your invoice"
    due = [m for m in link["milestones"] if m["status"] == "due"]
    owed = sum(m["amount_cents"] for m in due)
    url = f"{get_settings().site_url}/pay/{link['token']}"
    rows = "".join(
        f"<tr><td style='padding:4px 0'>{e(m['title'])}</td>"
        f"<td style='padding:4px 0;text-align:right'>{_money(m['amount_cents'])}"
        f"{' · paid' if m['status'] == 'paid' else ' · refunded' if m['status'] == 'refunded' else ''}</td></tr>"
        for m in link["milestones"]
    )
    note = f"<p style='white-space:pre-line'>{e(message)}</p>" if message.strip() else ""
    methods = ", ".join(METHOD_LABEL[m] for m in link["methods"])
    body = f"""
{note}
<p><b>{e(business)}</b> sent you invoice <b>{e(number)}</b>. Amount due: <b>{_money(owed)}</b>.</p>
<table style="width:100%;font-size:13px;border-collapse:collapse">{rows}</table>
<p style="margin:24px 0">
  <a href="{e(url)}" style="background:#8b5cf6;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">
    View and pay invoice</a>
</p>
<p style="font-size:12px;color:#9ca3af">Pay by {e(methods)}. No account needed.
Payments are processed by Stripe; Autopilot never sees your card number or wallet keys.</p>"""
    return f"Invoice {number} from {business}", mail._wrap(f"Invoice {e(number)}", body)


@router.post("/pay-links/{invoice_id}/send")
async def send_pay_link(invoice_id: str, body: SendIn, user: dict = Depends(current_user)):
    address = body.email.strip().lower()
    if not _EMAIL_RE.match(address):
        raise HTTPException(422, "Enter a valid email address.")
    link = await store.get_for_invoice(user["id"], invoice_id[:64])
    if not link or not link.get("active", True):
        raise HTTPException(404, "Create a pay link for this invoice first.")
    if not mail.enabled():
        raise HTTPException(503, "Email sending isn't set up on this server. Copy the link and send it yourself.")
    if not _send_allowed(user["id"], link["invoice_id"]):
        raise HTTPException(429, "You've emailed this invoice a lot in the last hour. Try again later.")
    subject, html_body = _invoice_email(link, body.message)
    if not await mail.send_email(address, subject, html_body):
        raise HTTPException(502, "The email provider didn't accept the message. Try again, or copy the link.")
    await repo.log_activity(user["id"], "Payments", f"Emailed {link.get('number') or 'an invoice'} to the client")
    return {"sent": True, "to": address}


@router.delete("/pay-links/{invoice_id}")
async def withdraw_pay_link(invoice_id: str, user: dict = Depends(current_user)):
    if not await store.deactivate(user["id"], invoice_id[:64]):
        raise HTTPException(404, "No pay link for this invoice.")
    return {"withdrawn": True}


# --------------------------------------------------------------------------- #
# Public routes
# --------------------------------------------------------------------------- #
async def _active_link(token: str) -> dict:
    link = await store.get_by_token(token) if _TOKEN_RE.match(token) else None
    if not link or not link.get("active", True):
        raise HTTPException(404, "This payment link isn't valid or has been withdrawn.")
    return link


@public_router.get("/pay/{token}")
async def get_pay_page(token: str):
    return _public_view(await _active_link(token))


class CheckoutIn(BaseModel):
    method: Method
    milestoneId: str | None = Field(default=None, max_length=64)


def _checkout_allowed(token: str) -> bool:
    now = time.monotonic()
    hits = _checkout_hits[token]
    while hits and now - hits[0] > _CHECKOUT_WINDOW:
        hits.popleft()
    if len(hits) >= _CHECKOUT_MAX:
        return False
    hits.append(now)
    return True


@public_router.post("/pay/{token}/checkout")
async def start_checkout(token: str, body: CheckoutIn):
    link = await _active_link(token)
    settings = get_settings()
    who = link.get("business") or "the sender"
    if body.method not in link["methods"]:
        raise HTTPException(400, f"This invoice doesn't accept payment by {METHOD_LABEL[body.method]}.")
    if body.milestoneId:
        milestone = next((m for m in link["milestones"] if m["id"] == body.milestoneId), None)
        if not milestone:
            raise HTTPException(404, "That payment isn't on this invoice.")
        if milestone["status"] == "paid":
            raise HTTPException(409, f"“{milestone['title']}” is already paid.")
        if milestone["status"] == "refunded":
            raise HTTPException(409, f"“{milestone['title']}” was refunded and can't be paid online right now. Contact {who}.")
    else:
        milestone = next((m for m in link["milestones"] if m["status"] == "due"), None)
        if not milestone:
            if any(m["status"] == "refunded" for m in link["milestones"]):
                raise HTTPException(409, f"Nothing on this invoice can be paid online right now. Contact {who}.")
            raise HTTPException(409, "This invoice is already paid in full.")
    if not stripe_api.configured(settings):
        raise HTTPException(503, f"Online payment isn't switched on yet, so nothing was charged. Contact {who} to pay another way.")
    if body.method == "crypto" and not stripe_api.crypto_enabled(settings):
        raise HTTPException(503, f"Crypto payments aren't switched on yet, so nothing was charged. Pay by card, or contact {who}.")
    if not _checkout_allowed(token):
        raise HTTPException(429, "Too many payment attempts. Wait a few minutes and try again.")
    name = " · ".join(p for p in (link.get("business"), link.get("number"), milestone["title"]) if p)
    page = f"{settings.site_url}/pay/{token}"
    try:
        session = await stripe_api.create_checkout_session(
            settings, amount_cents=milestone["amount_cents"], name=name or "Invoice payment", method=body.method,
            metadata={"pay_token": token, "milestone_id": milestone["id"], "method": body.method, "link_id": link["id"]},
            success_url=f"{page}?status=success", cancel_url=f"{page}?status=cancelled",
            client_reference_id=link["id"],
        )
    except stripe_api.StripeError:
        raise HTTPException(502, "The payment provider didn't respond, so nothing was charged. Try again in a moment.")
    return {"url": session["url"]}


@public_router.post("/payments/stripe/webhook")
async def stripe_webhook(request: Request):
    """Stripe events, authenticated by the Stripe-Signature header. Only
    payments created by a pay link (metadata pay_token) count. Every event
    with an id goes through the event log (payments/events.py): a repeated
    id is answered as a duplicate without running anything again, unless the
    earlier attempt failed. A handler error returns 500 so Stripe retries."""
    settings = get_settings()
    secret = settings.stripe_webhook_secret
    if not secret:
        raise HTTPException(503, "Stripe webhook signing secret is not configured.")
    raw = await request.body()
    if len(raw) > _MAX_WEBHOOK_BYTES:
        raise HTTPException(413, "Webhook payload too large.")
    if not stripe_api.verify_signature(raw, request.headers.get("stripe-signature", ""), secret):
        raise HTTPException(400, "Invalid Stripe signature.")
    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Webhook body is not JSON.")
    if not isinstance(event, dict):
        return {"received": True}
    event_id = str(event.get("id") or "")
    if event_id and not await events.claim(event):
        return {"received": True, "duplicate": True}
    try:
        result = await _handle_event(event)
    except Exception:
        if event_id:
            await events.finish(event_id, "error")
        raise
    if event_id:
        await events.finish(event_id, events.outcome_of(result))
    return result


PAY_LINK_EVENTS = ("checkout.session.completed", "checkout.session.async_payment_succeeded", "charge.refunded",
                   "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed")


async def _handle_event(event: dict) -> dict:
    # Plan subscriptions and credit packs (routers/billing.py).
    handled = await billing.handle_stripe_event(event)
    if handled is not None:
        return handled
    etype = event.get("type")
    obj = (event.get("data") or {}).get("object") or {}
    if etype not in PAY_LINK_EVENTS or not isinstance(obj, dict):
        return {"received": True}
    if etype == "charge.refunded":
        return await _charge_refunded(obj)
    if etype.startswith("charge.dispute."):
        return await _dispute_changed(obj)
    return await _session_paid(obj)


def _label(link: dict, title: str) -> str:
    return f"{link.get('number') or 'invoice'} · {title}"


async def _session_paid(session: dict) -> dict:
    """checkout.session.completed / async_payment_succeeded for a pay link.
    A second payment for a paid milestone is kept for the owner to refund."""
    settings = get_settings()
    if session.get("payment_status") != "paid":
        # Async methods (crypto) settle later: async_payment_succeeded follows.
        return {"received": True, "pending": True}
    meta = session.get("metadata") or {}
    token, milestone_id = str(meta.get("pay_token") or ""), str(meta.get("milestone_id") or "")
    link = await store.get_by_token(token) if token and _TOKEN_RE.match(token) else None
    milestone = next((m for m in (link or {}).get("milestones", []) if m["id"] == milestone_id), None)
    if not link or not milestone:
        return {"received": True}

    session_id = str(session.get("id") or "")
    payment_intent = str(session.get("payment_intent") or "")[:255] or None
    amount = session.get("amount_total")
    if session.get("currency") != "usd" or not isinstance(amount, int) or amount < milestone["amount_cents"]:
        log.warning("pay link %s: session %s amount %s doesn't cover milestone", link["id"], session_id, amount)
        await repo.notify(link["user_id"], "Payment needs review",
                          f"A payment for {link.get('number') or 'an invoice'} · {milestone['title']} didn't match the amount due. Check it in Stripe.",
                          kind="warning")
        return {"received": True, "rejected": "amount"}

    requested = str(meta.get("method") or "")
    via = await stripe_api.payment_method_kind(settings, payment_intent or "")
    via = via or (requested if requested in METHOD_ORDER else "credit")
    updated = await store.mark_milestone_paid(token, milestone_id, {
        "paid_via": via, "paid_at": store.now(), "session_id": session_id, "amount_paid_cents": amount,
        "payment_intent": payment_intent, "refunded_cents": 0, "refunded_at": None, "dispute": None,
    })
    label = _label(link, milestone["title"])
    if updated:
        await repo.notify(link["user_id"], "Payment received",
                          f"{link.get('client') or 'Your client'} paid {_money(amount)} for {label} by {METHOD_LABEL[via]}.")
        await repo.log_activity(link["user_id"], "Payments", f"Received {_money(amount)} for {label} by {METHOD_LABEL[via]} (Stripe)")
        return {"received": True, "paid": True}

    # Not due any more: a replay of the same session, or a second payment.
    current = await store.get_by_token(token) or link
    now_milestone = next((m for m in current["milestones"] if m["id"] == milestone_id), milestone)
    seen = {p.get("session_id") for p in current.get("extra_payments") or []}
    if now_milestone.get("session_id") == session_id or session_id in seen:
        return {"received": True, "paid": False, "duplicate": True}
    await store.add_extra_payment(token, {
        "milestone_id": milestone_id, "session_id": session_id, "payment_intent": payment_intent,
        "amount_cents": amount, "via": via, "at": store.now(),
    })
    if now_milestone["status"] == "refunded":
        await repo.notify(link["user_id"], "Payment for a refunded part",
                          f"A payment of {_money(amount)} arrived for {label}, which was refunded and isn't open for payment. "
                          "Refund it from Stripe, or keep it and mark the part paid by hand.", kind="warning")
    else:
        await repo.notify(link["user_id"], "Duplicate payment",
                          f"A second payment of {_money(amount)} arrived for {label}, which was already paid. Refund it from Stripe if it's a duplicate.",
                          kind="warning")
    return {"received": True, "paid": False, "extra": True}


async def _change_link(link: dict, change) -> tuple[dict | None, dict]:
    """Apply a pure change (payments/reversals.py) with compare-and-set,
    re-reading on a clash: the owner may refresh the link, or another event
    land, at the same moment."""
    for _ in range(5):
        fields, info = change(link)
        if fields is None:
            return None, info
        updated = await store.update(link["user_id"], link["id"], fields, expect_version=link["version"])
        if updated:
            return updated, info
        link = await store.get_by_token(link["token"])
        if not link:
            return None, {"result": "ignored"}
    raise RuntimeError("pay link kept changing while applying a Stripe event")  # 500: Stripe retries


async def _payment_for(payment_intent: str, meta: dict | None = None) -> tuple[dict, str] | None:
    """The pay link holding the payment made with this PaymentIntent, and the
    milestone id to fall back on for a payment stored before PaymentIntent ids
    were. A charge carries its PaymentIntent's metadata (pay_token,
    milestone_id); a dispute only names the PaymentIntent."""
    meta = meta or {}
    token, milestone_id = str(meta.get("pay_token") or ""), str(meta.get("milestone_id") or "")[:64]
    if token and _TOKEN_RE.match(token):
        link = await store.get_by_token(token)
        if link and reversals.locate(link, payment_intent, milestone_id):
            return link, milestone_id
    link = await store.find_by_payment_intent(payment_intent)
    return (link, "") if link and reversals.locate(link, payment_intent) else None


def _on_payment(payment_intent: str, hint: str, apply):
    """A change for _change_link: find the payment again on each (re-)read,
    since the owner may have moved it (re-opening a refunded milestone)."""
    def change(link: dict):
        where = reversals.locate(link, payment_intent, hint)
        return apply(link, where) if where else (None, {"result": "ignored"})
    return change


async def _charge_refunded(charge: dict) -> dict:
    """A refund (partial or full) of a pay-link payment, from Stripe's
    cumulative amount_refunded. Full refund: the milestone becomes refunded
    (unpaid, not payable online until the owner re-opens it)."""
    payment_intent = str(charge.get("payment_intent") or "")[:255]
    amount, refunded = charge.get("amount"), charge.get("amount_refunded")
    if not payment_intent or not isinstance(amount, int) or not isinstance(refunded, int) or refunded <= 0:
        return {"received": True}
    found = await _payment_for(payment_intent, charge.get("metadata") or {})
    if not found:
        return {"received": True}
    link, hint = found
    full = bool(charge.get("refunded")) or refunded >= amount
    stamp = store.now()
    updated, info = await _change_link(link, _on_payment(payment_intent, hint, lambda l, where: reversals.refund(
        l, where, payment_intent, refunded_cents=refunded, full=full, at=stamp)))
    if not updated:
        return {"received": True, "duplicate": info.get("result") == "duplicate"}
    label = _label(link, info["title"])
    who = link.get("client") or "the client"
    if info["kind"] == "extra":
        title, body = "Duplicate payment refunded", f"{_money(info['delta_cents'])} of the extra payment for {label} went back to {who}."
    elif info["became_refunded"]:
        title = "Payment refunded"
        body = (f"{label} was refunded in full ({_money(info['total_cents'])} back to {who}). It counts as unpaid again; "
                "your client can't pay it online until you re-open it on the invoice.")
    else:
        title = "Partial refund"
        body = (f"{_money(info['delta_cents'])} of {label} went back to {who} ({_money(info['total_cents'])} of "
                f"{_money(info['paid_cents'])} refunded so far). The part stays paid.")
    await repo.notify(link["user_id"], title, body, kind="warning")
    await repo.log_activity(link["user_id"], "Payments", f"Refunded {_money(info['delta_cents'])} for {label} (Stripe)")
    return {"received": True, "refunded": info["delta_cents"]}


_DISPUTE_REASON = {
    "fraudulent": "the cardholder says they didn't make it", "duplicate": "charged twice",
    "product_not_received": "work not received", "product_unacceptable": "work not as described",
    "subscription_canceled": "cancelled", "unrecognized": "the cardholder doesn't recognize it",
    "credit_not_processed": "a refund they expected",
}


async def _dispute_changed(dispute: dict) -> dict:
    """charge.dispute.created / updated / closed for a pay-link payment. The
    owner is told when a dispute opens and when it closes; a lost dispute
    counts as a full refund."""
    payment_intent = str(dispute.get("payment_intent") or "")[:255]
    found = await _payment_for(payment_intent) if payment_intent else None
    if not found:
        return {"received": True}
    link, hint = found
    stamp = store.now()
    updated, info = await _change_link(link, _on_payment(payment_intent, hint, lambda l, where: reversals.dispute(
        l, where, payment_intent, dispute, at=stamp)))
    if not updated:
        return {"received": True, "duplicate": info.get("result") == "duplicate"}
    label, amount, stage = _label(link, info["title"]), _money(info["amount_cents"]), info["stage"]
    reason = _DISPUTE_REASON.get(info["reason"], info["reason"].replace("_", " ") or "no reason given")
    if stage == "opened":
        due = info["respond_by"]
        by = f" by {due:%b} {due.day}, {due.year}" if due else ""
        await repo.notify(link["user_id"], "Payment disputed",
                          f"{link.get('client') or 'Your client'}'s bank disputed {amount} for {label} ({reason}). "
                          f"Respond with evidence in your Stripe Dashboard{by}, or the money goes back to them.", kind="warning")
    elif stage == "won":
        await repo.notify(link["user_id"], "Dispute won", f"The dispute over {amount} for {label} closed in your favour. The payment stays paid.")
    elif stage == "lost":
        again = " It counts as unpaid again; re-open it on the invoice to ask for payment again." if info["became_refunded"] else ""
        await repo.notify(link["user_id"], "Dispute lost",
                          f"The dispute over {amount} for {label} was lost and the money went back to the client.{again}",
                          kind="warning")
    elif stage == "closed":
        await repo.notify(link["user_id"], "Payment inquiry closed", f"The bank's inquiry about {label} closed without a dispute. Nothing changed.")
    await repo.log_activity(link["user_id"], "Payments", f"Dispute on {label}: {info['status'].replace('_', ' ')} (Stripe)")
    return {"received": True, "dispute": info["status"]}


# --------------------------------------------------------------------------- #
# Platform owner: Stripe readiness and the webhook event log
# --------------------------------------------------------------------------- #
@router.get("/payments/stripe/readiness")
async def stripe_readiness(probe: bool = False, owner: dict = Depends(require_owner)):
    """Config checks, and with probe=true live read-only calls to Stripe.
    Never returns a secret (keys show as prefix and last four)."""
    return await readiness.report(get_settings(), probe_stripe=probe)


@router.get("/payments/stripe/events")
async def stripe_events(limit: int = Query(50, ge=1, le=200), owner: dict = Depends(require_owner)):
    """Recent webhook deliveries: type, outcome and Stripe object ids only."""
    return {"events": await events.recent(limit)}
