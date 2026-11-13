"""Investment marketplace API. SIMULATED SETTLEMENT — no money moves.

Any signed-in role:
GET  /api/marketplace/overview                    index, stats, my balance and eligibility
GET  /api/marketplace/listings                    open raises (?kind, ?grade, ?q, ?include=funded)
GET  /api/marketplace/listings/{id}               one raise
GET  /api/marketplace/my-listings                 my raises, any status
GET  /api/marketplace/track-record                my verified track record and risk grade
POST /api/marketplace/listings                    create (and optionally publish) a raise
POST /api/marketplace/listings/{id}/publish
POST /api/marketplace/listings/{id}/close         accept funds (≥50% raised) or refund
POST /api/marketplace/listings/{id}/invest        {amountCents, idempotencyKey, acceptRisk}
POST /api/marketplace/index/invest                spread across open A/B raises
GET  /api/marketplace/portfolio                   positions, distributions, risk
GET  /api/marketplace/agreements                  as borrower and as investor
GET  /api/marketplace/agreements/{id}
POST /api/marketplace/agreements/{id}/pay         {amountCents, idempotencyKey}
Platform owners:
POST /api/marketplace/admin/run-jobs
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..auth import current_user, require_owner
from ..capital import banking, ledger, market, service, store
from .capital import _call, _iso, _out

router = APIRouter(prefix="/marketplace", tags=["marketplace"])

IDEM = dict(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


def _terms_out(terms: dict) -> dict:
    return {market_key: terms[k] for k, market_key in
            (("term_months", "termMonths"), ("share_bps", "shareBps"), ("period_months", "periodMonths"),
             ("cap_bps", "capBps")) if k in terms}


async def listing_out(listing: dict, viewer_id: str, bal: dict, *, detail: bool = False) -> dict:
    raised = await market.raised_cents(listing, bal)
    investments = await market.listing_investments(listing["id"]) if detail or listing["status"] != "draft" else []
    mine = [i for i in investments if i["user_id"] == viewer_id]
    closes = store.aware(listing.get("closes_at"))
    days_left = max(0, (closes - store.now()).days) if closes and listing["status"] == "open" else None
    out = {
        "id": listing["id"], "kind": listing["kind"], "title": listing["title"], "summary": listing["summary"],
        "displayName": listing["display_name"], "targetCents": listing["target_cents"],
        "minInvestmentCents": listing["min_investment_cents"], "terms": _terms_out(listing["terms"]),
        "uses": [_out(u, drop=()) for u in listing.get("uses", [])], "status": listing["status"],
        "grade": listing["grade"], "gradeNote": market.GRADE_NOTES[listing["grade"]], "rateBps": listing.get("rate_bps"),
        "trackRecord": listing["track_record"], "raisedCents": raised,
        "remainingCents": max(0, listing["target_cents"] - raised) if listing["status"] == "open" else 0,
        "progressBps": min(10_000, raised * 10_000 // listing["target_cents"]) if listing["target_cents"] else 0,
        "investors": len({i["user_id"] for i in investments}), "opensAt": _iso(listing.get("opens_at")),
        "closesAt": _iso(closes), "daysLeft": days_left, "mine": listing["user_id"] == viewer_id,
        "myInvestedCents": sum(i["amount_cents"] for i in mine), "agreementId": listing.get("agreement_id"),
        "fundedCents": listing.get("funded_cents", 0), "fundedAt": _iso(listing.get("funded_at")),
        "example": market.expected_return(listing, 1_000_00), "createdAt": _iso(listing.get("created_at")),
        "settlement": ledger.SETTLEMENT,
    }
    if detail:
        out["ownerEstimate"] = market._owner_estimate(listing)
        out["minCloseBps"] = market.MIN_CLOSE_BPS
        out["originationFeeBps"] = market.ORIGINATION_FEE_BPS
    return out


async def agreement_out(agreement: dict, viewer_id: str) -> dict:
    due = await market.due_now(agreement)
    paid = market.paid_cents(agreement)
    out = _out(agreement, drop=("version", "user_id", "payments", "schedule"))
    remaining_paid = paid
    schedule = []
    for item in agreement.get("schedule", []):
        covered = min(item["amount_cents"], max(0, remaining_paid))
        remaining_paid -= covered
        status = "paid" if covered >= item["amount_cents"] else "partial" if covered else (
            "overdue" if store.aware(item["due_at"]) <= store.now() else "upcoming")
        schedule.append({"n": item["n"], "dueAt": _iso(item["due_at"]), "amountCents": item["amount_cents"],
                         "paidCents": covered, "status": status})
    my_share = None
    if agreement["user_id"] != viewer_id:
        investments = [i for i in await market.listing_investments(agreement["listing_id"])]
        total = sum(i["amount_cents"] for i in investments if i["status"] in ("active", "completed", "defaulted"))
        mine = sum(i["amount_cents"] for i in investments if i["user_id"] == viewer_id)
        my_share = {"investedCents": mine, "shareBps": mine * 10_000 // total if total else 0,
                    "receivedCents": sum(d["amount_cents"] for d in await market.distributions_for(viewer_id)
                                         if d["agreement_id"] == agreement["id"])}
    return {**out, "role": "borrower" if agreement["user_id"] == viewer_id else "investor",
            "paidCents": paid, "progressBps": min(10_000, paid * 10_000 // agreement["total_due_cents"])
            if agreement["total_due_cents"] else 0,
            "payments": [{"id": p["id"], "amountCents": p["amount_cents"], "at": _iso(p["at"]), "posted": p.get("posted")}
                         for p in agreement.get("payments", [])],
            "schedule": schedule, "due": due, "myShare": my_share}


# --------------------------------------------------------------------------- #
# Browse
# --------------------------------------------------------------------------- #
@router.get("/overview")
async def overview(user: dict = Depends(current_user)):
    profile = await service.get_profile(user["id"])
    bal = await ledger.balances()
    index = await market.index_summary(exclude_user=user["id"])
    rows = await store.find("market_listings", {"status": {"$in": ["open", "active", "completed"]}}, limit=2000)
    open_rows = [x for x in rows if x["status"] == "open"]
    pool = await service.pool_summary()
    return {
        "settlement": ledger.SETTLEMENT,
        "balances": await banking.balances_for(user["id"], bal),
        "investorReasons": service.investor_check(profile),
        "kycStatus": profile["kyc"].get("status", "none"),
        "index": {"count": index["count"], "capacityCents": index["capacityCents"],
                  "grades": list(market.HIGH_GRADES),
                  "avgRateBps": (sum(x.get("rate_bps") or 0 for x, _ in index["listings"] if x["kind"] == "project_funding")
                                 // max(1, len([1 for x, _ in index["listings"] if x["kind"] == "project_funding"])))},
        "pool": {"navCents": pool["navCents"], "realisedYieldCents": pool["realisedYieldCents"],
                 "defaultRate": pool["defaultRate"], "sharePriceCents": pool["sharePriceCents"]},
        "stats": {"openRaises": len(open_rows),
                  "raisingCents": sum(x["target_cents"] for x in open_rows),
                  "fundedRaises": len([x for x in rows if x["status"] in ("active", "completed")]),
                  "fundedCents": sum(x.get("funded_cents", 0) for x in rows if x["status"] in ("active", "completed"))},
        "policy": {"maxRaiseCents": market.MAX_RAISE_CENTS, "minRaiseCents": market.MIN_RAISE_CENTS,
                   "minInvestmentCents": market.MIN_INVESTMENT_CENTS, "raiseDays": market.RAISE_DAYS,
                   "minCloseBps": market.MIN_CLOSE_BPS, "originationFeeBps": market.ORIGINATION_FEE_BPS,
                   "projectRateBps": market.PROJECT_RATE_BPS, "termMonths": list(market.TERM_MONTHS),
                   "revShareMinBps": market.REV_SHARE_MIN_BPS, "revShareMaxBps": market.REV_SHARE_MAX_BPS,
                   "revPeriodMonths": list(market.REV_PERIOD_MONTHS), "revCapBps": market.REV_CAP_BPS,
                   "useOfFunds": list(market.USE_OF_FUNDS), "defaultAfterDays": market.DEFAULT_AFTER_DAYS},
    }


@router.get("/listings")
async def listings(kind: str | None = Query(default=None, max_length=20), grade: str | None = Query(default=None, max_length=1),
                   q: str | None = Query(default=None, max_length=80), include: str | None = Query(default=None, max_length=10),
                   user: dict = Depends(current_user)):
    statuses = ["open", "active", "completed"] if include == "funded" else ["open"]
    rows = await store.find("market_listings", {"status": {"$in": statuses}}, limit=500)
    if kind:
        rows = [x for x in rows if x["kind"] == kind]
    if grade:
        rows = [x for x in rows if x["grade"] == grade.upper()]
    if q:
        needle = q.lower()
        rows = [x for x in rows if needle in f"{x['title']} {x['summary']} {x['display_name']}".lower()]
    bal = await ledger.balances()
    return [await listing_out(x, user["id"], bal) for x in rows]


@router.get("/my-listings")
async def my_listings(user: dict = Depends(current_user)):
    bal = await ledger.balances()
    return [await listing_out(x, user["id"], bal) for x in await store.find("market_listings", {"user_id": user["id"]})]


@router.get("/listings/{listing_id}")
async def listing(listing_id: str, user: dict = Depends(current_user)):
    row = await store.get("market_listings", listing_id)
    if row is None or (row["status"] == "draft" and row["user_id"] != user["id"]):
        raise HTTPException(404, "Raise not found.")
    return await listing_out(row, user["id"], await ledger.balances(), detail=True)


@router.get("/track-record")
async def track_record(user: dict = Depends(current_user)):
    record = await market.track_record(user["id"])
    profile = await service.get_profile(user["id"])
    return {**record, "kycStatus": profile["kyc"].get("status", "none"),
            "rateBps": market.PROJECT_RATE_BPS[record["grade"]]}


# --------------------------------------------------------------------------- #
# Raise
# --------------------------------------------------------------------------- #
class UseBody(BaseModel):
    category: str = Field(max_length=20)
    amount_cents: int = Field(alias="amountCents", gt=0)
    note: str = Field(default="", max_length=120)


class ListingBody(BaseModel):
    kind: str = Field(max_length=20)
    title: str = Field(max_length=120)
    summary: str = Field(default="", max_length=1200)
    display_name: str = Field(default="", alias="displayName", max_length=80)
    target_cents: int = Field(alias="targetCents", gt=0)
    min_investment_cents: int = Field(default=market.MIN_INVESTMENT_CENTS * 2, alias="minInvestmentCents", gt=0)
    term_months: int | None = Field(default=None, alias="termMonths")
    share_bps: int | None = Field(default=None, alias="shareBps")
    period_months: int | None = Field(default=None, alias="periodMonths")
    uses: list[UseBody] = Field(default_factory=list, max_length=8)
    publish: bool = False


@router.post("/listings")
async def create_listing(body: ListingBody, user: dict = Depends(current_user)):
    result = await _call(market.create_listing(
        user, kind=body.kind, title=body.title, summary=body.summary, display_name=body.display_name,
        target_cents=body.target_cents, min_investment_cents=body.min_investment_cents,
        terms={"term_months": body.term_months, "share_bps": body.share_bps, "period_months": body.period_months},
        uses=[{"category": u.category, "amount_cents": u.amount_cents, "note": u.note} for u in body.uses],
        publish=body.publish))
    if isinstance(result, JSONResponse):
        return result
    return await listing_out(result, user["id"], await ledger.balances(), detail=True)


@router.post("/listings/{listing_id}/publish")
async def publish(listing_id: str, user: dict = Depends(current_user)):
    result = await _call(market.publish_listing(user["id"], listing_id))
    if isinstance(result, JSONResponse):
        return result
    return await listing_out(result, user["id"], await ledger.balances(), detail=True)


@router.post("/listings/{listing_id}/close")
async def close(listing_id: str, user: dict = Depends(current_user)):
    result = await _call(market.close_listing(user["id"], listing_id))
    if isinstance(result, JSONResponse):
        return result
    return await listing_out(result, user["id"], await ledger.balances(), detail=True)


# --------------------------------------------------------------------------- #
# Invest
# --------------------------------------------------------------------------- #
class InvestBody(BaseModel):
    amount_cents: int = Field(alias="amountCents", gt=0)
    idempotency_key: str = Field(alias="idempotencyKey", **IDEM)
    accept_risk: bool = Field(default=False, alias="acceptRisk")


def _risk_required() -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": "Read and accept the risk disclosure to invest.", "reasons": []})


@router.post("/listings/{listing_id}/invest")
async def invest(listing_id: str, body: InvestBody, user: dict = Depends(current_user)):
    if not body.accept_risk:
        return _risk_required()
    result = await _call(market.invest(user["id"], listing_id, body.amount_cents, body.idempotency_key))
    if isinstance(result, JSONResponse):
        return result
    return {"investment": _out(result, drop=("version", "user_id", "owner_id", "idem")),
            "balances": await banking.balances_for(user["id"])}


@router.post("/index/invest")
async def invest_index(body: InvestBody, user: dict = Depends(current_user)):
    if not body.accept_risk:
        return _risk_required()
    result = await _call(market.invest_index(user["id"], body.amount_cents, body.idempotency_key))
    if isinstance(result, JSONResponse):
        return result
    return {"placedCents": result["placedCents"], "keptCents": result["keptCents"],
            "investments": [_out(i, drop=("version", "user_id", "owner_id", "idem")) for i in result["investments"]],
            "balances": await banking.balances_for(user["id"])}


# --------------------------------------------------------------------------- #
# Portfolio and agreements
# --------------------------------------------------------------------------- #
@router.get("/portfolio")
async def portfolio(user: dict = Depends(current_user)):
    data = await market.portfolio(user["id"])
    pool = await service.investor_position(user["id"])
    positions = []
    for p in data["positions"]:
        inv, listing, agreement = p["investment"], p["listing"], p["agreement"]
        positions.append({
            "investment": _out(inv, drop=("version", "user_id", "owner_id", "idem")),
            "listing": {"id": listing["id"], "title": listing["title"], "displayName": listing["display_name"],
                        "kind": listing["kind"], "grade": listing["grade"], "status": listing["status"]} if listing else None,
            "agreement": {"id": agreement["id"], "status": agreement["status"], "endAt": _iso(agreement.get("end_at"))}
            if agreement else None,
            "distributedCents": p["distributedCents"], "expected": p["expected"],
        })
    return {"settlement": ledger.SETTLEMENT, "positions": positions,
            "distributions": [{"id": d["id"], "amountCents": d["amount_cents"], "at": _iso(d["created_at"]),
                               "title": d.get("title"), "agreementId": d["agreement_id"]} for d in data["distributions"]],
            "totals": data["totals"], "risk": data["risk"],
            "pool": {"valueCents": pool["valueCents"], "gainCents": pool["gainCents"], "depositedCents": pool["depositedCents"]},
            "balances": await banking.balances_for(user["id"])}


@router.get("/agreements")
async def agreements(user: dict = Depends(current_user)):
    data = await market.agreements_for(user["id"])
    return {"borrower": [await agreement_out(a, user["id"]) for a in data["borrower"]],
            "investor": [await agreement_out(a, user["id"]) for a in data["investor"]]}


async def _visible_agreement(agreement_id: str, user_id: str) -> dict:
    agreement = await store.get("market_agreements", agreement_id)
    if agreement is None:
        raise HTTPException(404, "Agreement not found.")
    if agreement["user_id"] != user_id and not await store.find(
            "market_investments", {"agreement_id": agreement_id, "user_id": user_id}, limit=1):
        raise HTTPException(404, "Agreement not found.")
    return agreement


@router.get("/agreements/{agreement_id}")
async def agreement(agreement_id: str, user: dict = Depends(current_user)):
    return await agreement_out(await _visible_agreement(agreement_id, user["id"]), user["id"])


class PayBody(BaseModel):
    amount_cents: int = Field(alias="amountCents", gt=0)
    idempotency_key: str = Field(alias="idempotencyKey", **IDEM)


@router.post("/agreements/{agreement_id}/pay")
async def pay(agreement_id: str, body: PayBody, user: dict = Depends(current_user)):
    result = await _call(market.pay(user["id"], agreement_id, body.amount_cents, body.idempotency_key))
    if isinstance(result, JSONResponse):
        return result
    return {"agreement": await agreement_out(result, user["id"]), "balances": await banking.balances_for(user["id"])}


@router.post("/admin/run-jobs")
async def admin_run_jobs(owner: dict = Depends(require_owner)):
    return await market.run_jobs()

