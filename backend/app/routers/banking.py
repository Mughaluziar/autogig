"""Banking API. SIMULATED SETTLEMENT — no bank or chain is contacted.

Any signed-in role:
GET    /api/banking/overview                     balances, linked accounts, recent transfers
GET    /api/banking/accounts                     POST {holder, nickname, routing, accountNumber, kind}
POST   /api/banking/accounts/{id}/verify         {amounts: [cents, cents]}  (micro-deposits)
DELETE /api/banking/accounts/{id}
GET    /api/banking/transfers                    POST {kind, amountCents, idempotencyKey, bankAccountId?, address?}
GET    /api/banking/statements?month=YYYY-MM
POST   /api/banking/advance-payout               {advanceId, currency: usd|usdc}
GET    /api/banking/financing/estimate           indicative range from verified revenue
GET    /api/banking/financing                    POST an application; POST /{id}/withdraw
Platform owners:
GET    /api/banking/admin/financing              POST /api/banking/admin/financing/{id} {status, note}
"""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..auth import current_user, require_owner
from ..capital import banking, ledger, store
from .capital import _call, _out, advance_out

router = APIRouter(prefix="/banking", tags=["banking"])

IDEM = dict(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


def account_out(account: dict) -> dict:
    out = _out(account, drop=("version", "user_id", "micro_deposits", "routing"))
    out["routingLast4"] = account["routing"][-4:]
    # Simulated settlement: no deposit reaches a real bank, so show the two
    # amounts the bank would have received. Removed with a real partner.
    if account["status"] == "pending" and ledger.SETTLEMENT == "simulated":
        out["simulatedDeposits"] = account["micro_deposits"]
    return out


def transfer_out(record: dict) -> dict:
    return _out(record, drop=("version", "user_id", "idem"))


def application_out(app: dict) -> dict:
    return _out(app, drop=("version", "user_id"))


@router.get("/overview")
async def overview(user: dict = Depends(current_user)):
    data = await banking.overview(user["id"])
    return {**data, "accounts": [account_out(a) for a in data["accounts"]],
            "transfers": [transfer_out(t) for t in data["transfers"]],
            "applications": [application_out(a) for a in data["applications"]]}


class AccountBody(BaseModel):
    holder: str = Field(max_length=120)
    nickname: str = Field(default="", max_length=40)
    routing: str = Field(max_length=20)
    account_number: str = Field(alias="accountNumber", max_length=30)
    kind: str = Field(default="checking", max_length=10)


class VerifyBody(BaseModel):
    amounts: list[int] = Field(min_length=2, max_length=2)


@router.get("/accounts")
async def accounts(user: dict = Depends(current_user)):
    return [account_out(a) for a in await store.find("bank_accounts", {"user_id": user["id"]})
            if a["status"] != "removed"]


@router.post("/accounts")
async def add_account(body: AccountBody, user: dict = Depends(current_user)):
    result = await _call(banking.add_bank_account(user["id"], holder=body.holder, nickname=body.nickname,
                                                  routing=body.routing, account_number=body.account_number,
                                                  kind=body.kind))
    return result if isinstance(result, JSONResponse) else account_out(result)


@router.post("/accounts/{account_id}/verify")
async def verify_account(account_id: str, body: VerifyBody, user: dict = Depends(current_user)):
    result = await _call(banking.verify_bank_account(user["id"], account_id, body.amounts))
    return result if isinstance(result, JSONResponse) else account_out(result)


@router.delete("/accounts/{account_id}")
async def remove_account(account_id: str, user: dict = Depends(current_user)):
    result = await _call(banking.remove_bank_account(user["id"], account_id))
    return result if isinstance(result, JSONResponse) else {"status": "ok"}


class TransferBody(BaseModel):
    kind: str = Field(max_length=20)
    amount_cents: int = Field(alias="amountCents", gt=0)
    idempotency_key: str = Field(alias="idempotencyKey", **IDEM)
    bank_account_id: str | None = Field(default=None, alias="bankAccountId", max_length=64)
    address: str | None = Field(default=None, max_length=64)


@router.get("/transfers")
async def transfers(user: dict = Depends(current_user)):
    return [transfer_out(t) for t in await store.find("bank_transfers", {"user_id": user["id"]}, limit=500)
            if t["status"] != "posting"]


@router.post("/transfers")
async def create_transfer(body: TransferBody, user: dict = Depends(current_user)):
    result = await _call(banking.transfer(user["id"], kind=body.kind, amount_cents=body.amount_cents,
                                          idem=body.idempotency_key, bank_account_id=body.bank_account_id,
                                          address=body.address))
    if isinstance(result, JSONResponse):
        return result
    return {"transfer": transfer_out(result), "balances": await banking.balances_for(user["id"])}


@router.get("/statements")
async def statements(month: str = Query(max_length=7), user: dict = Depends(current_user)):
    return await _call(banking.statement(user["id"], month))


class PayoutBody(BaseModel):
    advance_id: str = Field(alias="advanceId", min_length=1, max_length=64)
    currency: str = Field(default="usdc", max_length=4)


@router.post("/advance-payout")
async def advance_payout(body: PayoutBody, user: dict = Depends(current_user)):
    result = await _call(banking.payout_advance(user["id"], body.advance_id, body.currency))
    if isinstance(result, JSONResponse):
        return result
    return {"advance": advance_out(result), "balances": await banking.balances_for(user["id"])}


@router.get("/financing/estimate")
async def financing_estimate(user: dict = Depends(current_user)):
    return await banking.financing_estimate(user["id"])


class FinancingBody(BaseModel):
    amount_cents: int = Field(alias="amountCents", gt=0)
    product: str = Field(max_length=20)
    purpose: str = Field(max_length=1200)
    business_type: str = Field(alias="businessType", max_length=20)
    years_in_business: str = Field(alias="yearsInBusiness", max_length=5)
    team_size: int = Field(default=1, alias="teamSize", ge=1, le=10_000)
    monthly_revenue_cents: int = Field(default=0, alias="monthlyRevenueCents", ge=0)
    consent: bool = False


@router.get("/financing")
async def financing(user: dict = Depends(current_user)):
    return [application_out(a) for a in await store.find("financing_applications", {"user_id": user["id"]}, limit=50)]


@router.post("/financing")
async def apply(body: FinancingBody, user: dict = Depends(current_user)):
    result = await _call(banking.apply_for_financing(
        user, amount_cents=body.amount_cents, product=body.product, purpose=body.purpose,
        business_type=body.business_type, years_in_business=body.years_in_business, team_size=body.team_size,
        monthly_revenue_cents=body.monthly_revenue_cents, consent=body.consent))
    return result if isinstance(result, JSONResponse) else application_out(result)


@router.post("/financing/{app_id}/withdraw")
async def withdraw_application(app_id: str, user: dict = Depends(current_user)):
    result = await _call(banking.withdraw_application(user["id"], app_id))
    return result if isinstance(result, JSONResponse) else application_out(result)


class ReviewBody(BaseModel):
    status: str = Field(max_length=20)
    note: str = Field(default="", max_length=300)


@router.get("/admin/financing")
async def admin_financing(owner: dict = Depends(require_owner)):
    rows = await store.find("financing_applications", {"status": {"$in": ["submitted", "in_review"]}}, limit=500)
    return [application_out(a) | {"userId": a["user_id"]} for a in rows]


@router.post("/admin/financing/{app_id}")
async def admin_review(app_id: str, body: ReviewBody, owner: dict = Depends(require_owner)):
    result = await _call(banking.review_application(owner, app_id, body.status, body.note))
    return result if isinstance(result, JSONResponse) else application_out(result)
