"""AutoGig project-credit prototype API. SIMULATED SETTLEMENT: every response says so; no real money, lending or investing.

Any simulated-access account (see modules_gate):
GET  /api/credit/overview                          pool totals, policy limits, my eligibility
GET  /api/credit/pool/allocations                  anonymised list of credit funded from the demo pool
POST /api/credit/contributions                     {amountCents, idempotencyKey, acceptRisk}
GET  /api/credit/statement                         my simulated statement
GET  /api/credit/withdrawals                       POST {amountCents, idempotencyKey, note?}; POST /{id}/cancel
Freelancer / agency (identity-verified in the capital module):
POST /api/credit/applications                      GET /api/credit/applications
POST /api/credit/applications/{id}/accept|reject|withdraw
GET  /api/credit/agreements                        POST /api/credit/agreements/{id}/repay  {amountCents, idempotencyKey}
Platform owners:
GET  /api/credit/admin/applications                POST /api/credit/admin/applications/{id}/decision
GET  /api/credit/admin/treasury                    GET  /api/credit/admin/audit
POST /api/credit/admin/run-jobs                    GET  /api/credit/admin/agreements
GET  /api/credit/admin/withdrawals                 POST /api/credit/admin/withdrawals/{id} {approve, note}
"""
import base64
import binascii

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, ValidationError

from ..auth import current_user, is_owner, require_owner
from ..capital import ledger, store
from ..capital.ledger import LedgerRejected
from ..credit import service
from .capital import _out, _iso

router = APIRouter(prefix="/credit", tags=["credit"])
NOTE = service.SIM


def _deep(value):
    """camelCase every key, including inside lists such as the repayment schedule."""
    from .capital import _camel
    if isinstance(value, dict):
        return {_camel(k): _deep(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_deep(v) for v in value]
    return value


async def _app_out(a: dict, *, admin: bool = False) -> dict:
    out = _out(a, drop=("version", "open", "user_id") if admin else ("version", "open", "user_id", "applicant_email"))
    out["settlement"] = "simulated"
    out["offer"] = _deep(out.get("offer"))
    out["documents"] = [{"id": d["id"], "label": d["label"], "mime": d["mime"], "size": d["size"], "ext": d["ext"], "slot": d["slot"]}
                        for d in await service.documents_for(a["id"])]
    if admin:
        out["applicantId"] = a["user_id"]
    return out


def _agr_out(a: dict) -> dict:
    out = _out(a, drop=("version", "user_id", "ledger_reconciled"))
    out["schedule"] = _deep(out["schedule"])
    out["repayments"] = _deep(out["repayments"])
    out["openCents"] = service.total_open(a["schedule"])
    out["principalOpenCents"] = service.principal_open(a["schedule"])
    out["settlement"] = "simulated"
    return out


async def _call(coro):
    try:
        return await coro
    except service.CreditError as exc:
        return JSONResponse(status_code=exc.status, content={"detail": str(exc)})
    except LedgerRejected as exc:
        return JSONResponse(status_code=409, content={"detail": str(exc)})
    except store.Conflict as exc:
        return JSONResponse(status_code=409, content={"detail": str(exc)})


@router.get("/overview")
async def overview(user: dict = Depends(current_user)):
    bal = await service.balances()
    return {"settlement": "simulated", "notice": NOTE,
            "pool": service.treasury_from(bal),
            "limits": {"minContributionCents": service.MIN_CONTRIBUTION, "maxContributionCents": service.MAX_CONTRIBUTION,
                       "minRequestCents": service.MIN_REQUEST, "maxRequestCents": service.MAX_REQUEST,
                       "maxInstallments": service.MAX_INSTALLMENTS, "installmentDays": service.INSTALLMENT_DAYS,
                       "offerValidDays": service.OFFER_VALID_DAYS, "defaultAfterDays": service.DEFAULT_AFTER_DAYS},
            "eligibility": {"reasons": await service.eligibility(user)}}


@router.get("/pool/allocations")
async def allocations(user: dict = Depends(current_user)):
    rows = await store.find("credit_agreements", {}, limit=500)
    return {"settlement": "simulated", "notice": NOTE,
            "allocations": [{"reference": a["id"][:8], "grade": a["grade"], "principalCents": a["principal_cents"], "status": a["status"],
                             "fundedAt": _iso(a["accepted_at"]), "repaidCents": sum(r["principal_cents"] for r in a["repayments"])}
                            for a in rows if a.get("disbursed")]}


class ContributionBody(BaseModel):
    amount_cents: int = Field(alias="amountCents", gt=0)
    idempotency_key: str = Field(alias="idempotencyKey", min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    accept_risk: bool = Field(alias="acceptRisk")


@router.post("/contributions")
async def contribute(body: ContributionBody, user: dict = Depends(current_user)):
    result = await _call(service.contribute(user, body.amount_cents, body.idempotency_key, body.accept_risk))
    return result if isinstance(result, JSONResponse) else {"settlement": "simulated", "contribution": _out(result)}


@router.get("/statement")
async def statement(user: dict = Depends(current_user)):
    out = await service.statement(user["id"])
    # Records leave the API in camelCase without internal fields (idempotency keys, owner ids, versions).
    out["contributions"] = [_out(c, drop=("version", "user_id", "idem")) for c in out["contributions"]]
    out["withdrawals"] = [_withdrawal_out(w) for w in out["withdrawals"]]
    return out


def _withdrawal_out(w: dict, *, admin: bool = False) -> dict:
    out = _out(w, drop=("version", "user_id", "idem"))
    out["settlement"] = "simulated"
    if admin:
        out["contributorId"] = w["user_id"]
    return out


class WithdrawalBody(BaseModel):
    amount_cents: int = Field(alias="amountCents", gt=0)
    idempotency_key: str = Field(alias="idempotencyKey", min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    note: str = Field(default="", max_length=300)


@router.get("/withdrawals")
async def my_withdrawals(user: dict = Depends(current_user)):
    return {"settlement": "simulated", "notice": NOTE, "position": await service.contribution_position(user["id"]),
            "withdrawals": [_withdrawal_out(w) for w in await store.find("credit_withdrawals", {"user_id": user["id"]}, limit=200)]}


@router.post("/withdrawals")
async def request_withdrawal(body: WithdrawalBody, user: dict = Depends(current_user)):
    result = await _call(service.request_withdrawal(user, body.amount_cents, body.idempotency_key, body.note))
    return result if isinstance(result, JSONResponse) else _withdrawal_out(result)


@router.post("/withdrawals/{withdrawal_id}/cancel")
async def cancel_withdrawal(withdrawal_id: str, user: dict = Depends(current_user)):
    result = await _call(service.cancel_withdrawal(user, withdrawal_id))
    return result if isinstance(result, JSONResponse) else _withdrawal_out(result)


class ApplicationBody(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=20, max_length=3000)
    requested_cents: int = Field(alias="requestedCents", gt=0)
    installments: int = Field(ge=1, le=service.MAX_INSTALLMENTS, default=3)


@router.post("/applications")
async def apply(body: ApplicationBody, user: dict = Depends(current_user)):
    result = await _call(service.apply(user, {"title": body.title.strip(), "description": body.description.strip(),
                                              "requested_cents": body.requested_cents, "installments": body.installments}))
    return result if isinstance(result, JSONResponse) else await _app_out(result)


@router.get("/applications")
async def my_applications(user: dict = Depends(current_user)):
    return [await _app_out(a) for a in await store.find("credit_applications", {"user_id": user["id"]}, limit=100)]


class AcceptBody(BaseModel):
    accept_terms: bool = Field(alias="acceptTerms")


@router.post("/applications/{app_id}/accept")
async def accept(app_id: str, body: AcceptBody, user: dict = Depends(current_user)):
    result = await _call(service.accept_offer(user, app_id, body.accept_terms))
    return result if isinstance(result, JSONResponse) else _agr_out(result)


@router.post("/applications/{app_id}/reject")
async def reject(app_id: str, user: dict = Depends(current_user)):
    result = await _call(service.reject_offer(user, app_id))
    return result if isinstance(result, JSONResponse) else await _app_out(result)


@router.post("/applications/{app_id}/withdraw")
async def withdraw(app_id: str, user: dict = Depends(current_user)):
    result = await _call(service.withdraw(user, app_id))
    return result if isinstance(result, JSONResponse) else await _app_out(result)


@router.get("/agreements")
async def my_agreements(user: dict = Depends(current_user)):
    return [_agr_out(a) for a in await store.find("credit_agreements", {"user_id": user["id"]}, limit=100)]


class RepayBody(BaseModel):
    amount_cents: int = Field(alias="amountCents", gt=0)
    idempotency_key: str = Field(alias="idempotencyKey", min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


@router.post("/agreements/{agreement_id}/repay")
async def repay(agreement_id: str, body: RepayBody, user: dict = Depends(current_user)):
    result = await _call(service.repay(user, agreement_id, body.amount_cents, body.idempotency_key))
    return result if isinstance(result, JSONResponse) else _agr_out(result)


# --------------------------------------------------------------------------------------------------- platform owners
@router.get("/admin/applications")
async def admin_applications(owner: dict = Depends(require_owner)):
    rows = await store.find("credit_applications", {}, limit=500)
    out = []
    for a in rows:
        item = await _app_out(a, admin=True)
        item["signals"] = await service.history_signals(a["user_id"])
        out.append(item)
    return out


class DecisionBody(BaseModel):
    approve: bool
    grade: str = Field(default="", max_length=1)
    fee_bps: int = Field(default=0, alias="feeBps", ge=0, le=10_000)
    installments: int = Field(default=0, ge=0, le=service.MAX_INSTALLMENTS)
    principal_cents: int = Field(default=0, alias="principalCents", ge=0)
    note: str = Field(default="", max_length=500)


@router.post("/admin/applications/{app_id}/decision")
async def admin_decide(app_id: str, body: DecisionBody, owner: dict = Depends(require_owner)):
    result = await _call(service.decide(owner, app_id, approve=body.approve, grade=body.grade, fee_bps=body.fee_bps,
                                        installments=body.installments, principal_cents=body.principal_cents, note=body.note))
    return result if isinstance(result, JSONResponse) else await _app_out(result, admin=True)


@router.get("/admin/agreements")
async def admin_agreements(owner: dict = Depends(require_owner)):
    return [dict(_agr_out(a), applicantId=a["user_id"]) for a in await store.find("credit_agreements", {}, limit=500)]


@router.get("/admin/treasury")
async def admin_treasury(owner: dict = Depends(require_owner)):
    return await service.treasury()


@router.get("/admin/audit")
async def admin_audit(owner: dict = Depends(require_owner)):
    return [{**_out(r, drop=("version",)), "actorId": r["user_id"]} for r in await store.find("credit_audit", {}, limit=300)]


@router.post("/admin/run-jobs")
async def admin_run_jobs(owner: dict = Depends(require_owner)):
    return await service.run_jobs(owner)


class WithdrawalReviewBody(BaseModel):
    approve: bool
    note: str = Field(default="", max_length=300)


@router.get("/admin/withdrawals")
async def admin_withdrawals(owner: dict = Depends(require_owner)):
    rows = await store.find("credit_withdrawals", {}, limit=500)
    out = []
    for w in rows:
        item = _withdrawal_out(w, admin=True)
        if w["status"] == "requested":
            item["position"] = await service.contribution_position(w["user_id"], exclude=w["id"])
        out.append(item)
    return out


@router.post("/admin/withdrawals/{withdrawal_id}")
async def admin_review_withdrawal(withdrawal_id: str, body: WithdrawalReviewBody, owner: dict = Depends(require_owner)):
    result = await _call(service.review_withdrawal(owner, withdrawal_id, approve=body.approve, note=body.note))
    return result if isinstance(result, JSONResponse) else _withdrawal_out(result, admin=True)


# ------------------------------------------------------------------------------------------------ private documents
class DocumentBody(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    content_base64: str = Field(alias="contentBase64", min_length=4, max_length=int(service.MAX_DOC_BYTES * 4 / 3) + 16)


@router.post("/applications/{app_id}/documents", openapi_extra={
    "requestBody": {"required": True, "content": {"application/json": {"schema": DocumentBody.model_json_schema()}}},
})
async def add_document(app_id: str, request: Request, user: dict = Depends(current_user)):
    limit = service.MAX_DOC_BYTES * 2
    length = request.headers.get("content-length", "")
    if length.isdecimal() and int(length) > limit:
        raise HTTPException(413, "That file is too large.")
    payload = bytearray()
    async for chunk in request.stream():
        if len(payload) + len(chunk) > limit:
            raise HTTPException(413, "That file is too large.")
        payload.extend(chunk)
    try:
        body = DocumentBody.model_validate_json(payload)
        data = base64.b64decode(body.content_base64, validate=True)
    except (binascii.Error, ValueError, ValidationError):
        raise HTTPException(422, "The file could not be read.") from None
    result = await _call(service.add_document(user, app_id, body.label, data))
    if isinstance(result, JSONResponse):
        return result
    return {"id": result["id"], "label": result["label"], "mime": result["mime"], "size": result["size"], "slot": result["slot"], "ext": result["ext"]}


@router.delete("/applications/{app_id}/documents/{doc_id}")
async def delete_document(app_id: str, doc_id: str, user: dict = Depends(current_user)):
    result = await _call(service.delete_document(user, app_id, doc_id))
    return result if isinstance(result, JSONResponse) else {"ok": True}


@router.get("/documents/{doc_id}")
async def download_document(doc_id: str, user: dict = Depends(current_user)):
    """Private: only the applicant and platform owners. Always a download, never rendered by the browser, and every owner
    view is written to the audit trail. The file name is generated; nothing the uploader typed reaches a header."""
    result = await _call(service.get_document(user, doc_id, is_owner=is_owner(user)))
    if isinstance(result, JSONResponse):
        return result
    return Response(content=result["data"], media_type=result["mime"], headers={
        "Content-Disposition": f'attachment; filename="document-{result["slot"]}.{result["ext"]}"',
        "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
        "X-Robots-Tag": "noindex, noarchive"})
