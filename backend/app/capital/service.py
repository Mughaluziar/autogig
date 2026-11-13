"""Capital program: identity checks, investor pool, early payment, protection.

SIMULATED SETTLEMENT. The ledger records every movement a licensed partner
would execute; no money moves. Product rules:

  * Early payment: an identity-verified freelancer can draw up to the policy
    share of a fixed-price, USD order that the platform's API has verified
    and recently confirmed. It is repaid by the freelancer after the
    platform pays them (marketplaces pay the freelancer's own account).
  * Protection fund (not insurance): covers losses the PLATFORM reports,
    such as a client cancellation or refund after cover starts. Each advance
    is covered automatically; cover can also be bought for an order. Claims
    are reviewed by an operator and paid only up to the fund's balance.
  * Investors: identity-verified, accredited attestation, risk disclosure
    acknowledged, allowed jurisdiction. They hold NAV-priced pool shares, so
    fee yield and write-offs are shared pro rata.

Money-moving steps follow intent -> idempotent ledger post -> mark done, so
`reconcile()` can finish any step interrupted between the two writes.
"""
import logging
import re
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from .. import db, repo
from ..config import get_settings
from ..orders import store as order_store
from . import ledger, store
from .ledger import LedgerRejected, line
from .policy import (
    ADVANCEABLE_STATUSES, LOSS_STATUSES, PENDING_LOSS_STATUSES, POOL_CURRENCY, TRUSTED_STATUS_SOURCES,
    bps_of, investor_jurisdictions, policy, split_fee,
)

log = logging.getLogger("autopilot.capital")

KYC_STATUSES = ("none", "pending", "verified", "rejected")
INVESTOR_BASES = ("income", "net_worth", "professional")
OPEN_ADVANCE = ("disbursing", "active", "overdue", "defaulted")
MIN_DEPOSIT_CENTS = 10_00
MAX_DEPOSIT_CENTS = 1_000_000_00
# One displayed pool share = this many share units ($1.00 at launch).
DISPLAY_SHARE_UNITS = ledger.SHARE_SCALE * 100


class CapitalError(Exception):
    def __init__(self, message: str, status: int = 422, reasons: list[str] | None = None):
        super().__init__(message)
        self.status = status
        self.reasons = reasons or []


def to_cents(amount) -> int | None:
    if amount is None:
        return None
    try:
        return int((Decimal(str(amount)) * 100).quantize(Decimal(1)))
    except (InvalidOperation, ValueError):
        return None


def _iso(value) -> str | None:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ") if value else None


async def _update(coll: str, record: dict, fields: dict) -> dict:
    """CAS update that reloads and retries on a concurrent change, failing
    only if the record left the state the caller expected."""
    updated = await store.update(coll, record["id"], {**fields, "updated_at": store.now()},
                                 expect_version=record["version"])
    if updated is None:
        raise CapitalError("This record changed while you were working on it. Refresh and try again.", 409)
    return updated


async def _notify_operators(title: str, body: str) -> None:
    for email in get_settings().owner_email_set:
        account = await db.find_user(email)
        if account and account.get("id"):
            await repo.notify(account["id"], title, body, "info")


# --------------------------------------------------------------------------- #
# Profiles and identity verification
# --------------------------------------------------------------------------- #
def _blank_profile(user_id: str) -> dict:
    return {
        "user_id": user_id, "roles": [],
        "kyc": {"status": "none", "legal_name": "", "country": "", "method": None,
                "submitted_at": None, "reviewed_at": None, "reviewed_by": None, "note": ""},
        "investor": {"accredited": False, "basis": None, "attested_at": None, "risk_ack_at": None},
    }


async def get_profile(user_id: str) -> dict:
    return await store.profile(user_id) or {**_blank_profile(user_id), "id": None, "version": 0}


def investor_check(profile: dict) -> list[str]:
    """Reasons the user can't invest yet; empty when they can."""
    reasons = []
    kyc = profile.get("kyc") or {}
    inv = profile.get("investor") or {}
    if kyc.get("status") != "verified":
        reasons.append("Identity verification isn't complete.")
    if not inv.get("accredited"):
        reasons.append("Accredited or professional investor status hasn't been attested.")
    if not inv.get("risk_ack_at"):
        reasons.append("The risk disclosure hasn't been acknowledged.")
    allowed = investor_jurisdictions()
    if allowed and (kyc.get("country") or "").upper() not in allowed:
        reasons.append("Investing isn't available in your country.")
    return reasons


async def submit_verification(user_id: str, *, legal_name: str, country: str, roles: list[str],
                              investor_basis: str | None, accredited: bool, risk_ack: bool) -> dict:
    legal_name = re.sub(r"\s+", " ", legal_name).strip()
    country = country.strip().upper()
    if len(legal_name) < 3:
        raise CapitalError("Enter your full legal name.")
    if not re.fullmatch(r"[A-Z]{2}", country):
        raise CapitalError("Use a two-letter country code, such as US or GB.")
    roles = sorted({r for r in roles if r in ("freelancer", "investor")})
    if not roles:
        raise CapitalError("Choose at least one role: freelancer or investor.")
    if "investor" in roles:
        if not accredited or investor_basis not in INVESTOR_BASES:
            raise CapitalError("Investors must attest accredited or professional status and give the basis.")
        if not risk_ack:
            raise CapitalError("Read and acknowledge the risk disclosure to invest.")
    current = await store.profile(user_id)
    now = store.now()
    kyc_fields = {"legal_name": legal_name, "country": country, "submitted_at": now,
                  "method": "operator_review", "note": ""}
    investor = {"accredited": bool(accredited) if "investor" in roles else False,
                "basis": investor_basis if "investor" in roles else None,
                "attested_at": now if "investor" in roles else None,
                "risk_ack_at": now if "investor" in roles and risk_ack else None}
    if current is None:
        profile = _blank_profile(user_id)
        profile.update(roles=roles, investor=investor)
        profile["kyc"].update(status="pending", **kyc_fields)
        try:
            saved = await store.insert("capital_profiles", user_id, profile)
        except store.Conflict:
            raise CapitalError("Your verification was just submitted. Refresh.", 409)
    else:
        kyc = dict(current["kyc"])
        if kyc.get("status") == "verified" and (kyc.get("legal_name"), kyc.get("country")) != (legal_name, country):
            raise CapitalError("Your identity is already verified. Contact support to change your name or country.", 409)
        if kyc.get("status") != "verified":
            kyc.update(status="pending", **kyc_fields)
        saved = await _update("capital_profiles", current, {"roles": sorted(set(current.get("roles", [])) | set(roles)),
                                                            "kyc": kyc, "investor": investor})
    await repo.log_activity(user_id, "Capital", f"Submitted verification ({', '.join(roles)})")
    if saved["kyc"]["status"] == "pending":
        await _notify_operators("Verification to review", f"{legal_name} ({country}) applied as {', '.join(roles)}.")
    return saved


async def review_verification(reviewer: dict, user_id: str, approve: bool, note: str) -> dict:
    current = await store.profile(user_id)
    if current is None or current["kyc"].get("status") != "pending":
        raise CapitalError("There is no pending verification for this user.", 404)
    kyc = {**current["kyc"], "status": "verified" if approve else "rejected", "reviewed_at": store.now(),
           "reviewed_by": reviewer.get("email"), "note": note.strip()[:300]}
    saved = await _update("capital_profiles", current, {"kyc": kyc})
    await repo.notify(user_id, "Identity verified" if approve else "Verification not approved",
                      "You can now use early payment and insurance." if approve else (note or "Contact support for details."),
                      "success" if approve else "warning")
    await repo.log_activity(reviewer["id"], "Capital", f"{'Approved' if approve else 'Rejected'} verification for {user_id}")
    return saved


async def pending_verifications() -> list[dict]:
    return await store.find("capital_profiles", {"kyc.status": "pending"}, limit=200)


# --------------------------------------------------------------------------- #
# Investor pool
# --------------------------------------------------------------------------- #
def _reserve_cents(bal: dict) -> int:
    return bps_of(max(0, ledger.nav_cents(bal)), policy().liquidity_reserve_bps)


def _advance_liquidity(bal: dict) -> int:
    return max(0, ledger.usd(bal, "pool:cash") - _reserve_cents(bal))


async def pool_summary() -> dict:
    bal = await ledger.balances()
    total = ledger.total_shares(bal)
    nav = ledger.nav_cents(bal)
    advances = await store.find("capital_advances", {"status": {"$in": list(OPEN_ADVANCE) + ["repaid", "covered"]}},
                                limit=5000)
    by_status: dict[str, int] = {}
    for a in advances:
        by_status[a["status"]] = by_status.get(a["status"], 0) + 1
    settled = sum(by_status.get(s, 0) for s in ("repaid", "covered", "defaulted"))
    return {
        "settlement": ledger.SETTLEMENT,
        "currency": POOL_CURRENCY,
        "navCents": nav,
        "cashCents": ledger.usd(bal, "pool:cash"),
        "outstandingCents": ledger.usd(bal, "pool:advances"),
        "reserveCents": _reserve_cents(bal),
        "availableForAdvancesCents": _advance_liquidity(bal),
        "realisedYieldCents": -ledger.usd(bal, "pool:income"),
        "writtenOffCents": ledger.usd(bal, "pool:losses"),
        "sharePriceCents": nav * DISPLAY_SHARE_UNITS // total if total else 100,
        "totalShares": total / DISPLAY_SHARE_UNITS,
        "protectionFundCents": ledger.usd(bal, "protection:cash"),
        "protectionPaidCents": ledger.usd(bal, "protection:payouts"),
        "advances": by_status,
        "defaultRate": round(by_status.get("defaulted", 0) / settled, 4) if settled else 0.0,
        "policy": {
            "advanceRateBps": policy().advance_rate_bps, "feeBps": policy().fee_bps,
            "termDays": policy().term_days, "graceDays": policy().grace_days,
            "investorShareBps": policy().investor_share_bps, "protectionShareBps": policy().protection_share_bps,
            "platformShareBps": policy().platform_share_bps, "liquidityReserveBps": policy().liquidity_reserve_bps,
            "protectionMaxCoverBps": policy().protection_max_cover_bps,
            "protectionMaxCoverCents": policy().protection_max_cover_cents,
            "protectionPremiumBps": policy().protection_premium_bps, "protectionTermDays": policy().protection_term_days,
        },
    }


async def investor_position(user_id: str) -> dict:
    bal = await ledger.balances()
    units = ledger.shares(bal, f"shares:{user_id}")
    deposited = withdrawn = 0
    for entry in await ledger.entries(user_id=user_id, limit=5000):
        cash = sum(l["amount"] for l in entry["lines"] if l["account"] == "pool:cash")
        if entry["kind"] == "investor_deposit":
            deposited += cash
        elif entry["kind"] == "investor_withdrawal":
            withdrawn += -cash
    value = ledger.value_of_shares(bal, units)
    return {"shares": units / DISPLAY_SHARE_UNITS, "valueCents": value, "depositedCents": deposited,
            "withdrawnCents": withdrawn, "gainCents": value + withdrawn - deposited,
            "settlement": ledger.SETTLEMENT}


async def deposit(user_id: str, amount_cents: int, idem: str) -> dict:
    reasons = investor_check(await get_profile(user_id))
    if reasons:
        raise CapitalError("You can't invest yet.", 403, reasons)
    if not MIN_DEPOSIT_CENTS <= amount_cents <= MAX_DEPOSIT_CENTS:
        raise CapitalError(f"Deposits must be between ${MIN_DEPOSIT_CENTS / 100:,.0f} and ${MAX_DEPOSIT_CENTS / 100:,.0f}.")

    def lines(bal: dict) -> list[dict]:
        minted = ledger.shares_for_deposit(bal, amount_cents)
        if minted <= 0:
            raise LedgerRejected("The deposit is too small to buy a share at the current price.")
        return [line("pool:cash", amount_cents), line("pool:capital", -amount_cents),
                line(f"shares:{user_id}", minted, "SHARE"), line("shares:issued", -minted, "SHARE")]

    entry = await ledger.post("investor_deposit", lines, memo=f"Investor deposit {amount_cents / 100:,.2f} USD",
                              refs={"user_id": user_id}, idem=f"deposit:{user_id}:{idem}")
    await repo.log_activity(user_id, "Capital", f"Deposited ${amount_cents / 100:,.2f} into the pool (simulated)")
    return entry


async def withdraw(user_id: str, amount_cents: int | None, idem: str) -> dict:
    profile = await get_profile(user_id)
    if profile["kyc"].get("status") != "verified":
        raise CapitalError("Identity verification is required to withdraw.", 403)

    def lines(bal: dict) -> list[dict]:
        held = ledger.shares(bal, f"shares:{user_id}")
        amount = ledger.value_of_shares(bal, held) if amount_cents is None else amount_cents
        if amount <= 0:
            raise LedgerRejected("You have nothing to withdraw.")
        burn = min(ledger.shares_to_burn(bal, amount), held) if amount_cents is None else ledger.shares_to_burn(bal, amount)
        if burn > held:
            raise LedgerRejected("That's more than your position is worth.")
        return [line("pool:cash", -amount), line("pool:capital", amount),
                line(f"shares:{user_id}", -burn, "SHARE"), line("shares:issued", burn, "SHARE")]

    def check(after: dict) -> None:
        if ledger.usd(after, "pool:cash") < 0:
            raise LedgerRejected("Not enough uncommitted cash in the pool right now; most capital is out in early "
                                 "payments. Try a smaller amount or wait for repayments.")
        if ledger.shares(after, f"shares:{user_id}") < 0:
            raise LedgerRejected("That's more than your position is worth.")

    entry = await ledger.post("investor_withdrawal", lines, memo="Investor withdrawal", refs={"user_id": user_id},
                              idem=f"withdraw:{user_id}:{idem}", check=check)
    paid = sum(l["amount"] for l in entry["lines"] if l["account"] == "pool:capital")
    await repo.log_activity(user_id, "Capital", f"Withdrew ${paid / 100:,.2f} from the pool (simulated)")
    return entry


# --------------------------------------------------------------------------- #
# Early payment
# --------------------------------------------------------------------------- #
def _principal_due(adv: dict) -> int:
    return adv["principal_cents"] - adv.get("principal_repaid_cents", 0) - adv.get("principal_covered_cents", 0)


def _fee_due(adv: dict) -> int:
    return adv["fee_cents"] - adv.get("fee_repaid_cents", 0) - adv.get("fee_waived_cents", 0)


async def _freelancer_exposure(user_id: str) -> tuple[int, bool]:
    open_advances = await store.find("capital_advances", {"user_id": user_id, "open": True})
    outstanding = sum(_principal_due(a) for a in open_advances)
    return outstanding, any(a["status"] == "defaulted" for a in open_advances)


def underwrite(order: dict, profile: dict, outstanding: int, in_default: bool, bal: dict) -> dict:
    """Whether `order` can back an early payment, and up to how much."""
    p = policy()
    reasons: list[str] = []
    if profile["kyc"].get("status") != "verified":
        reasons.append("Complete identity verification first.")
    if in_default:
        reasons.append("You have an early payment in default.")
    if order.get("verification_status") != "verified":
        reasons.append("Only orders verified by the platform's API qualify.")
    if order.get("pricing") != "fixed":
        reasons.append("Only fixed-price orders qualify; an hourly rate isn't a contract value.")
    if order.get("status") not in ADVANCEABLE_STATUSES:
        reasons.append(f"The order is {order.get('status')}; only active or delivered orders qualify.")
    if (order.get("currency") or "").upper() != POOL_CURRENCY:
        reasons.append("Only USD orders qualify for now.")
    if order.get("data_expired"):
        reasons.append("Order details have expired; sync the account first.")
    synced = store.aware(order.get("last_synced_at"))
    if synced is None or store.now() - synced > timedelta(hours=p.order_freshness_hours):
        reasons.append(f"The platform hasn't confirmed this order in the last {p.order_freshness_hours} hours; sync the account.")
    order_cents = to_cents(order.get("amount")) or 0
    if order_cents <= 0:
        reasons.append("The order has no amount.")
    by_order = bps_of(order_cents, p.advance_rate_bps)
    headroom = p.max_outstanding_per_freelancer_cents - outstanding
    liquidity = _advance_liquidity(bal)
    limit = max(0, min(by_order, p.max_advance_cents, headroom, liquidity))
    if not reasons and limit < p.min_advance_cents:
        if liquidity < p.min_advance_cents:
            reasons.append("The pool doesn't have enough available capital right now.")
        elif headroom < p.min_advance_cents:
            reasons.append("You've reached your early-payment limit; repay an advance first.")
        else:
            reasons.append("The order is too small for an early payment.")
    return {"eligible": not reasons, "reasons": reasons, "orderCents": order_cents,
            "maxPrincipalCents": limit if not reasons else 0, "feeBps": p.fee_bps}


async def eligible_orders(user_id: str) -> list[dict]:
    profile = await get_profile(user_id)
    outstanding, in_default = await _freelancer_exposure(user_id)
    bal = await ledger.balances()
    open_orders = {a["order_id"] for a in await store.find("capital_advances", {"user_id": user_id, "open": True})}
    covered = {c["order_id"] for c in await store.find("capital_coverages", {"user_id": user_id, "status": "active"})}
    rows = []
    for order in await order_store.list_orders(user_id, {"verification_status": "verified"}, limit=300):
        result = underwrite(order, profile, outstanding, in_default, bal)
        if order["id"] in open_orders:
            result = {**result, "eligible": False, "maxPrincipalCents": 0,
                      "reasons": ["This order already has an early payment."]}
        rows.append({"order": order, "underwriting": result, "covered": order["id"] in covered})
    return rows


async def quote(user_id: str, order_id: str, principal_cents: int | None) -> dict:
    p = policy()
    order = await order_store.get_order(user_id, order_id)
    if order is None:
        raise CapitalError("Order not found.", 404)
    outstanding, in_default = await _freelancer_exposure(user_id)
    uw = underwrite(order, await get_profile(user_id), outstanding, in_default, await ledger.balances())
    if await store.find("capital_advances", {"user_id": user_id, "order_id": order_id, "open": True}, limit=1):
        uw = {**uw, "eligible": False, "reasons": ["This order already has an early payment."]}
    if not uw["eligible"]:
        raise CapitalError("This order doesn't qualify for early payment.", 422, uw["reasons"])
    principal = uw["maxPrincipalCents"] if principal_cents is None else principal_cents
    if not p.min_advance_cents <= principal <= uw["maxPrincipalCents"]:
        raise CapitalError(f"Choose between ${p.min_advance_cents / 100:,.2f} and "
                           f"${uw['maxPrincipalCents'] / 100:,.2f}.")
    fee = max(1, bps_of(principal, p.fee_bps))
    now = store.now()
    return await store.insert("capital_advances", user_id, {
        "order_id": order_id, "platform": order["platform"], "order_external_id": order.get("external_order_id"),
        "order_title": order.get("title"), "order_cents": uw["orderCents"], "currency": POOL_CURRENCY,
        "principal_cents": principal, "fee_cents": fee, "fee_split": split_fee(fee, p),
        "status": "quoted", "open": False, "quote_expires_at": now + timedelta(minutes=p.quote_ttl_minutes),
        "term_days": p.term_days, "grace_days": p.grace_days,
        "principal_repaid_cents": 0, "fee_repaid_cents": 0, "principal_covered_cents": 0,
        "fee_waived_cents": 0, "written_off_cents": 0, "repayments": [], "coverage_id": None,
        "settlement": ledger.SETTLEMENT,
    })


async def _disburse(adv: dict) -> dict:
    """Post the disbursement for an advance in `disbursing` and activate it."""
    p = policy()
    principal = adv["principal_cents"]

    def check(after: dict) -> None:
        if ledger.usd(after, "pool:cash") < bps_of(max(0, ledger.nav_cents(after)), p.liquidity_reserve_bps):
            raise LedgerRejected("The pool no longer has enough available capital.")

    try:
        entry = await ledger.post("advance_disbursed", [line("pool:advances", principal), line("pool:cash", -principal)],
                                  memo=f"Early payment on {adv['platform']} order {adv.get('order_external_id')}",
                                  refs={"user_id": adv["user_id"], "advance_id": adv["id"]},
                                  idem=f"advance:{adv['id']}:disburse", check=check)
    except LedgerRejected as exc:
        await _update("capital_advances", adv, {"status": "cancelled", "open": False, "cancel_reason": str(exc)})
        raise CapitalError(str(exc), 409)
    now = store.now()
    cover = await store.insert("capital_coverages", adv["user_id"], {
        "order_id": adv["order_id"], "kind": "advance", "advance_id": adv["id"], "platform": adv["platform"],
        "order_title": adv.get("order_title"), "covered_cents": principal, "premium_cents": 0,
        "status": "active", "starts_at": now, "ends_at": None,
    })
    return await _update("capital_advances", adv, {
        "status": "active", "accepted_at": adv.get("accepted_at") or now,
        "due_at": now + timedelta(days=adv["term_days"]), "disbursed_seq": entry["seq"], "coverage_id": cover["id"],
    })


async def accept(user_id: str, advance_id: str, accept_terms: bool) -> dict:
    if not accept_terms:
        raise CapitalError("Accept the repayment terms to receive the early payment.")
    adv = await store.get("capital_advances", advance_id, user_id=user_id)
    if adv is None:
        raise CapitalError("Quote not found.", 404)
    if adv["status"] == "disbursing":
        return await _disburse(adv)  # finish an interrupted acceptance
    if adv["status"] != "quoted":
        raise CapitalError(f"This quote is {adv['status']}.", 409)
    if store.aware(adv["quote_expires_at"]) < store.now():
        await _update("capital_advances", adv, {"status": "expired"})
        raise CapitalError("This quote expired. Request a new one.", 409)
    order = await order_store.get_order(user_id, adv["order_id"])
    outstanding, in_default = await _freelancer_exposure(user_id)
    uw = underwrite(order or {}, await get_profile(user_id), outstanding, in_default, await ledger.balances())
    if not uw["eligible"] or adv["principal_cents"] > uw["maxPrincipalCents"]:
        await _update("capital_advances", adv, {"status": "expired"})
        raise CapitalError("The order no longer qualifies for this amount. Request a new quote.", 409, uw["reasons"])
    try:
        adv = await _update("capital_advances", adv, {"status": "disbursing", "open": True,
                                                       "accepted_at": store.now()})
    except store.Conflict:
        raise CapitalError("This order already has an early payment.", 409)
    adv = await _disburse(adv)
    await repo.notify(user_id, "Early payment sent (simulated)",
                      f"${adv['principal_cents'] / 100:,.2f} on {adv.get('order_title') or adv['platform']} order. "
                      f"Repay ${(adv['principal_cents'] + adv['fee_cents']) / 100:,.2f} by "
                      f"{adv['due_at']:%b %d}.", "success")
    await repo.log_activity(user_id, "Capital", f"Accepted early payment {adv['id']} (simulated)")
    return adv


async def _post_repayment(adv: dict, rep: dict) -> None:
    p_part, f_part = rep["principal_cents"], rep["fee_cents"]
    split = split_fee(f_part, policy())
    principal_account = "pool:losses" if rep.get("recovery") else "pool:advances"
    lines = []
    if p_part:
        lines += [line("pool:cash", p_part), line(principal_account, -p_part)]
    if f_part:
        lines += [line("pool:cash", split["investors"]), line("pool:income", -split["investors"]),
                  line("protection:cash", split["protection"]), line("protection:income", -split["protection"]),
                  line("platform:cash", split["platform"]), line("platform:income", -split["platform"])]
    lines = [item for item in lines if item["amount"] != 0]
    await ledger.post("advance_repayment", lines, memo=f"Repayment on early payment {adv['id']}",
                      refs={"user_id": adv["user_id"], "advance_id": adv["id"], "repayment_id": rep["id"]},
                      idem=f"advance:{adv['id']}:repay:{rep['id']}")


async def repay(user_id: str, advance_id: str, amount_cents: int) -> dict:
    adv = await store.get("capital_advances", advance_id, user_id=user_id)
    if adv is None:
        raise CapitalError("Early payment not found.", 404)
    if adv["status"] not in ("active", "overdue", "defaulted"):
        raise CapitalError(f"This early payment is {adv['status']}.", 409)
    principal_due, fee_due = _principal_due(adv), _fee_due(adv)
    if amount_cents <= 0 or amount_cents > principal_due + fee_due:
        raise CapitalError(f"Enter an amount up to ${(principal_due + fee_due) / 100:,.2f}.")
    p_part = min(amount_cents, principal_due)
    f_part = amount_cents - p_part
    rep = {"id": f"r{len(adv.get('repayments', [])) + 1}-{store.now():%Y%m%d%H%M%S%f}",
           "amount_cents": amount_cents, "principal_cents": p_part, "fee_cents": f_part,
           "recovery": adv["status"] == "defaulted", "at": store.now(), "posted": False}
    settled = principal_due - p_part == 0 and fee_due - f_part == 0
    fields = {"repayments": adv.get("repayments", []) + [rep],
              "principal_repaid_cents": adv.get("principal_repaid_cents", 0) + p_part,
              "fee_repaid_cents": adv.get("fee_repaid_cents", 0) + f_part}
    if rep["recovery"]:
        fields["written_off_cents"] = adv.get("written_off_cents", 0) - p_part
    if settled:
        fields.update(status="repaid", open=False, closed_at=store.now())
    adv = await _update("capital_advances", adv, fields)  # intent first
    await _post_repayment(adv, rep)                         # idempotent
    adv = await _mark_repayment_posted(adv, rep["id"])
    if settled and adv.get("coverage_id"):
        cover = await store.get("capital_coverages", adv["coverage_id"])
        if cover and cover["status"] == "active":
            await _update("capital_coverages", cover, {"status": "expired", "ends_at": store.now()})
    await repo.log_activity(user_id, "Capital", f"Repaid ${amount_cents / 100:,.2f} on early payment {advance_id} (simulated)")
    return adv


async def _mark_repayment_posted(adv: dict, rep_id: str) -> dict:
    for _ in range(4):
        reps = [{**r, "posted": True} if r["id"] == rep_id else r for r in adv.get("repayments", [])]
        updated = await store.update("capital_advances", adv["id"], {"repayments": reps}, expect_version=adv["version"])
        if updated:
            return updated
        adv = await store.get("capital_advances", adv["id"])
    return adv


# --------------------------------------------------------------------------- #
# Protection fund
# --------------------------------------------------------------------------- #
def cover_window_closes(order: dict):
    """When standalone cover stops being on offer for this order: a fixed
    window after it arrived. None when it never arrived (an offer not yet
    accepted, or an order imported when its account was connected)."""
    arrived = store.aware(order.get("arrived_at"))
    return arrived + timedelta(hours=policy().protection_offer_window_hours) if arrived else None


def _max_cover_cents(order: dict) -> int:
    p = policy()
    return min(bps_of(to_cents(order.get("amount")) or 0, p.protection_max_cover_bps), p.protection_max_cover_cents)


def _cover_reasons(order: dict) -> list[str]:
    """Why this order can't get standalone cover right now (empty = it can)."""
    reasons = []
    hours = policy().protection_offer_window_hours
    if order.get("verification_status") != "verified":
        reasons.append("Only orders verified by the platform's API can be covered."
                       + (f" {order['platform']} has no order API, so its orders can't be verified."
                          if order.get("verification_status") == "unverifiable" else ""))
    if order.get("pricing") != "fixed" or (order.get("currency") or "").upper() != POOL_CURRENCY:
        reasons.append("Only fixed-price USD orders can be covered.")
    if order.get("status") not in ADVANCEABLE_STATUSES:
        reasons.append(f"The order is {order.get('status')}; only active or delivered orders can be covered.")
    closes = cover_window_closes(order)
    if closes is None:
        reasons.append(f"Cover is offered only in the first {hours} hours after a new order arrives; "
                       "this order was imported when its account was connected, or hasn't started yet.")
    elif store.now() > closes:
        reasons.append(f"The {hours}-hour window to protect this order closed at "
                       f"{closes.strftime('%Y-%m-%d %H:%M UTC')}.")
    return reasons


async def buy_cover(user_id: str, order_id: str, covered_cents: int | None, accept_terms: bool) -> dict:
    p = policy()
    if not accept_terms:
        raise CapitalError("Accept the insurance terms first.")
    if (await get_profile(user_id))["kyc"].get("status") != "verified":
        raise CapitalError("Complete identity verification first.", 403)
    order = await order_store.get_order(user_id, order_id)
    if order is None:
        raise CapitalError("Order not found.", 404)
    reasons = _cover_reasons(order)
    if await store.find("capital_coverages", {"user_id": user_id, "order_id": order_id, "status": "active"}, limit=1):
        reasons.append("This order is already covered.")
    if reasons:
        raise CapitalError("This order can't be covered.", 422, reasons)
    limit = _max_cover_cents(order)
    covered = limit if covered_cents is None else covered_cents
    if not 1_00 <= covered <= limit:
        raise CapitalError(f"Cover between $1.00 and ${limit / 100:,.2f}.")
    premium = max(1, bps_of(covered, p.protection_premium_bps))
    now = store.now()
    cover = await store.insert("capital_coverages", user_id, {
        "order_id": order_id, "kind": "standalone", "advance_id": None, "platform": order["platform"],
        "order_title": order.get("title"), "covered_cents": covered, "premium_cents": premium,
        "status": "pending_premium", "starts_at": now, "ends_at": now + timedelta(days=p.protection_term_days),
    })
    await ledger.post("protection_premium", [line("protection:cash", premium), line("protection:income", -premium)],
                      memo=f"Protection premium for {order['platform']} order {order.get('external_order_id')}",
                      refs={"user_id": user_id, "coverage_id": cover["id"]}, idem=f"cover:{cover['id']}:premium")
    cover = await _update("capital_coverages", cover, {"status": "active"})
    await repo.log_activity(user_id, "Capital", f"Bought insurance on {order['platform']} order (simulated)")
    return cover


async def cover_offers(user_id: str) -> list[dict]:
    """New orders still inside their protection window that the freelancer
    hasn't covered or dismissed, most urgent first. Orders that can't be
    covered are included with the reasons, so the prompt can explain them;
    orders still awaiting API verification wait until the check finishes."""
    p = policy()
    since = store.now() - timedelta(hours=p.protection_offer_window_hours)
    orders = [o for o in await order_store.orders_arrived_since(user_id, since)
              if o.get("status") in ADVANCEABLE_STATUSES and o.get("verification_status") != "pending"
              and not o.get("dismissed")]
    if not orders:
        return []
    ids = [o["id"] for o in orders]
    covered = {c["order_id"] for c in await store.find(
        "capital_coverages", {"user_id": user_id, "order_id": {"$in": ids}, "status": "active"})}
    dismissed = {d["order_id"] for d in await store.find(
        "capital_cover_offers", {"user_id": user_id, "order_id": {"$in": ids}})}
    kyc = (await get_profile(user_id))["kyc"].get("status")
    rows = []
    for order in orders:
        if order["id"] in covered or order["id"] in dismissed:
            continue
        reasons = _cover_reasons(order)
        max_cover = _max_cover_cents(order) if not reasons else 0
        rows.append({
            "order": order, "closes_at": cover_window_closes(order), "eligible": not reasons,
            # Identity is the freelancer's to fix, not the order's, so it is
            # reported separately and the prompt can link to verification.
            "identity_verified": kyc == "verified", "reasons": reasons,
            "max_cover_cents": max_cover, "premium_cents": bps_of(max_cover, p.protection_premium_bps) if max_cover else 0,
            "premium_bps": p.protection_premium_bps, "term_days": p.protection_term_days,
        })
    rows.sort(key=lambda r: r["closes_at"])
    return rows


async def dismiss_cover_offer(user_id: str, order_id: str) -> None:
    """Stop prompting about this order. Cover can still be bought from the
    capital page until the window closes."""
    if await order_store.get_order(user_id, order_id) is None:
        raise CapitalError("Order not found.", 404)
    if not await store.find("capital_cover_offers", {"user_id": user_id, "order_id": order_id}, limit=1):
        try:
            await store.insert("capital_cover_offers", user_id, {"order_id": order_id, "dismissed_at": store.now()})
        except store.Conflict:
            pass  # dismissed twice at once (two tabs)


async def _loss_event(cover: dict) -> tuple[str, dict | None]:
    """('eligible', event) | ('waiting', None) | ('none', None), from what the
    platform API reported after cover started."""
    events = await order_store.list_events(cover["user_id"], order_id=cover["order_id"], event_type="status_changed",
                                           limit=500)
    starts = store.aware(cover["starts_at"])
    for event in sorted(events, key=lambda e: e["created_at"]):
        data = event.get("data") or {}
        if (data.get("to") in LOSS_STATUSES and data.get("source") in TRUSTED_STATUS_SOURCES
                and store.aware(event["created_at"]) >= starts):
            return "eligible", event
    order = await order_store.get_order(cover["user_id"], cover["order_id"])
    if order and order.get("status") in PENDING_LOSS_STATUSES and order.get("status_source") in TRUSTED_STATUS_SOURCES:
        return "waiting", None
    return "none", None


async def _claim_amount(cover: dict) -> int:
    if cover["kind"] == "advance":
        adv = await store.get("capital_advances", cover["advance_id"])
        return _principal_due(adv) if adv else 0
    return cover["covered_cents"]


async def open_claim(user_id: str, coverage_id: str, *, by_system: bool = False) -> dict:
    cover = await store.get("capital_coverages", coverage_id, user_id=user_id)
    if cover is None:
        raise CapitalError("Cover not found.", 404)
    if cover["status"] != "active":
        raise CapitalError(f"This cover is {cover['status']}.", 409)
    outcome, event = await _loss_event(cover)
    order = await order_store.get_order(user_id, cover["order_id"])
    if order is None or order.get("verification_status") != "verified":
        outcome = "none"
    amount = await _claim_amount(cover) if outcome == "eligible" else 0
    if outcome == "eligible" and amount <= 0:
        outcome, reason = "none", "Nothing is outstanding on the covered early payment."
    else:
        reason = {
            "eligible": f"{cover['platform']} reports the order as {(event or {}).get('data', {}).get('to')}.",
            "waiting": f"{cover['platform']} reports a dispute; the claim waits for its outcome.",
            "none": "The platform hasn't reported a cancellation or refund on this order since cover started.",
        }[outcome]
    status = {"eligible": "eligible", "waiting": "waiting", "none": "ineligible"}[outcome]
    try:
        claim = await store.insert("capital_claims", user_id, {
            "coverage_id": coverage_id, "order_id": cover["order_id"], "platform": cover["platform"],
            "order_title": cover.get("order_title"), "kind": cover["kind"], "status": status,
            "live": status in ("eligible", "waiting"), "reason": reason, "amount_cents": amount, "paid_cents": 0,
            "loss_event": {"to": event["data"].get("to"), "at": event["created_at"], "source": event["data"].get("source")}
            if event else None,
            "opened_by": "system" if by_system else "user",
        })
    except store.Conflict:
        raise CapitalError("This cover already has an open claim.", 409)
    if status == "eligible":
        await _notify_operators("Insurance claim to review",
                                f"{cover['platform']} order {cover.get('order_title') or ''}: ${amount / 100:,.2f}")
        await repo.notify(user_id, "Insurance claim opened",
                          f"{reason} An operator will review it; payouts depend on the fund's balance.", "info")
    return claim


async def _pay_claim(claim: dict) -> dict:
    """Post the payout recorded on a claim in `paying` and finish it."""
    cover = await store.get("capital_coverages", claim["coverage_id"])
    pay = claim["payout_cents"]
    lines = [line("protection:payouts", pay), line("protection:cash", -pay)]
    adv = await store.get("capital_advances", cover["advance_id"]) if cover["kind"] == "advance" else None
    if adv is not None:
        # The fund repays the pool on the freelancer's behalf.
        recovered = min(pay, adv.get("written_off_cents", 0))
        lines += [line("pool:cash", pay)]
        if pay - recovered:
            lines += [line("pool:advances", -(pay - recovered))]
        if recovered:
            lines += [line("pool:losses", -recovered)]
    if pay:
        await ledger.post("protection_payout", lines, memo=f"Protection payout on claim {claim['id']}",
                          refs={"user_id": claim["user_id"], "claim_id": claim["id"]},
                          idem=f"claim:{claim['id']}:payout", check=ledger.require_non_negative("protection:cash"))
    if adv is not None and adv.get("covered_by_claim") != claim["id"]:
        covered = adv.get("principal_covered_cents", 0) + pay
        recovered = min(pay, adv.get("written_off_cents", 0))
        fields = {"principal_covered_cents": covered, "covered_by_claim": claim["id"],
                  "written_off_cents": adv.get("written_off_cents", 0) - recovered}
        if adv["principal_cents"] - adv.get("principal_repaid_cents", 0) - covered <= 0:
            fields.update(status="covered", open=False, closed_at=store.now(), fee_waived_cents=_fee_due(adv))
        await _update("capital_advances", adv, fields)
    await _update("capital_coverages", cover, {"status": "paid" if pay >= claim["amount_cents"] else "claimed"})
    return await _update("capital_claims", claim, {"status": "paid", "live": False, "paid_cents": pay,
                                                   "paid_at": store.now()})


async def review_claim(reviewer: dict, claim_id: str, approve: bool, note: str) -> dict:
    claim = await store.get("capital_claims", claim_id)
    if claim is None:
        raise CapitalError("Claim not found.", 404)
    if claim["status"] == "paying":
        return await _pay_claim(claim)
    if claim["status"] not in ("eligible", "waiting"):
        raise CapitalError(f"This claim is {claim['status']}.", 409)
    note = note.strip()[:300]
    if not approve:
        claim = await _update("capital_claims", claim, {"status": "denied", "live": False, "review_note": note,
                                                        "reviewed_by": reviewer.get("email"), "reviewed_at": store.now()})
        await repo.notify(claim["user_id"], "Insurance claim not approved", note or "Contact support for details.", "warning")
        return claim
    cover = await store.get("capital_coverages", claim["coverage_id"])
    outcome, _ = await _loss_event(cover)
    if outcome != "eligible":
        raise CapitalError("The platform no longer reports an eligible loss on this order.", 409)
    fund = ledger.usd(await ledger.balances(), "protection:cash")
    amount = min(claim["amount_cents"], await _claim_amount(cover))
    payout = max(0, min(amount, fund))
    claim = await _update("capital_claims", claim, {
        "status": "paying", "payout_cents": payout, "shortfall_cents": amount - payout, "review_note": note,
        "reviewed_by": reviewer.get("email"), "reviewed_at": store.now()})
    claim = await _pay_claim(claim)
    message = (f"${payout / 100:,.2f} paid" + (f"; ${(amount - payout) / 100:,.2f} couldn't be paid because the fund "
                                               "balance was too low" if amount > payout else "") + " (simulated).")
    await repo.notify(claim["user_id"], "Insurance claim paid", message, "success")
    await repo.log_activity(reviewer["id"], "Capital", f"Approved claim {claim_id}: {message}")
    return claim


# --------------------------------------------------------------------------- #
# Scheduled jobs and reconciliation
# --------------------------------------------------------------------------- #
async def reconcile() -> dict:
    """Finish money-moving steps interrupted between their two writes."""
    fixed = 0
    for adv in await store.find("capital_advances", {"status": "disbursing"}):
        try:
            await _disburse(adv)
            fixed += 1
        except CapitalError:
            fixed += 1  # cancelled with a reason
    for adv in await store.find("capital_advances", {"open": True}) + await store.find(
            "capital_advances", {"status": {"$in": ["repaid"]}}):
        for rep in adv.get("repayments", []):
            if not rep.get("posted"):
                await _post_repayment(adv, rep)
                adv = await _mark_repayment_posted(adv, rep["id"])
                fixed += 1
    for claim in await store.find("capital_claims", {"status": "paying"}):
        await _pay_claim(claim)
        fixed += 1
    return {"reconciled": fixed}


async def run_jobs() -> dict:
    """Expire quotes, age advances (overdue, default), open claims on
    platform-reported losses, expire cover. Safe to run any time."""
    now = store.now()
    counts = {"quotesExpired": 0, "overdue": 0, "defaulted": 0, "claimsOpened": 0, "coversExpired": 0}
    counts.update(await reconcile())
    for adv in await store.find("capital_advances", {"status": "quoted", "quote_expires_at": {"$lte": now}}):
        await _update("capital_advances", adv, {"status": "expired"})
        counts["quotesExpired"] += 1

    # Open claims wherever the platform reported a loss on covered work.
    for cover in await store.find("capital_coverages", {"status": "active"}, limit=5000):
        outcome, _ = await _loss_event(cover)
        if outcome == "eligible" and not await store.find("capital_claims", {"coverage_id": cover["id"], "live": True}, limit=1):
            try:
                await open_claim(cover["user_id"], cover["id"], by_system=True)
                counts["claimsOpened"] += 1
            except CapitalError:
                pass
        elif cover["kind"] == "standalone" and cover.get("ends_at") and store.aware(cover["ends_at"]) <= now:
            await _update("capital_coverages", cover, {"status": "expired"})
            counts["coversExpired"] += 1

    for adv in await store.find("capital_advances", {"status": {"$in": ["active", "overdue"]}}, limit=5000):
        due = store.aware(adv.get("due_at"))
        if due is None or due > now:
            continue
        if adv["status"] == "active":
            adv = await _update("capital_advances", adv, {"status": "overdue"})
            counts["overdue"] += 1
            await repo.notify(adv["user_id"], "Early payment overdue",
                              f"Repay ${(_principal_due(adv) + _fee_due(adv)) / 100:,.2f} within "
                              f"{adv['grace_days']} days to avoid default.", "warning")
        if now >= due + timedelta(days=adv["grace_days"]):
            # A live claim means protection may settle it; don't write it off yet.
            if adv.get("coverage_id") and await store.find("capital_claims", {"coverage_id": adv["coverage_id"],
                                                                              "live": True}, limit=1):
                continue
            loss = _principal_due(adv)
            if loss > 0:
                await ledger.post("advance_written_off", [line("pool:losses", loss), line("pool:advances", -loss)],
                                  memo=f"Write-off of early payment {adv['id']}",
                                  refs={"user_id": adv["user_id"], "advance_id": adv["id"]},
                                  idem=f"advance:{adv['id']}:writeoff")
            await _update("capital_advances", adv, {"status": "defaulted", "written_off_cents": loss,
                                                    "defaulted_at": now})
            counts["defaulted"] += 1
            await repo.notify(adv["user_id"], "Early payment in default",
                              "You can still repay it; new early payments are paused until you do.", "warning")
    # Marketplace raises and repayment agreements share this ledger and schedule.
    from . import market
    counts.update(await market.run_jobs())
    return counts
