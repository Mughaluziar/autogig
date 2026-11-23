"""Billing — plan, credits and purchases, owned by the server.

Real checkout goes through Stripe when STRIPE_SECRET_KEY is set: plans are
subscriptions with a free trial (one per account), credit packs are one-off
payments, and the signed webhook (routers/payments.py forwards it here) is
what actually changes the plan or adds credits. The browser never does.

GET  /api/user-monetization      -> {plan, bidCredits, profileCredits, purchases}
GET  /api/billing-history        -> purchases, newest first
GET  /api/billing/checkout-config -> what the checkout page can offer right now (plans and packs
                                 described for the caller's account type)
GET  /api/billing/receipts/{id}  -> a receipt for one of the caller's purchases
POST /api/billing/checkout       {plan: "plus"|"pro"} or {pack: "bids"|"profiles", method?}
                                 -> {url} of Stripe's hosted checkout; 503 when Stripe isn't set up
POST /api/billing/portal         -> {url} of Stripe's billing portal (card, invoices, cancel)
POST /api/billing/subscription/cancel {cancel: bool} -> cancel or resume at period end
POST /api/billing/spend          {kind: "profile"} -> spend one profile credit;
                                 402 when none are left (Pro is unlimited)

Without Stripe, outside production, /billing/credits and /billing/upgrade
simulate a purchase (status "Simulated", no money moves) so the app can be
tried end to end. They're refused once Stripe is configured (use checkout)
and in production (no free upgrades by API call).

Bid credits are spent by the server itself when a real bid goes out (see
routers/freelancer.py and routers/automation.py, and for freelancer accounts their
bids in the freelancer pool, pool/credits.py), never by the browser.

Account types: the plans are the same for everyone, but a freelancer account uses
them for bids in the freelancer pool, so the catalog describes them that way, and
profile slots (agency marketplace profiles) aren't sold to freelancers.
"""
import logging
import time
from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, model_validator

from .. import db, repo
from ..auth import current_user
from ..config import get_settings
from ..payments import stripe_api, subscriptions
from ..seed import SUBSCRIPTION_PLANS
from .activity import send_sale_alert

log = logging.getLogger("autopilot.billing")

router = APIRouter(tags=["billing"])

CREDIT_PACKS = {
    "bids": {"label": "10 Job Bids", "field": "bidCredits", "credits": 10, "price": 9.9},
    "profiles": {"label": "1 Platform Profile", "field": "profileCredits", "credits": 1, "price": 5.99},
}
PRO_PLAN = {"label": "Pro plan — unlimited bids & profiles", "price": 19}
TRIAL_DAYS = 3
# What a paid plan adds on top of the free plan. Pro is unlimited (spend_credit
# skips it); Plus tops up bids every billing period.
PLAN_GRANTS = {
    "plus": {"start": {"bidCredits": 50, "profileCredits": 3}, "renewal": {"bidCredits": 50}},
    "pro": {"start": {}, "renewal": {}},
}
PAID_PLANS = {p["id"]: p for p in SUBSCRIPTION_PLANS if p["id"] in PLAN_GRANTS}
ENDED = ("canceled", "unpaid", "incomplete_expired")
# What each plan does for a freelancer account (the plans and prices are the same; see pool/credits.py).
FREELANCER_FEATURES = {
    "free": ["10 spec bids included", "Message agencies about your specs and contracts", "Earnings and payout records"],
    "plus": ["50 spec bids every month", "Unused bids carry over", "Everything in Basic", "Email support"],
    "pro": ["Unlimited spec bids", "No bid packs needed", "Everything in Plus", "Priority support"],
}
FREELANCER_AUDIENCE = {"free": "Start bidding in the pool", "plus": "Freelancers bidding every week",
                       "pro": "Full-time freelancers"}
AGENCY_ONLY_PACKS = ("profiles",)


def _is_freelancer(user: dict) -> bool:
    return user.get("role") == "freelancer"


def _plans_for(user: dict) -> list[dict]:
    if not _is_freelancer(user):
        return [{**p, "interval": "month"} for p in SUBSCRIPTION_PLANS]
    return [{**p, "interval": "month", "features": FREELANCER_FEATURES[p["id"]], "audience": FREELANCER_AUDIENCE[p["id"]]}
            for p in SUBSCRIPTION_PLANS]


def _plan_page(user: dict) -> str:
    """Where the account manages its plan (the Stripe billing portal returns here)."""
    return "/freelancer/billing" if _is_freelancer(user) else "/dashboard/money/plan"


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _purchase(item: str, amount: float, status: str = "Simulated", **extra) -> dict:
    return {"id": f"po-{uuid4().hex[:12]}", "item": item, "amount": amount, "status": status, "date": _now_iso(), **extra}


def _iso(ts) -> str | None:
    if isinstance(ts, (int, float)) and ts > 0:
        return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return None


def _sub_view(sub: dict) -> dict | None:
    if not sub.get("subscription_id"):
        return None
    return {
        "plan": sub.get("plan"), "status": sub.get("status"), "trialEnd": sub.get("trial_end"),
        "currentPeriodEnd": sub.get("current_period_end"), "cancelAtPeriodEnd": bool(sub.get("cancel_at_period_end")),
        "canManage": bool(sub.get("customer_id")),
    }


def _simulation_allowed() -> bool:
    settings = get_settings()
    return not stripe_api.configured(settings) and settings.environment != "production"


def _refuse_simulation() -> None:
    settings = get_settings()
    if stripe_api.configured(settings):
        raise HTTPException(409, "Purchases go through checkout now. Nothing was charged.")
    if settings.environment == "production":
        raise HTTPException(403, "Online checkout isn't live yet, so nothing was charged.")


@router.get("/user-monetization")
async def get_monetization(user: dict = Depends(current_user)):
    return await repo.get_billing(user["id"])


@router.get("/billing-history")
async def billing_history(user: dict = Depends(current_user)):
    return (await repo.get_billing(user["id"]))["purchases"]


_RECEIPT_NOTES = {
    "Paid": "Paid through Stripe. Stripe's own receipt (with the card or wallet used) is under Manage billing.",
    "Trial": "A free trial started. Nothing was charged.",
    "Ended": "The plan ended. Nothing was charged.",
    "Simulated": "Simulated purchase on a development server: no payment was taken and no money moved.",
}


@router.get("/billing/receipts/{purchase_id}")
async def receipt(purchase_id: str, user: dict = Depends(current_user)):
    """A receipt for one of the caller's own purchases, built from the server's record (never from the browser)."""
    billing = await repo.get_billing(user["id"])
    found = next((p for p in billing.get("purchases") or [] if p.get("id") == purchase_id[:64]), None)
    if not found:
        raise HTTPException(404, "Purchase not found.")
    account = await db.find_user(user["email"]) or {}
    status = str(found.get("status") or "")
    return {
        "number": "AP-" + str(found["id"]).removeprefix("po-").upper(),
        "purchaseId": found["id"], "date": found.get("date"), "item": found.get("item") or found.get("description") or "",
        "amount": round(float(found.get("amount") or 0), 2), "currency": "USD", "status": status,
        "recurring": bool(found.get("recurring")), "charged": status == "Paid" and float(found.get("amount") or 0) > 0,
        # The purchase record doesn't keep the card/crypto split, so say only what is known.
        "paymentMethod": found.get("method") or ("Stripe" if status == "Paid" else None),
        "billedTo": {"name": account.get("name", ""), "email": user["email"], "company": account.get("company", "")},
        "issuer": "Autopilot",
        "note": _RECEIPT_NOTES.get(status, ""),
    }


@router.get("/billing/checkout-config")
async def checkout_config(user: dict = Depends(current_user)):
    settings = get_settings()
    sub = await subscriptions.get(user["id"])
    billing = await repo.get_billing(user["id"])
    return {
        "live": stripe_api.configured(settings),
        "cryptoLive": stripe_api.crypto_enabled(settings),
        "simulated": _simulation_allowed(),
        "trialDays": TRIAL_DAYS,
        "trialAvailable": not sub.get("trial_used"),
        "plan": billing.get("plan", "free"),
        "plans": _plans_for(user),
        "packs": [{"id": k, "label": v["label"], "price": v["price"], "credits": v["credits"]} for k, v in CREDIT_PACKS.items()
                  if not (_is_freelancer(user) and k in AGENCY_ONLY_PACKS)],
        "subscription": _sub_view(sub),
        "planPage": _plan_page(user),
    }


class CheckoutBody(BaseModel):
    plan: Literal["plus", "pro"] | None = None
    pack: Literal["bids", "profiles"] | None = None
    method: Literal["card", "crypto"] = "card"

    @model_validator(mode="after")
    def _one(self):
        if (self.plan is None) == (self.pack is None):
            raise ValueError("choose a plan or a credit pack")
        if self.plan and self.method != "card":
            raise ValueError("plans are paid by card")
        return self


@router.post("/billing/checkout")
async def start_checkout(body: CheckoutBody, user: dict = Depends(current_user)):
    settings = get_settings()
    if body.pack in AGENCY_ONLY_PACKS and _is_freelancer(user):
        raise HTTPException(422, "Profile slots are for agency accounts. Nothing was charged.")
    if not stripe_api.configured(settings):
        raise HTTPException(503, "Online checkout isn't switched on yet, so nothing was charged.")
    billing = await repo.get_billing(user["id"])
    sub = await subscriptions.get(user["id"])
    active = sub.get("subscription_id") and sub.get("status") not in ENDED
    site = settings.site_url
    meta = {"user_id": user["id"]}
    try:
        if body.plan:
            plan = PAID_PLANS[body.plan]
            if active:
                same = sub.get("plan") == body.plan
                raise HTTPException(409, f"You're already on {plan['name']}." if same else
                                    "You already have a paid plan. Change it from Manage billing.")
            trial = TRIAL_DAYS if not sub.get("trial_used") else 0
            session = await stripe_api.create_subscription_session(
                settings, amount_cents=int(round(plan["price"] * 100)), name=f"Autopilot {plan['name']}",
                interval="month", trial_days=trial,
                metadata={**meta, "kind": "plan", "plan": body.plan, "trial_days": trial},
                success_url=f"{site}/checkout/success?plan={body.plan}&session_id={{CHECKOUT_SESSION_ID}}",
                cancel_url=f"{site}/checkout?plan={body.plan}&cancelled=1",
                client_reference_id=user["id"], customer_id=sub.get("customer_id"), customer_email=user["email"],
            )
        else:
            pack = CREDIT_PACKS[body.pack]
            if billing.get("plan") == "pro":
                raise HTTPException(409, "Pro already includes unlimited bids and profiles.")
            if body.method == "crypto" and not stripe_api.crypto_enabled(settings):
                raise HTTPException(503, "Crypto payments aren't switched on yet. Pay by card instead.")
            session = await stripe_api.create_checkout_session(
                settings, amount_cents=int(round(pack["price"] * 100)), name=f"Autopilot · {pack['label']}",
                method="crypto" if body.method == "crypto" else "card",
                metadata={**meta, "kind": "pack", "pack": body.pack},
                success_url=f"{site}/checkout/success?pack={body.pack}",
                cancel_url=f"{site}/checkout?pack={body.pack}&cancelled=1",
                client_reference_id=user["id"],
            )
    except stripe_api.StripeError:
        raise HTTPException(502, "The payment provider didn't respond, so nothing was charged. Try again in a moment.")
    return {"url": session["url"]}


@router.post("/billing/portal")
async def billing_portal(user: dict = Depends(current_user)):
    settings = get_settings()
    if not stripe_api.configured(settings):
        raise HTTPException(503, "Online billing isn't switched on yet.")
    sub = await subscriptions.get(user["id"])
    if not sub.get("customer_id"):
        raise HTTPException(404, "There's no paid plan on this account yet.")
    try:
        url = await stripe_api.create_portal_session(settings, customer_id=sub["customer_id"],
                                                     return_url=f"{settings.site_url}{_plan_page(user)}")
    except stripe_api.StripeError:
        raise HTTPException(502, "The billing page couldn't be opened. Try again in a moment.")
    return {"url": url}


class CancelBody(BaseModel):
    cancel: bool = True


@router.post("/billing/subscription/cancel")
async def cancel_subscription(body: CancelBody, user: dict = Depends(current_user)):
    settings = get_settings()
    if not stripe_api.configured(settings):
        raise HTTPException(503, "Online billing isn't switched on yet.")
    sub = await subscriptions.get(user["id"])
    if not sub.get("subscription_id") or sub.get("status") in ENDED:
        raise HTTPException(404, "There's no active plan to cancel.")
    try:
        await stripe_api.set_cancel_at_period_end(settings, sub["subscription_id"], body.cancel)
    except stripe_api.StripeError:
        raise HTTPException(502, "The payment provider didn't respond. Nothing changed.")
    sub = await subscriptions.update(user["id"], {"cancel_at_period_end": body.cancel})
    await repo.log_activity(user["id"], "Billing", "Plan set to cancel at period end" if body.cancel else "Plan cancellation undone")
    return {"subscription": _sub_view(sub)}


# --------------------------------------------------------------------------- #
# Simulated purchases (development only, no Stripe)
# --------------------------------------------------------------------------- #
class CreditsBody(BaseModel):
    kind: Literal["bids", "profiles"]


@router.post("/billing/credits")
async def buy_credits(body: CreditsBody, user: dict = Depends(current_user)):
    _refuse_simulation()
    if body.kind in AGENCY_ONLY_PACKS and _is_freelancer(user):
        raise HTTPException(422, "Profile slots are for agency accounts.")
    pack = CREDIT_PACKS[body.kind]
    purchase = _purchase(pack["label"], pack["price"])
    billing = await repo.record_purchase(user["id"], purchase, add_credits={pack["field"]: pack["credits"]})
    await repo.log_activity(user["id"], "Operator", f"Added {pack['label']} — ${pack['price']} (simulated checkout)")
    await send_sale_alert(user["id"], "purchase", f"{pack['label']} (simulated)", pack["price"])
    return {"purchase": purchase, "monetization": billing}


@router.post("/billing/upgrade")
async def upgrade(user: dict = Depends(current_user)):
    _refuse_simulation()
    purchase = _purchase(PRO_PLAN["label"], PRO_PLAN["price"], recurring=True)
    billing = await repo.record_purchase(user["id"], purchase, plan="pro")
    await repo.log_activity(user["id"], "Operator", "Upgraded to Pro plan (simulated checkout)")
    await send_sale_alert(user["id"], "upgrade", "Pro plan (simulated)", PRO_PLAN["price"])
    return {"purchase": purchase, "monetization": billing}


class SpendBody(BaseModel):
    kind: Literal["profile"]


@router.post("/billing/spend")
async def spend(body: SpendBody, user: dict = Depends(current_user)):
    billing = await repo.spend_credit(user["id"], body.kind)
    if billing is None:
        raise HTTPException(402, "No profile credits left.")
    return {"monetization": billing}


# --------------------------------------------------------------------------- #
# Stripe webhook events for plans and credit packs
# --------------------------------------------------------------------------- #
BILLING_EVENTS = (
    "checkout.session.completed", "checkout.session.async_payment_succeeded",
    "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid",
)


async def _end_plan(user_id: str, sub_id: str, reason: str) -> None:
    sub = await subscriptions.get(user_id)
    if sub.get("subscription_id") != sub_id:
        return  # an older subscription; the current one decides the plan
    billing = await repo.get_billing(user_id)
    if billing.get("plan") in PLAN_GRANTS:
        await repo.record_purchase(user_id, _purchase(f"{PAID_PLANS[billing['plan']]['name']} plan ended", 0, "Ended"), plan="free")
        await repo.notify(user_id, "Your plan ended", f"{reason} You're back on the free Basic plan.", kind="warning")
        await repo.log_activity(user_id, "Billing", f"Plan ended ({reason.rstrip('.')})")


async def _session_completed(session: dict) -> dict:
    meta = session.get("metadata") or {}
    kind, user_id = meta.get("kind"), str(meta.get("user_id") or session.get("client_reference_id") or "")
    session_id = str(session.get("id") or "")
    if not user_id:
        return {"received": True}
    if kind == "plan":
        plan_id = meta.get("plan")
        plan = PAID_PLANS.get(plan_id)
        if not plan or session.get("status") not in (None, "complete"):
            return {"received": True}
        if not await subscriptions.claim(user_id, f"cs:{session_id}"):
            return {"received": True, "duplicate": True}
        trial = int(meta.get("trial_days") or 0)
        await subscriptions.update(user_id, {
            "customer_id": session.get("customer"), "subscription_id": session.get("subscription"),
            "plan": plan_id, "status": "trialing" if trial else "active", "cancel_at_period_end": False,
            **({"trial_used": True, "trial_end": _iso(time.time() + trial * 86400)} if trial else {}),
        })
        item = f"{plan['name']} plan — {trial}-day free trial" if trial else f"{plan['name']} plan — monthly"
        await repo.record_purchase(
            user_id, _purchase(item, 0 if trial else plan["price"], "Trial" if trial else "Paid", recurring=True),
            plan=plan_id, add_credits=PLAN_GRANTS[plan_id]["start"] or None,
        )
        await repo.notify(user_id, f"Welcome to {plan['name']}",
                          f"Your {trial}-day free trial has started." if trial else f"Your {plan['name']} plan is active.")
        await repo.log_activity(user_id, "Billing", f"Started {plan['name']} ({'trial' if trial else 'paid'}) through Stripe")
        await send_sale_alert(user_id, "upgrade", f"{plan['name']} plan{' trial' if trial else ''}", 0 if trial else plan["price"])
        return {"received": True, "plan": plan_id}
    if kind == "pack":
        pack = CREDIT_PACKS.get(str(meta.get("pack") or ""))
        if not pack:
            return {"received": True}
        if session.get("payment_status") != "paid":
            return {"received": True, "pending": True}
        amount = session.get("amount_total")
        if session.get("currency") != "usd" or not isinstance(amount, int) or amount < int(round(pack["price"] * 100)):
            log.warning("credit pack session %s: amount %s doesn't cover the pack", session_id, amount)
            return {"received": True}
        if not await subscriptions.claim(user_id, f"cs:{session_id}"):
            return {"received": True, "duplicate": True}
        await repo.record_purchase(user_id, _purchase(pack["label"], amount / 100, "Paid"), add_credits={pack["field"]: pack["credits"]})
        await repo.notify(user_id, f"{pack['label']} added", f"Paid ${amount / 100:,.2f}. Your credits are ready to use.")
        await send_sale_alert(user_id, "purchase", pack["label"], amount / 100)
        return {"received": True, "pack": meta.get("pack")}
    return {"received": True}


async def handle_stripe_event(event: dict) -> dict | None:
    """Apply a Stripe event that belongs to billing. Returns None when the
    event is someone else's (an invoice pay link), so the caller handles it."""
    etype = event.get("type")
    if etype not in BILLING_EVENTS:
        return None
    obj = (event.get("data") or {}).get("object") or {}
    event_id = str(event.get("id") or "")

    if etype.startswith("checkout.session."):
        if (obj.get("metadata") or {}).get("kind") not in ("plan", "pack"):
            return None
        return await _session_completed(obj)

    if etype.startswith("customer.subscription."):
        sub_id = str(obj.get("id") or "")
        user_id = str((obj.get("metadata") or {}).get("user_id") or "") or await subscriptions.find_user_by_subscription(sub_id)
        if not user_id:
            return {"received": True}
        if not await subscriptions.claim(user_id, f"ev:{event_id}"):
            return {"received": True, "duplicate": True}
        status = "canceled" if etype.endswith(".deleted") else str(obj.get("status") or "")
        current = await subscriptions.get(user_id)
        if current.get("subscription_id") in (None, sub_id):
            await subscriptions.update(user_id, {
                "subscription_id": sub_id, "customer_id": obj.get("customer") or current.get("customer_id"),
                "status": status, "trial_end": _iso(obj.get("trial_end")),
                "current_period_end": _iso(obj.get("current_period_end")),
                "cancel_at_period_end": bool(obj.get("cancel_at_period_end")),
            })
        if status in ENDED:
            reason = "The trial ended without a card on file." if obj.get("trial_end") and not obj.get("default_payment_method") \
                else "Your subscription was cancelled."
            await _end_plan(user_id, sub_id, reason)
        return {"received": True, "status": status}

    # invoice.paid — a renewal (or the first charge after a trial).
    sub_id = str(obj.get("subscription") or "")
    meta = ((obj.get("subscription_details") or {}).get("metadata") or {})
    user_id = str(meta.get("user_id") or "") or await subscriptions.find_user_by_subscription(sub_id)
    amount = obj.get("amount_paid")
    if not user_id or not isinstance(amount, int) or amount <= 0:
        return {"received": True}
    if not await subscriptions.claim(user_id, f"in:{obj.get('id') or event_id}"):
        return {"received": True, "duplicate": True}
    sub = await subscriptions.get(user_id)
    plan_id = sub.get("plan") if sub.get("subscription_id") == sub_id else meta.get("plan")
    plan = PAID_PLANS.get(plan_id or "")
    name = f"{plan['name']} plan — monthly" if plan else "Subscription payment"
    renewal = PLAN_GRANTS[plan_id]["renewal"] if plan and obj.get("billing_reason") == "subscription_cycle" else {}
    await repo.record_purchase(user_id, _purchase(name, amount / 100, "Paid", recurring=True), add_credits=renewal or None)
    if sub.get("subscription_id") == sub_id:
        await subscriptions.update(user_id, {"status": "active"})
    await repo.log_activity(user_id, "Billing", f"Paid ${amount / 100:,.2f} for {name}")
    return {"received": True, "paid": True}
