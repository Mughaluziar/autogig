"""Capital program API: investor pool, early payment, protection fund.

SIMULATED SETTLEMENT. Every response carries `settlement: "simulated"`; no
money moves until a licensed settlement partner is integrated.

Anyone signed in (any role):
GET  /api/capital/overview                       profile, pool summary, what's unlocked
POST /api/capital/verification                   submit identity (+ investor attestation)
GET  /api/capital/investor                       position
POST /api/capital/investor/deposit               {amountCents, idempotencyKey}
POST /api/capital/investor/withdraw              {amountCents | all, idempotencyKey}
GET  /api/capital/early-pay/orders               verified orders with underwriting
GET  /api/capital/advances                       my early payments
POST /api/capital/advances/quote                 {orderId, principalCents?}
POST /api/capital/advances/{id}/accept           {acceptTerms}
POST /api/capital/advances/{id}/repay            {amountCents}
GET  /api/capital/coverages                      my protection
POST /api/capital/coverages                      {orderId, coveredCents?, acceptTerms}
POST /api/capital/coverages/{id}/claim
GET  /api/capital/coverages/offers               new orders still inside their cover window
POST /api/capital/coverages/offers/{orderId}/dismiss
GET  /api/capital/claims
GET  /api/capital/journal                        my ledger entries
Platform owners:
GET  /api/capital/admin/verifications            POST /api/capital/admin/verifications/{userId}
GET  /api/capital/admin/claims                   POST /api/capital/admin/claims/{id}
POST /api/capital/admin/run-jobs                 GET  /api/capital/admin/journal
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..auth import current_user, require_owner
from ..capital import ledger, service, store
from ..capital.ledger import LedgerRejected
from ..routers.orders import order_out

router = APIRouter(prefix="/capital", tags=["capital"])


def _iso(value):
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(value, dict):
        return {k: _iso(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_iso(v) for v in value]
    return value


def _camel(key: str) -> str:
    head, *rest = key.split("_")
    return head + "".join(part.title() for part in rest)


def _out(record: dict | None, drop: tuple[str, ...] = ("version", "open", "live", "user_id")) -> dict | None:
    if record is None:
        return None
    return {_camel(k): _iso(v) for k, v in record.items() if k not in drop}


def advance_out(adv: dict) -> dict:
    out = _out(adv)
    out["principalDueCents"] = service._principal_due(adv)
    out["feeDueCents"] = service._fee_due(adv)
    out["totalDueCents"] = out["principalDueCents"] + out["feeDueCents"] if adv["status"] in (
        "active", "overdue", "defaulted") else 0
    return out


def profile_out(profile: dict) -> dict:
    kyc = profile.get("kyc") or {}
    return {
        "roles": profile.get("roles", []),
        "kyc": {"status": kyc.get("status", "none"), "legalName": kyc.get("legal_name", ""),
                "country": kyc.get("country", ""), "method": kyc.get("method"),
                "submittedAt": _iso(kyc.get("submitted_at")), "reviewedAt": _iso(kyc.get("reviewed_at")),
                "note": kyc.get("note", "")},
        "investor": _out(profile.get("investor") or {}, drop=()),
        "investorReasons": service.investor_check(profile),
    }


def _fail(exc: service.CapitalError):
    return JSONResponse(status_code=exc.status, content={"detail": str(exc), "reasons": exc.reasons})


async def _call(coro):
    try:
        return await coro
    except service.CapitalError as exc:
        return _fail(exc)
    except LedgerRejected as exc:
        return _fail(service.CapitalError(str(exc), 409))


# --------------------------------------------------------------------------- #
# Profile and pool
# --------------------------------------------------------------------------- #
@router.get("/overview")
async def overview(user: dict = Depends(current_user)):
    profile = await service.get_profile(user["id"])
    return {"settlement": ledger.SETTLEMENT, "profile": profile_out(profile), "pool": await service.pool_summary()}


class VerificationBody(BaseModel):
    legal_name: str = Field(alias="legalName", max_length=120)
    country: str = Field(max_length=2)
    roles: list[str] = Field(max_length=2)
    investor_basis: str | None = Field(default=None, alias="investorBasis", max_length=20)
    accredited: bool = False
    risk_acknowledged: bool = Field(default=False, alias="riskAcknowledged")


@router.post("/verification")
async def submit_verification(body: VerificationBody, user: dict = Depends(current_user)):
    result = await _call(service.submit_verification(
        user["id"], legal_name=body.legal_name, country=body.country, roles=body.roles,
        investor_basis=body.investor_basis, accredited=body.accredited, risk_ack=body.risk_acknowledged))
    return result if isinstance(result, JSONResponse) else profile_out(result)


@router.get("/pool")
async def pool(user: dict = Depends(current_user)):
    return await service.pool_summary()


# --------------------------------------------------------------------------- #
# Investors
# --------------------------------------------------------------------------- #
class DepositBody(BaseModel):
    amount_cents: int = Field(alias="amountCents", gt=0)
    idempotency_key: str = Field(alias="idempotencyKey", min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class WithdrawBody(BaseModel):
    amount_cents: int | None = Field(default=None, alias="amountCents", gt=0)
    all: bool = False
    idempotency_key: str = Field(alias="idempotencyKey", min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


@router.get("/investor")
async def investor(user: dict = Depends(current_user)):
    profile = await service.get_profile(user["id"])
    return {**await service.investor_position(user["id"]), "reasons": service.investor_check(profile)}


@router.post("/investor/deposit")
async def deposit(body: DepositBody, user: dict = Depends(current_user)):
    result = await _call(service.deposit(user["id"], body.amount_cents, body.idempotency_key))
    if isinstance(result, JSONResponse):
        return result
    return {"entry": result, "position": await service.investor_position(user["id"])}


@router.post("/investor/withdraw")
async def withdraw(body: WithdrawBody, user: dict = Depends(current_user)):
    if not body.all and body.amount_cents is None:
        raise HTTPException(422, "Give an amount, or withdraw all.")
    result = await _call(service.withdraw(user["id"], None if body.all else body.amount_cents, body.idempotency_key))
    if isinstance(result, JSONResponse):
        return result
    return {"entry": result, "position": await service.investor_position(user["id"])}


# --------------------------------------------------------------------------- #
# Early payment
# --------------------------------------------------------------------------- #
class QuoteBody(BaseModel):
    order_id: str = Field(alias="orderId", min_length=1, max_length=64)
    principal_cents: int | None = Field(default=None, alias="principalCents", gt=0)


class AcceptBody(BaseModel):
    accept_terms: bool = Field(default=False, alias="acceptTerms")


class RepayBody(BaseModel):
    amount_cents: int = Field(alias="amountCents", gt=0)


@router.get("/early-pay/orders")
async def early_pay_orders(user: dict = Depends(current_user)):
    accounts = {}
    from ..orders import store as order_store
    for account in await order_store.list_accounts(user["id"]):
        accounts[account["id"]] = account
    rows = await service.eligible_orders(user["id"])
    return [{"order": order_out(r["order"], accounts), "underwriting": r["underwriting"], "covered": r["covered"],
             "coverClosesAt": _iso(service.cover_window_closes(r["order"]))}
            for r in rows]


@router.get("/advances")
async def list_advances(user: dict = Depends(current_user)):
    rows = await store.find("capital_advances", {"user_id": user["id"]}, limit=500)
    return [advance_out(a) for a in rows if a["status"] != "expired"]


@router.post("/advances/quote")
async def quote(body: QuoteBody, user: dict = Depends(current_user)):
    result = await _call(service.quote(user["id"], body.order_id, body.principal_cents))
    return result if isinstance(result, JSONResponse) else advance_out(result)


@router.post("/advances/{advance_id}/accept")
async def accept(advance_id: str, body: AcceptBody, user: dict = Depends(current_user)):
    result = await _call(service.accept(user["id"], advance_id, body.accept_terms))
    return result if isinstance(result, JSONResponse) else advance_out(result)


@router.post("/advances/{advance_id}/repay")
async def repay(advance_id: str, body: RepayBody, user: dict = Depends(current_user)):
    result = await _call(service.repay(user["id"], advance_id, body.amount_cents))
    return result if isinstance(result, JSONResponse) else advance_out(result)


# --------------------------------------------------------------------------- #
# Protection
# --------------------------------------------------------------------------- #
class CoverBody(BaseModel):
    order_id: str = Field(alias="orderId", min_length=1, max_length=64)
    covered_cents: int | None = Field(default=None, alias="coveredCents", gt=0)
    accept_terms: bool = Field(default=False, alias="acceptTerms")


@router.get("/coverages")
async def list_coverages(user: dict = Depends(current_user)):
    return [_out(c) for c in await store.find("capital_coverages", {"user_id": user["id"]}, limit=500)
            if c["status"] != "pending_premium"]


@router.post("/coverages")
async def buy_cover(body: CoverBody, user: dict = Depends(current_user)):
    result = await _call(service.buy_cover(user["id"], body.order_id, body.covered_cents, body.accept_terms))
    return result if isinstance(result, JSONResponse) else _out(result)


@router.get("/coverages/offers")
async def cover_offers(user: dict = Depends(current_user)):
    from ..orders import store as order_store
    rows = await service.cover_offers(user["id"])
    accounts = {a["id"]: a for a in await order_store.list_accounts(user["id"])} if rows else {}
    return [{"order": order_out(r.pop("order"), accounts), **_out(r, drop=())} for r in rows]


@router.post("/coverages/offers/{order_id}/dismiss")
async def dismiss_cover_offer(order_id: str, user: dict = Depends(current_user)):
    result = await _call(service.dismiss_cover_offer(user["id"], order_id))
    return result if isinstance(result, JSONResponse) else {"status": "ok"}


@router.post("/coverages/{coverage_id}/claim")
async def claim(coverage_id: str, user: dict = Depends(current_user)):
    result = await _call(service.open_claim(user["id"], coverage_id))
    return result if isinstance(result, JSONResponse) else _out(result)


@router.get("/claims")
async def list_claims(user: dict = Depends(current_user)):
    return [_out(c) for c in await store.find("capital_claims", {"user_id": user["id"]}, limit=500)]


@router.get("/journal")
async def my_journal(limit: int = Query(default=100, ge=1, le=500), user: dict = Depends(current_user)):
    return await ledger.entries(user_id=user["id"], limit=limit)


# --------------------------------------------------------------------------- #
# Operator (platform owners)
# --------------------------------------------------------------------------- #
class ReviewBody(BaseModel):
    approve: bool
    note: str = Field(default="", max_length=300)


@router.get("/admin/verifications")
async def admin_verifications(owner: dict = Depends(require_owner)):
    return [{"userId": p["user_id"], **profile_out(p)} for p in await service.pending_verifications()]


@router.post("/admin/verifications/{user_id}")
async def admin_review_verification(user_id: str, body: ReviewBody, owner: dict = Depends(require_owner)):
    result = await _call(service.review_verification(owner, user_id, body.approve, body.note))
    return result if isinstance(result, JSONResponse) else profile_out(result)


@router.get("/admin/claims")
async def admin_claims(status: str | None = Query(default=None, max_length=20), owner: dict = Depends(require_owner)):
    query = {"status": status} if status else {"status": {"$in": ["eligible", "waiting", "paying"]}}
    return [_out(c, drop=("version",)) | {"userId": c["user_id"]} for c in await store.find("capital_claims", query)]


@router.post("/admin/claims/{claim_id}")
async def admin_review_claim(claim_id: str, body: ReviewBody, owner: dict = Depends(require_owner)):
    result = await _call(service.review_claim(owner, claim_id, body.approve, body.note))
    return result if isinstance(result, JSONResponse) else _out(result)


@router.post("/admin/run-jobs")
async def admin_run_jobs(owner: dict = Depends(require_owner)):
    return await service.run_jobs()


@router.get("/admin/journal")
async def admin_journal(limit: int = Query(default=200, ge=1, le=1000), owner: dict = Depends(require_owner)):
    return {"balances": await ledger.balances(), "entries": await ledger.entries(limit=limit)}
