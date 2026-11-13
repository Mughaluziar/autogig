"""Investment marketplace: raises, investments, agreements, distributions.

SIMULATED SETTLEMENT, like the rest of the capital program: the ledger
records every movement a licensed partner would execute; no money moves.

Freelancers and agencies raise money in one of two shapes:
  * project funding   — borrow up to MAX_RAISE_CENTS (hire, buy equipment,
                        expand) and repay principal plus a flat return in
                        monthly installments over 3–12 months;
  * revenue sharing   — investors receive a fixed share of the business's
                        eligible revenue for a fixed period, capped at
                        REV_CAP_BPS of what they put in.

Eligible revenue is never self-reported: it is the value of orders that the
marketplace's own API verified and reported completed during the agreement.
Each raise carries a risk grade computed from that same verified track
record. Investors (identity verified, accredited attestation, risk
disclosure acknowledged — capital.service.investor_check) invest from their
Autopilot balance (banking.py) into the raise's escrow; when the raise
closes the escrow is disbursed to the business, or refunded if it fell short.
The Platform Index spreads one investment evenly across the open raises
graded A or B.

Money-moving steps follow intent -> idempotent ledger post -> mark done, so
run_jobs() can finish anything interrupted between those writes.
"""
import logging
from datetime import timedelta
from uuid import uuid4

from .. import db, repo
from ..orders import store as order_store
from . import ledger, store
from .ledger import LedgerRejected, line
from .policy import POOL_CURRENCY, bps_of
from .service import CapitalError, _iso, _notify_operators, get_profile, investor_check, to_cents

log = logging.getLogger("autopilot.capital.market")

KINDS = ("project_funding", "revenue_share")
MAX_RAISE_CENTS = 10_000_00
MIN_RAISE_CENTS = 500_00
MIN_INVESTMENT_CENTS = 25_00
RAISE_DAYS = 30
# A raise can be accepted early once it reaches this share of its target.
MIN_CLOSE_BPS = 5_000
ORIGINATION_FEE_BPS = 200
# Flat return over the term for project funding, by risk grade.
PROJECT_RATE_BPS = {"A": 600, "B": 800, "C": 1_000, "D": 1_300, "E": 1_600}
TERM_MONTHS = (3, 6, 9, 12)
REV_SHARE_MIN_BPS = 200
REV_SHARE_MAX_BPS = 2_000
REV_PERIOD_MONTHS = (6, 12, 18, 24, 36)
# Revenue-share investors stop receiving payments at 1.5× what they put in.
REV_CAP_BPS = 15_000
# Installments this late put a project-funding agreement in default.
DEFAULT_AFTER_DAYS = 60
MONTH = timedelta(days=30)
HIGH_GRADES = ("A", "B")
USE_OF_FUNDS = ("hiring", "equipment", "expansion", "marketing", "software", "working_capital", "other")
LIVE_LISTING = ("open", "disbursing", "refunding")
GRADE_NOTES = {
    "A": "Long, verified track record with few cancellations.",
    "B": "Solid verified track record.",
    "C": "Some verified history; moderate risk.",
    "D": "Short verified history; higher risk.",
    "E": "Little or no verified history; highest risk.",
}


def wallet(user_id: str) -> str:
    return f"wallet:{user_id}"


def escrow(listing_id: str) -> str:
    return f"escrow:{listing_id}"


# --------------------------------------------------------------------------- #
# Verified track record and risk grade
# --------------------------------------------------------------------------- #
def _order_date(order: dict):
    return store.aware(order.get("order_created_at") or order.get("sort_at") or order.get("detected_at")
                       or order.get("created_at"))


def _usd_cents(order: dict) -> int:
    if (order.get("currency") or "").upper() != POOL_CURRENCY:
        return 0
    return max(0, to_cents(order.get("amount")) or 0)


async def verified_orders(user_id: str) -> list[dict]:
    return await order_store.list_orders(user_id, {"verification_status": "verified"}, limit=2000)


async def eligible_revenue_cents(user_id: str, since, until) -> int:
    """Completed, API-verified USD orders dated inside [since, until)."""
    total = 0
    for order in await verified_orders(user_id):
        when = _order_date(order)
        if order.get("status") == "completed" and when is not None and since <= when < until:
            total += _usd_cents(order)
    return total


def grade_for(score: int) -> str:
    return "A" if score >= 80 else "B" if score >= 60 else "C" if score >= 40 else "D" if score >= 20 else "E"


async def track_record(user_id: str) -> dict:
    """What the platforms' APIs have verified about this business. Nothing
    self-reported counts toward the grade."""
    orders = [o for o in await verified_orders(user_id) if o.get("status") not in ("offer", "unknown")]
    completed = [o for o in orders if o.get("status") == "completed"]
    losses = [o for o in orders if o.get("status") in ("cancelled", "refunded", "disputed")]
    completed_cents = sum(_usd_cents(o) for o in completed)
    active_cents = sum(_usd_cents(o) for o in orders if o.get("status") in ("active", "delivered"))
    year_ago = store.now() - timedelta(days=365)
    trailing = sum(_usd_cents(o) for o in completed if (_order_date(o) or year_ago) >= year_ago)
    platforms = sorted({o.get("platform") for o in orders if o.get("platform")})
    dates = [d for d in (_order_date(o) for o in orders) if d is not None]
    loss_rate = len(losses) / len(orders) if orders else 0.0

    score = 0
    score += 40 if completed_cents >= 50_000_00 else 30 if completed_cents >= 10_000_00 else \
        20 if completed_cents >= 2_000_00 else 10 if completed_cents > 0 else 0
    score += 25 if len(completed) >= 20 else 15 if len(completed) >= 5 else 8 if completed else 0
    if orders:
        score += 25 if loss_rate <= 0.05 else 15 if loss_rate <= 0.15 else 0
    score += 10 if len(platforms) >= 2 else 5 if platforms else 0
    grade = grade_for(score)
    return {
        "verifiedOrders": len(orders), "completedOrders": len(completed), "completedValueCents": completed_cents,
        "trailingYearCents": trailing, "activeValueCents": active_cents, "lossRate": round(loss_rate, 4),
        "platforms": platforms, "firstOrderAt": _iso(min(dates)) if dates else None,
        "score": score, "grade": grade, "gradeNote": GRADE_NOTES[grade], "computedAt": _iso(store.now()),
    }


# --------------------------------------------------------------------------- #
# Listings
# --------------------------------------------------------------------------- #
def _clean_text(value: str, limit: int) -> str:
    return " ".join((value or "").split())[:limit]


def _validate_terms(kind: str, terms: dict) -> dict:
    if kind == "project_funding":
        months = int(terms.get("term_months") or 0)
        if months not in TERM_MONTHS:
            raise CapitalError(f"Choose a term of {', '.join(map(str, TERM_MONTHS))} months.")
        return {"term_months": months}
    share = int(terms.get("share_bps") or 0)
    months = int(terms.get("period_months") or 0)
    if not REV_SHARE_MIN_BPS <= share <= REV_SHARE_MAX_BPS:
        raise CapitalError(f"Revenue share must be between {REV_SHARE_MIN_BPS / 100:g}% and {REV_SHARE_MAX_BPS / 100:g}%.")
    if months not in REV_PERIOD_MONTHS:
        raise CapitalError(f"Choose a period of {', '.join(map(str, REV_PERIOD_MONTHS))} months.")
    return {"share_bps": share, "period_months": months, "cap_bps": REV_CAP_BPS}


def _validate_uses(uses: list[dict], target: int) -> list[dict]:
    out = []
    for use in uses[:8]:
        category = use.get("category")
        amount = int(use.get("amount_cents") or 0)
        if category not in USE_OF_FUNDS or amount <= 0:
            raise CapitalError("Each use of funds needs a category and an amount.")
        out.append({"category": category, "amount_cents": amount, "note": _clean_text(use.get("note", ""), 120)})
    if sum(u["amount_cents"] for u in out) > target:
        raise CapitalError("The uses of funds add up to more than you're raising.")
    return out


async def _publish_reasons(user_id: str, record: dict) -> list[str]:
    reasons = []
    profile = await get_profile(user_id)
    if profile["kyc"].get("status") != "verified":
        reasons.append("Verify your identity before publishing a raise.")
    if not record["verifiedOrders"]:
        reasons.append("Connect a marketplace account with API verification; investors need at least one verified order.")
    if await store.find("capital_advances", {"user_id": user_id, "status": "defaulted"}, limit=1):
        reasons.append("Repay your defaulted early payment first.")
    if [a for a in await store.find("market_agreements", {"user_id": user_id}, limit=50) if a["status"] == "defaulted"]:
        reasons.append("A funding agreement of yours is in default.")
    return reasons


async def create_listing(user: dict, *, kind: str, title: str, summary: str, display_name: str, target_cents: int,
                         min_investment_cents: int, terms: dict, uses: list[dict], publish: bool) -> dict:
    if kind not in KINDS:
        raise CapitalError("Choose project funding or revenue sharing.")
    title = _clean_text(title, 80)
    if len(title) < 5:
        raise CapitalError("Give your raise a title of at least 5 characters.")
    if not MIN_RAISE_CENTS <= target_cents <= MAX_RAISE_CENTS:
        raise CapitalError(f"Raise between ${MIN_RAISE_CENTS / 100:,.0f} and ${MAX_RAISE_CENTS / 100:,.0f}.")
    if not MIN_INVESTMENT_CENTS <= min_investment_cents <= target_cents:
        raise CapitalError(f"The minimum investment must be at least ${MIN_INVESTMENT_CENTS / 100:,.0f} and no more than the target.")
    clean_terms = _validate_terms(kind, terms)
    clean_uses = _validate_uses(uses, target_cents)
    live = [x for x in await store.find("market_listings", {"user_id": user["id"]}, limit=100)
            if x["status"] in LIVE_LISTING]
    if live:
        raise CapitalError("You already have a raise open. Close it before starting another.", 409)
    account = await db.find_user(user["email"]) or {}
    name = _clean_text(display_name, 60) or account.get("company") or account.get("name") or "Freelancer"
    record = await track_record(user["id"])
    listing = await store.insert("market_listings", user["id"], {
        "kind": kind, "title": title, "summary": _clean_text(summary, 600), "display_name": name,
        "target_cents": target_cents, "min_investment_cents": min_investment_cents, "terms": clean_terms,
        "uses": clean_uses, "status": "draft", "track_record": record, "grade": record["grade"],
        "rate_bps": PROJECT_RATE_BPS[record["grade"]] if kind == "project_funding" else None,
        "funded_cents": 0, "agreement_id": None, "opens_at": None, "closes_at": None,
        "settlement": ledger.SETTLEMENT,
    })
    await repo.log_activity(user["id"], "Marketplace", f"Drafted a {kind.replace('_', ' ')} raise: {title}")
    if publish:
        listing = await publish_listing(user["id"], listing["id"])
    return listing


async def _update(coll: str, record: dict, fields: dict) -> dict:
    updated = await store.update(coll, record["id"], {**fields, "updated_at": store.now()},
                                 expect_version=record["version"])
    if updated is None:
        raise CapitalError("This record changed while you were working on it. Refresh and try again.", 409)
    return updated


async def publish_listing(user_id: str, listing_id: str) -> dict:
    listing = await store.get("market_listings", listing_id, user_id=user_id)
    if listing is None:
        raise CapitalError("Raise not found.", 404)
    if listing["status"] != "draft":
        raise CapitalError(f"This raise is {listing['status']}.", 409)
    record = await track_record(user_id)
    reasons = await _publish_reasons(user_id, record)
    if reasons:
        raise CapitalError("This raise can't be published yet.", 422, reasons)
    others = [x for x in await store.find("market_listings", {"user_id": user_id}, limit=100)
              if x["status"] in LIVE_LISTING and x["id"] != listing_id]
    if others:
        raise CapitalError("You already have a raise open.", 409)
    now = store.now()
    listing = await _update("market_listings", listing, {
        "status": "open", "opens_at": now, "closes_at": now + timedelta(days=RAISE_DAYS),
        "track_record": record, "grade": record["grade"],
        "rate_bps": PROJECT_RATE_BPS[record["grade"]] if listing["kind"] == "project_funding" else None,
    })
    await repo.log_activity(user_id, "Marketplace", f"Opened raise {listing['title']} (simulated)")
    await _notify_operators("New marketplace raise", f"{listing['display_name']}: {listing['title']}.")
    return listing


async def raised_cents(listing: dict, bal: dict | None = None) -> int:
    if listing["status"] in LIVE_LISTING:
        bal = bal if bal is not None else await ledger.balances()
        return ledger.usd(bal, escrow(listing["id"]))
    return listing.get("funded_cents", 0)


async def listing_investments(listing_id: str) -> list[dict]:
    return [i for i in await store.find("market_investments", {"listing_id": listing_id}, limit=5000)
            if i["status"] in ("escrow", "active", "completed", "defaulted")]


def expected_return(listing: dict, amount_cents: int) -> dict:
    """What an investment returns if the business pays as agreed."""
    if listing["kind"] == "project_funding":
        rate = listing.get("rate_bps") or PROJECT_RATE_BPS[listing["grade"]]
        return {"kind": "fixed", "totalCents": amount_cents + bps_of(amount_cents, rate), "rateBps": rate,
                "months": listing["terms"]["term_months"]}
    return {"kind": "capped", "maxCents": bps_of(amount_cents, REV_CAP_BPS), "shareBps": listing["terms"]["share_bps"],
            "months": listing["terms"]["period_months"]}


def _owner_estimate(listing: dict) -> dict | None:
    """Revenue-share scenario from the trailing year of verified revenue."""
    if listing["kind"] != "revenue_share":
        return None
    trailing = listing["track_record"].get("trailingYearCents", 0)
    monthly = trailing // 12
    months = listing["terms"]["period_months"]
    payable = bps_of(monthly * months, listing["terms"]["share_bps"])
    cap = bps_of(listing["target_cents"], REV_CAP_BPS)
    return {"monthlyRevenueCents": monthly, "projectedPaidCents": min(payable, cap), "capCents": cap}


# --------------------------------------------------------------------------- #
# Investing
# --------------------------------------------------------------------------- #
async def invest(user_id: str, listing_id: str, amount_cents: int, idem: str, *, via: str = "direct",
                 min_override: int | None = None) -> dict:
    reasons = investor_check(await get_profile(user_id))
    if reasons:
        raise CapitalError("You can't invest yet.", 403, reasons)
    existing = await store.find("market_investments", {"user_id": user_id, "idem": idem}, limit=1)
    if existing:
        return existing[0]
    listing = await store.get("market_listings", listing_id)
    if listing is None or listing["status"] == "draft":
        raise CapitalError("Raise not found.", 404)
    if listing["user_id"] == user_id:
        raise CapitalError("You can't invest in your own raise.", 403)
    if listing["status"] != "open" or store.aware(listing["closes_at"]) <= store.now():
        raise CapitalError("This raise isn't taking investments.", 409)
    minimum = listing["min_investment_cents"] if min_override is None else min_override
    if amount_cents < minimum:
        raise CapitalError(f"The minimum investment is ${minimum / 100:,.2f}.")
    try:
        inv = await store.insert("market_investments", user_id, {
            "listing_id": listing_id, "owner_id": listing["user_id"], "amount_cents": amount_cents, "via": via,
            "status": "posting", "idem": idem, "kind": listing["kind"], "title": listing["title"],
            "grade": listing["grade"], "settlement": ledger.SETTLEMENT,
        })
    except store.Conflict:
        return (await store.find("market_investments", {"user_id": user_id, "idem": idem}, limit=1))[0]

    target = listing["target_cents"]

    def check(after: dict) -> None:
        if ledger.usd(after, wallet(user_id)) < 0:
            raise LedgerRejected("Not enough in your Autopilot balance. Add money in Banking first.")
        if ledger.usd(after, escrow(listing_id)) > target:
            left = target - (ledger.usd(after, escrow(listing_id)) - amount_cents)
            raise LedgerRejected(f"Only ${max(0, left) / 100:,.2f} is left to raise.")

    try:
        await ledger.post("market_investment", [line(wallet(user_id), -amount_cents), line(escrow(listing_id), amount_cents)],
                          memo=f"Investment in {listing['title']}",
                          refs={"user_id": user_id, "users": [user_id, listing["user_id"]], "listing_id": listing_id,
                                "investment_id": inv["id"]},
                          idem=f"mkt:invest:{inv['id']}", check=check)
    except LedgerRejected as exc:
        await _update("market_investments", inv, {"status": "rejected", "reject_reason": str(exc)})
        raise CapitalError(str(exc), 409)
    inv = await _update("market_investments", inv, {"status": "escrow"})
    await repo.log_activity(user_id, "Marketplace", f"Invested ${amount_cents / 100:,.2f} in {listing['title']} (simulated)")
    await repo.notify(listing["user_id"], "New investment in your raise",
                      f"${amount_cents / 100:,.2f} committed to {listing['title']} (simulated).", "success")
    if await raised_cents(listing) >= target:
        try:
            await disburse(await store.get("market_listings", listing_id))
        except CapitalError as exc:  # another investment closed it first; the job finishes any leftover step
            log.info("auto-disburse of %s deferred: %s", listing_id, exc)
    return inv


async def index_summary(exclude_user: str | None = None) -> dict:
    bal = await ledger.balances()
    rows = []
    for listing in await store.find("market_listings", {"status": "open"}, limit=500):
        if listing["grade"] not in HIGH_GRADES or listing["user_id"] == exclude_user:
            continue
        if store.aware(listing["closes_at"]) <= store.now():
            continue
        left = listing["target_cents"] - ledger.usd(bal, escrow(listing["id"]))
        if left >= MIN_INVESTMENT_CENTS:
            rows.append((listing, left))
    return {"listings": rows, "count": len(rows), "capacityCents": sum(left for _, left in rows)}


async def invest_index(user_id: str, amount_cents: int, idem: str) -> dict:
    """Spread one investment evenly across open A/B raises."""
    reasons = investor_check(await get_profile(user_id))
    if reasons:
        raise CapitalError("You can't invest yet.", 403, reasons)
    summary = await index_summary(exclude_user=user_id)
    rows = summary["listings"]
    if not rows:
        raise CapitalError("No high-rated raises are open right now. You can fund the early-payment pool instead.", 409)
    if amount_cents < MIN_INVESTMENT_CENTS:
        raise CapitalError(f"The minimum is ${MIN_INVESTMENT_CENTS / 100:,.0f}.")
    if ledger.usd(await ledger.balances(), wallet(user_id)) < amount_cents:
        raise CapitalError("Not enough in your Autopilot balance. Add money in Banking first.", 409)
    # Most-funded first, so the spread completes raises rather than starting new ones.
    rows.sort(key=lambda r: (r[0]["grade"], r[1]))
    rows = rows[:max(1, min(len(rows), amount_cents // MIN_INVESTMENT_CENTS))]
    plan: dict[str, int] = {}
    remaining = amount_cents
    capacity = {listing["id"]: left for listing, left in rows}
    while remaining >= MIN_INVESTMENT_CENTS or (remaining and plan):
        open_ids = [lid for lid, left in capacity.items() if left > 0]
        if not open_ids:
            break
        share = max(remaining // len(open_ids), 1)
        moved = 0
        for lid in open_ids:
            take = min(share, capacity[lid], remaining - moved)
            if take <= 0:
                continue
            plan[lid] = plan.get(lid, 0) + take
            capacity[lid] -= take
            moved += take
        remaining -= moved
        if moved == 0:
            break
    # Drop allocations too small to stand alone; that money stays in the wallet.
    plan = {lid: amt for lid, amt in plan.items() if amt >= MIN_INVESTMENT_CENTS}
    if not plan:
        raise CapitalError("That amount is too small to spread across the index.", 422)
    placed, results = 0, []
    for lid, amt in plan.items():
        try:
            inv = await invest(user_id, lid, amt, f"{idem}-{lid}"[:80], via="index", min_override=MIN_INVESTMENT_CENTS)
            placed += amt
            results.append(inv)
        except CapitalError as exc:
            log.info("index allocation to %s skipped: %s", lid, exc)
    if not results:
        raise CapitalError("The high-rated raises filled up before your investment could be placed. Try again.", 409)
    return {"placedCents": placed, "keptCents": amount_cents - placed, "investments": results}


# --------------------------------------------------------------------------- #
# Closing a raise: disburse or refund
# --------------------------------------------------------------------------- #
async def disburse(listing: dict) -> dict:
    if listing["status"] == "open":
        listing = await _update("market_listings", listing, {"status": "disbursing"})
    if listing["status"] != "disbursing":
        return listing
    investments = await listing_investments(listing["id"])
    owner = listing["user_id"]
    lid = listing["id"]
    funded = {"cents": 0, "fee": 0}

    def lines(bal: dict) -> list[dict]:
        amount = ledger.usd(bal, escrow(lid))
        if amount <= 0:
            raise LedgerRejected("Nothing to disburse.")
        fee = bps_of(amount, ORIGINATION_FEE_BPS)
        funded.update(cents=amount, fee=fee)
        return [line(escrow(lid), -amount), line(wallet(owner), amount - fee), line("platform:cash", fee)]

    entry = await ledger.post("market_disbursed", lines, memo=f"Raise funded: {listing['title']}",
                              refs={"user_id": owner, "users": sorted({owner, *(i["user_id"] for i in investments)}),
                                    "listing_id": lid},
                              idem=f"mkt:disburse:{lid}")
    if not funded["cents"]:  # replayed: read the amounts from the original entry
        for item in entry["lines"]:
            if item["account"] == escrow(lid):
                funded["cents"] = -item["amount"]
            elif item["account"] == "platform:cash":
                funded["fee"] = item["amount"]
    agreement = await _create_agreement(listing, funded["cents"], funded["fee"])
    for inv in investments:
        if inv["status"] == "escrow":
            await _update("market_investments", inv, {"status": "active", "agreement_id": agreement["id"]})
    listing = await _update("market_listings", listing, {
        "status": "active", "funded_cents": funded["cents"], "fee_cents": funded["fee"],
        "agreement_id": agreement["id"], "funded_at": store.now()})
    await repo.notify(owner, "Your raise is funded (simulated)",
                      f"${(funded['cents'] - funded['fee']) / 100:,.2f} is in your Autopilot balance.", "success")
    for investor_id in {i["user_id"] for i in investments}:
        await repo.notify(investor_id, "A raise you backed is funded",
                          f"{listing['title']} closed. Repayments go to your Autopilot balance.", "success")
    return listing


async def _create_agreement(listing: dict, principal: int, fee: int) -> dict:
    found = await store.find("market_agreements", {"listing_id": listing["id"]}, limit=1)
    if found:
        return found[0]
    start = store.now()
    fields = {"listing_id": listing["id"], "kind": listing["kind"], "title": listing["title"],
              "display_name": listing["display_name"], "grade": listing["grade"], "principal_cents": principal,
              "fee_cents": fee, "start_at": start, "status": "active", "payments": [], "settlement": ledger.SETTLEMENT}
    if listing["kind"] == "project_funding":
        rate = listing.get("rate_bps") or PROJECT_RATE_BPS[listing["grade"]]
        total = principal + bps_of(principal, rate)
        months = listing["terms"]["term_months"]
        each = total // months
        schedule = [{"n": i + 1, "due_at": start + MONTH * (i + 1),
                     "amount_cents": each + (total - each * months if i == months - 1 else 0)} for i in range(months)]
        fields.update(rate_bps=rate, total_due_cents=total, schedule=schedule, end_at=schedule[-1]["due_at"],
                      term_months=months)
    else:
        cap = bps_of(principal, REV_CAP_BPS)
        months = listing["terms"]["period_months"]
        fields.update(share_bps=listing["terms"]["share_bps"], cap_cents=cap, total_due_cents=cap, schedule=[],
                      end_at=start + MONTH * months, period_months=months)
    try:
        return await store.insert("market_agreements", listing["user_id"], fields)
    except store.Conflict:
        return (await store.find("market_agreements", {"listing_id": listing["id"]}, limit=1))[0]


async def refund(listing: dict, final_status: str) -> dict:
    if listing["status"] in ("open", "draft"):
        listing = await _update("market_listings", listing, {"status": "refunding", "final_status": final_status})
    if listing["status"] != "refunding":
        return listing
    for inv in await store.find("market_investments", {"listing_id": listing["id"], "status": "escrow"}, limit=5000):
        amount = inv["amount_cents"]
        await ledger.post("market_refund", [line(escrow(listing["id"]), -amount), line(wallet(inv["user_id"]), amount)],
                          memo=f"Refund: {listing['title']} didn't close",
                          refs={"user_id": inv["user_id"], "users": [inv["user_id"], listing["user_id"]],
                                "listing_id": listing["id"], "investment_id": inv["id"]},
                          idem=f"mkt:refund:{inv['id']}")
        await _update("market_investments", inv, {"status": "refunded"})
        await repo.notify(inv["user_id"], "Investment refunded",
                          f"{listing['title']} didn't close; ${amount / 100:,.2f} is back in your balance.", "info")
    return await _update("market_listings", listing, {"status": listing.get("final_status") or final_status})


async def close_listing(user_id: str, listing_id: str) -> dict:
    """The owner ends a raise: accept what's raised if it reached the
    minimum, otherwise refund every investor."""
    listing = await store.get("market_listings", listing_id, user_id=user_id)
    if listing is None:
        raise CapitalError("Raise not found.", 404)
    if listing["status"] == "draft":
        return await _update("market_listings", listing, {"status": "cancelled"})
    if listing["status"] != "open":
        raise CapitalError(f"This raise is {listing['status']}.", 409)
    raised = await raised_cents(listing)
    if raised and raised * 10_000 >= listing["target_cents"] * MIN_CLOSE_BPS:
        return await disburse(listing)
    return await refund(listing, "cancelled")


# --------------------------------------------------------------------------- #
# Agreements and repayments
# --------------------------------------------------------------------------- #
def paid_cents(agreement: dict) -> int:
    return sum(p["amount_cents"] for p in agreement.get("payments", []))


async def due_now(agreement: dict) -> dict:
    """What the business owes today, and how late it is."""
    now = store.now()
    paid = paid_cents(agreement)
    if agreement["kind"] == "project_funding":
        scheduled, overdue_since, cumulative = 0, None, 0
        for item in agreement["schedule"]:
            cumulative += item["amount_cents"]
            if store.aware(item["due_at"]) <= now:
                scheduled = cumulative
                if cumulative > paid and overdue_since is None:
                    overdue_since = store.aware(item["due_at"])
        nxt = next((i for i in agreement["schedule"] if store.aware(i["due_at"]) > now), None)
        return {"dueNowCents": max(0, scheduled - paid),
                "remainingCents": max(0, agreement["total_due_cents"] - paid),
                "daysLate": (now - overdue_since).days if overdue_since else 0,
                "nextDueAt": _iso(nxt["due_at"]) if nxt else None, "nextAmountCents": nxt["amount_cents"] if nxt else 0,
                "eligibleRevenueCents": None}
    start, end = store.aware(agreement["start_at"]), store.aware(agreement["end_at"])
    revenue = await eligible_revenue_cents(agreement["user_id"], start, min(now, end))
    accrued = min(agreement["cap_cents"], bps_of(revenue, agreement["share_bps"]))
    return {"dueNowCents": max(0, accrued - paid), "remainingCents": max(0, agreement["cap_cents"] - paid),
            "daysLate": 0, "nextDueAt": None, "nextAmountCents": 0, "eligibleRevenueCents": revenue}


def _split(amount: int, weights: list[tuple[str, int]]) -> dict[str, int]:
    """Pro-rata split with the largest-remainder method, so parts sum exactly."""
    total = sum(w for _, w in weights)
    if total <= 0:
        return {}
    parts = {k: amount * w // total for k, w in weights}
    remainders = sorted(weights, key=lambda kw: (amount * kw[1]) % total, reverse=True)
    for k, _ in remainders[: amount - sum(parts.values())]:
        parts[k] += 1
    return parts


async def pay(user_id: str, agreement_id: str, amount_cents: int, idem: str) -> dict:
    agreement = await store.get("market_agreements", agreement_id, user_id=user_id)
    if agreement is None:
        raise CapitalError("Agreement not found.", 404)
    if agreement["status"] not in ("active", "late", "defaulted"):
        raise CapitalError(f"This agreement is {agreement['status']}.", 409)
    if any(p.get("idem") == idem for p in agreement.get("payments", [])):
        return agreement
    remaining = agreement["total_due_cents"] - paid_cents(agreement)
    if amount_cents <= 0 or amount_cents > remaining:
        raise CapitalError(f"Pay between $0.01 and ${remaining / 100:,.2f}.")
    investments = [i for i in await store.find("market_investments", {"listing_id": agreement["listing_id"]}, limit=5000)
                   if i["status"] in ("active", "defaulted")]
    shares = _split(amount_cents, [(i["id"], i["amount_cents"]) for i in investments])
    by_id = {i["id"]: i for i in investments}
    payment = {"id": uuid4().hex, "amount_cents": amount_cents, "at": store.now(), "posted": False, "idem": idem}
    agreement = await _update("market_agreements", agreement, {"payments": [*agreement.get("payments", []), payment]})

    lines = [line(wallet(user_id), -amount_cents)] + [line(wallet(by_id[iid]["user_id"]), amt)
                                                      for iid, amt in shares.items() if amt]
    try:
        await ledger.post("market_repayment", lines, memo=f"Repayment on {agreement['title']}",
                          refs={"user_id": user_id, "agreement_id": agreement_id, "payment_id": payment["id"],
                                "users": sorted({user_id, *(i["user_id"] for i in investments)})},
                          idem=f"mkt:pay:{payment['id']}", check=ledger.require_non_negative(wallet(user_id)))
    except LedgerRejected:
        fresh = await store.get("market_agreements", agreement_id)
        await _update("market_agreements", fresh,
                      {"payments": [p for p in fresh["payments"] if p["id"] != payment["id"]]})
        raise CapitalError("Not enough in your Autopilot balance. Add money in Banking first.", 409)
    return await _finish_payment(agreement_id, payment["id"], shares, by_id)


async def _finish_payment(agreement_id: str, payment_id: str, shares: dict[str, int], by_id: dict[str, dict]) -> dict:
    agreement = await store.get("market_agreements", agreement_id)
    for iid, amt in shares.items():
        if not amt:
            continue
        try:
            await store.insert("market_distributions", by_id[iid]["user_id"], {
                "investment_id": iid, "payment_id": payment_id, "agreement_id": agreement_id,
                "investor_id": by_id[iid]["user_id"], "amount_cents": amt, "title": agreement["title"]})
        except store.Conflict:
            pass
    payments = [{**p, "posted": True} if p["id"] == payment_id else p for p in agreement["payments"]]
    fields: dict = {"payments": payments}
    done = sum(p["amount_cents"] for p in payments) >= agreement["total_due_cents"]
    if done:
        fields["status"] = "completed"
    elif agreement["status"] == "late":
        fields["status"] = "active"
    agreement = await _update("market_agreements", agreement, fields)
    if done:
        await _complete(agreement)
        for inv in by_id.values():
            fresh = await store.get("market_investments", inv["id"])
            if fresh and fresh["status"] in ("active", "defaulted"):
                await _update("market_investments", fresh, {"status": "completed"})
    for investor_id in {by_id[iid]["user_id"] for iid, amt in shares.items() if amt}:
        amount = sum(amt for iid, amt in shares.items() if by_id[iid]["user_id"] == investor_id)
        await repo.notify(investor_id, "Distribution received (simulated)",
                          f"${amount / 100:,.2f} from {agreement['title']} is in your Autopilot balance.", "success")
    await repo.log_activity(agreement["user_id"], "Marketplace",
                            f"Paid {agreement['title']}: ${sum(shares.values()) / 100:,.2f} (simulated)")
    return agreement


async def _complete(agreement: dict) -> None:
    """Mark the raise behind a finished agreement as repaid."""
    listing = await store.get("market_listings", agreement["listing_id"])
    if listing and listing["status"] == "active":
        await _update("market_listings", listing, {"status": "completed", "completed_at": store.now()})


# --------------------------------------------------------------------------- #
# Reads
# --------------------------------------------------------------------------- #
async def distributions_for(investor_id: str) -> list[dict]:
    return await store.find("market_distributions", {"investor_id": investor_id}, limit=5000)


async def portfolio(user_id: str) -> dict:
    investments = [i for i in await store.find("market_investments", {"user_id": user_id}, limit=5000)
                   if i["status"] not in ("posting", "rejected")]
    dists = await distributions_for(user_id)
    paid_by_inv: dict[str, int] = {}
    for d in dists:
        paid_by_inv[d["investment_id"]] = paid_by_inv.get(d["investment_id"], 0) + d["amount_cents"]
    listings = {}
    agreements = {}
    positions = []
    for inv in investments:
        listing = listings.get(inv["listing_id"]) or await store.get("market_listings", inv["listing_id"])
        listings[inv["listing_id"]] = listing
        agreement = None
        if inv.get("agreement_id"):
            agreement = agreements.get(inv["agreement_id"]) or await store.get("market_agreements", inv["agreement_id"])
            agreements[inv["agreement_id"]] = agreement
        expected = expected_return(listing, inv["amount_cents"]) if listing else None
        positions.append({"investment": inv, "listing": listing, "agreement": agreement,
                          "distributedCents": paid_by_inv.get(inv["id"], 0), "expected": expected})
    live = [p for p in positions if p["investment"]["status"] in ("escrow", "active", "defaulted", "completed")]
    invested = sum(p["investment"]["amount_cents"] for p in live)
    distributed = sum(p["distributedCents"] for p in positions)
    at_risk = sum(max(0, p["investment"]["amount_cents"] - p["distributedCents"]) for p in live
                  if p["investment"]["status"] in ("active", "defaulted"))
    by_grade: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    for p in live:
        if p["investment"]["status"] == "completed":
            continue
        by_grade[p["investment"]["grade"]] = by_grade.get(p["investment"]["grade"], 0) + p["investment"]["amount_cents"]
        by_kind[p["investment"]["kind"]] = by_kind.get(p["investment"]["kind"], 0) + p["investment"]["amount_cents"]
    return {
        "positions": positions, "distributions": dists,
        "totals": {"investedCents": invested, "distributedCents": distributed, "outstandingCents": at_risk,
                   "escrowCents": sum(p["investment"]["amount_cents"] for p in live if p["investment"]["status"] == "escrow"),
                   "positions": len(live),
                   "defaultedCents": sum(max(0, p["investment"]["amount_cents"] - p["distributedCents"]) for p in live
                                         if p["investment"]["status"] == "defaulted")},
        "risk": {"byGrade": by_grade, "byKind": by_kind},
    }


async def agreements_for(user_id: str) -> dict:
    mine = await store.find("market_agreements", {"user_id": user_id}, limit=200)
    backed_ids = {i["agreement_id"] for i in await store.find("market_investments", {"user_id": user_id}, limit=5000)
                  if i.get("agreement_id")}
    backed = [a for a in [await store.get("market_agreements", aid) for aid in backed_ids] if a]
    return {"borrower": mine, "investor": backed}


# --------------------------------------------------------------------------- #
# Scheduled jobs
# --------------------------------------------------------------------------- #
async def run_jobs() -> dict:
    """Close raises past their deadline, finish interrupted disbursements,
    refunds and repayments, and age repayment agreements."""
    now = store.now()
    counts = {"raisesClosed": 0, "raisesExpired": 0, "agreementsLate": 0, "agreementsDefaulted": 0,
              "agreementsCompleted": 0, "marketReconciled": 0}
    for listing in await store.find("market_listings", {"status": "disbursing"}, limit=500):
        await disburse(listing)
        counts["marketReconciled"] += 1
    for listing in await store.find("market_listings", {"status": "refunding"}, limit=500):
        await refund(listing, listing.get("final_status") or "expired")
        counts["marketReconciled"] += 1
    for listing in await store.find("market_listings", {"status": "open", "closes_at": {"$lte": now}}, limit=500):
        raised = await raised_cents(listing)
        if raised and raised * 10_000 >= listing["target_cents"] * MIN_CLOSE_BPS:
            await disburse(listing)
            counts["raisesClosed"] += 1
        else:
            await refund(listing, "expired")
            counts["raisesExpired"] += 1
            await repo.notify(listing["user_id"], "Raise closed without funding",
                              f"{listing['title']} didn't reach {MIN_CLOSE_BPS // 100}% of its target; investors were refunded.",
                              "warning")
    for agreement in await store.find("market_agreements", {"status": {"$in": ["active", "late"]}}, limit=5000):
        for payment in agreement.get("payments", []):
            if not payment.get("posted"):
                entry = await ledger.find_by_idem(f"mkt:pay:{payment['id']}")
                if entry is None:  # the debit never posted: drop the intent
                    agreement = await _update("market_agreements", agreement, {
                        "payments": [p for p in agreement["payments"] if p["id"] != payment["id"]]})
                else:
                    investments = {i["id"]: i for i in await store.find(
                        "market_investments", {"listing_id": agreement["listing_id"]}, limit=5000)}
                    by_user = {}
                    for item in entry["lines"]:
                        if item["amount"] > 0:
                            by_user[item["account"].removeprefix("wallet:")] = item["amount"]
                    shares = _split(sum(by_user.values()), [
                        (i["id"], i["amount_cents"]) for i in investments.values() if i["status"] in ("active", "defaulted")])
                    agreement = await _finish_payment(agreement["id"], payment["id"], shares, investments)
                counts["marketReconciled"] += 1
        if agreement["status"] not in ("active", "late"):
            continue
        due = await due_now(agreement)
        if agreement["kind"] == "project_funding":
            if due["daysLate"] >= DEFAULT_AFTER_DAYS:
                await _update("market_agreements", agreement, {"status": "defaulted", "defaulted_at": now})
                for inv in await store.find("market_investments", {"agreement_id": agreement["id"], "status": "active"}):
                    await _update("market_investments", inv, {"status": "defaulted"})
                    await repo.notify(inv["user_id"], "A funding agreement is in default",
                                      f"{agreement['title']} is {due['daysLate']} days late.", "warning")
                counts["agreementsDefaulted"] += 1
            elif due["daysLate"] > 0 and agreement["status"] == "active":
                await _update("market_agreements", agreement, {"status": "late"})
                await repo.notify(agreement["user_id"], "Repayment overdue",
                                  f"${due['dueNowCents'] / 100:,.2f} is due on {agreement['title']}.", "warning")
                counts["agreementsLate"] += 1
        elif store.aware(agreement["end_at"]) <= now and due["dueNowCents"] == 0:
            await _update("market_agreements", agreement, {"status": "completed", "completed_at": now})
            await _complete(agreement)
            for inv in await store.find("market_investments", {"agreement_id": agreement["id"], "status": "active"}):
                await _update("market_investments", inv, {"status": "completed"})
            counts["agreementsCompleted"] += 1
    return counts
