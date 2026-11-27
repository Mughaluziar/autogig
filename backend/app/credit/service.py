"""AutoGig project-credit prototype. SIMULATED: nothing here moves real money or is a lending, investment or insurance
product. Records use the capital store; money movements are balanced entries in the capital ledger on accounts that
start with `credit:` (never the real-money accounts), tagged settlement "simulated".

Workflow
  contribution  a signed-in user adds simulated funds to the demo pool          -> ledger credit:cash / credit:capital
  application   a verified freelancer/agency asks for credit before a project   -> status submitted
  decision      the platform owner declines, or makes an offer (grade, fee, installments, expiry)
  offer         the applicant accepts (funds disburse) or rejects; offers expire
  agreement     equal installments with a flat fee; repayments are applied oldest-first, fee before principal
  jobs          late after the due date; defaulted 60 days after; unpaid principal is written off to credit:losses;
                a reminder before each installment falls due
  withdrawal    a contributor asks for simulated contributions back; the owner approves it when the pool's free cash
                allows (credit:cash -> credit:capital), net of the contributor's pro-rata share of losses
Applicants and borrowers are notified at every step that concerns them (offer, decision, disbursement, repayment, due
soon, late, default); operators are notified of new applications and withdrawal requests.
Every amount is an integer number of cents and every rate is in basis points: no floating point touches money.
Every state change is a compare-and-set on `version`; money steps are intent -> idempotent ledger post -> mark done, so a
crash between steps is repaired by the scheduled maintenance pass."""
from datetime import timedelta

from .. import repo
from ..capital import ledger, store
from ..capital.ledger import LedgerRejected, line

SIM = "Simulated: no real money moves and this is not a loan, investment or insurance offer."

MIN_CONTRIBUTION, MAX_CONTRIBUTION = 10_00, 10_000_00
MIN_REQUEST, MAX_REQUEST = 100_00, 5_000_00
MIN_FEE_BPS, MAX_FEE_BPS = 100, 2_000
MAX_INSTALLMENTS = 6
MAX_DOCS, MAX_DOC_BYTES = 3, 2 * 1024 * 1024
INSTALLMENT_DAYS = 30
OFFER_VALID_DAYS = 7
DEFAULT_AFTER_DAYS = 60
REMINDER_DAYS = 3                     # remind the borrower this many days before an installment falls due
INVESTOR_FEE_SHARE_BPS = 7_000        # of simulated fee income attributed to contributors in statements
BPS = 10_000
GRADES = ("A", "B", "C", "D", "E")

CASH, CAPITAL, RECEIVABLE, INCOME, LOSSES = "credit:cash", "credit:capital", "credit:receivable", "credit:income", "credit:losses"
RESERVED = "credit:reserved"        # funds set aside for an open offer: moved out of cash atomically, so offers can never over-commit
OPEN_APPLICATION = ("submitted", "offered")
OPEN_AGREEMENT = ("active", "late")


class CreditError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def now():
    return store.now()


# ---------------------------------------------------------------------------------------------------------------- audit
async def audit(actor: dict, action: str, subject_type: str, subject_id: str, detail: dict | None = None) -> None:
    """Append-only: there is no update or delete path for credit_audit."""
    await store.insert("credit_audit", actor["id"], {
        "action": action, "subject_type": subject_type, "subject_id": subject_id,
        "actor_role": actor.get("role", ""), "detail": detail or {}})


def _usd(cents: int) -> str:
    return f"${cents / 100:,.2f}"


async def _tell(user_id: str, title: str, body: str, kind: str = "info") -> None:
    """In-app notification. Never lets a notification failure undo a money step that already happened."""
    try:
        await repo.notify(user_id, title, body + " (Simulated.)", kind)
    except Exception:  # pragma: no cover - notification storage is best effort here
        import logging
        logging.getLogger("autopilot.credit").warning("credit notification failed for %s", title)


async def _tell_operators(title: str, body: str) -> None:
    from ..capital.service import _notify_operators
    try:
        await _notify_operators(title, body)
    except Exception:  # pragma: no cover
        import logging
        logging.getLogger("autopilot.credit").warning("operator notification failed for %s", title)


# --------------------------------------------------------------------------------------------------- pure arithmetic
def split_evenly(total: int, parts: int) -> list[int]:
    """Largest-remainder split: the parts always add up to `total` exactly."""
    base, extra = divmod(total, parts)
    return [base + (1 if i < extra else 0) for i in range(parts)]


def build_schedule(principal: int, fee_bps: int, installments: int, start) -> list[dict]:
    fee_total = principal * fee_bps // BPS
    return [{"n": i + 1, "due_at": start + timedelta(days=INSTALLMENT_DAYS * (i + 1)),
             "principal_cents": p, "fee_cents": f, "principal_paid_cents": 0, "fee_paid_cents": 0}
            for i, (p, f) in enumerate(zip(split_evenly(principal, installments), split_evenly(fee_total, installments)))]


def installment_open(inst: dict) -> int:
    return inst["principal_cents"] + inst["fee_cents"] - inst["principal_paid_cents"] - inst["fee_paid_cents"]


def apply_payment(schedule: list[dict], amount: int) -> tuple[list[dict], int, int]:
    """Oldest installment first, fee before principal. Returns (new schedule, principal part, fee part)."""
    sched = [dict(i) for i in schedule]
    left, principal_part, fee_part = amount, 0, 0
    for inst in sched:
        if left <= 0:
            break
        fee = min(left, inst["fee_cents"] - inst["fee_paid_cents"])
        inst["fee_paid_cents"] += fee
        left -= fee
        fee_part += fee
        prin = min(left, inst["principal_cents"] - inst["principal_paid_cents"])
        inst["principal_paid_cents"] += prin
        left -= prin
        principal_part += prin
    return sched, principal_part, fee_part


def total_open(schedule: list[dict]) -> int:
    return sum(installment_open(i) for i in schedule)


def principal_open(schedule: list[dict]) -> int:
    return sum(i["principal_cents"] - i["principal_paid_cents"] for i in schedule)


DOC_TYPES = ((b"%PDF-", "application/pdf", "pdf"), (b"\x89PNG\r\n\x1a\n", "image/png", "png"), (b"\xff\xd8\xff", "image/jpeg", "jpg"))


def sniff_document(data: bytes) -> tuple[str, str]:
    """(mime, extension) from the file's own first bytes: the claimed name or type is never trusted."""
    for magic, mime, ext in DOC_TYPES:
        if data.startswith(magic):
            return mime, ext
    raise CreditError("Only PDF, PNG or JPEG files are accepted.", 422)


# -------------------------------------------------------------------------------------------------------------- reads
async def balances() -> dict:
    return await ledger.balances()


def treasury_from(bal: dict) -> dict:
    free, reserved = ledger.usd(bal, CASH), ledger.usd(bal, RESERVED)
    return {
        "settlement": "simulated", "notice": SIM,
        "contributionsCents": -ledger.usd(bal, CAPITAL),
        "cashCents": free + reserved,            # everything the demo pool holds, including what is set aside
        "committedCents": reserved,              # set aside for open offers (the ledger is the only source of truth)
        "availableCents": free,
        "outstandingCents": ledger.usd(bal, RECEIVABLE),
        "feesCents": -ledger.usd(bal, INCOME),
        "lossesCents": ledger.usd(bal, LOSSES),
    }


async def treasury() -> dict:
    bal = await balances()
    out = treasury_from(bal)
    agreements = await store.find("credit_agreements", {}, limit=5000)
    offered = await store.find("credit_applications", {"status": {"$in": ["offered", "accepted"]}, "reservation": "held"}, limit=5000)
    out["repaymentsCents"] = sum(r["amount_cents"] for a in agreements for r in a.get("repayments", []))
    out["agreements"] = {s: sum(1 for a in agreements if a["status"] == s) for s in ("active", "late", "repaid", "defaulted")}
    out["disbursedCents"] = sum(a["principal_cents"] for a in agreements if a.get("disbursed"))
    principal_repaid = sum(r["principal_cents"] for a in agreements for r in a.get("repayments", []))
    written_off = sum(a.get("written_off_cents", 0) for a in agreements)
    held = sum(a["offer"]["principal_cents"] for a in offered if a.get("offer") and a.get("reservation") == "held")
    out["ledgerCheck"] = (out["cashCents"] == out["contributionsCents"] - out["disbursedCents"] + out["repaymentsCents"]
                          and out["outstandingCents"] == out["disbursedCents"] - principal_repaid - written_off
                          and out["committedCents"] == held)       # what the ledger set aside equals the open offers' amounts
    return out


# ---------------------------------------------------------------------------------------------------- contributions
async def contribute(user: dict, amount: int, idem: str, accepted_risk: bool) -> dict:
    if not accepted_risk:
        raise CreditError("Confirm that you understand this is a simulation and that simulated results can be negative.", 422)
    if not (MIN_CONTRIBUTION <= amount <= MAX_CONTRIBUTION):
        raise CreditError(f"Simulated contributions are between ${MIN_CONTRIBUTION // 100} and ${MAX_CONTRIBUTION // 100:,}.", 422)
    query = {"user_id": user["id"], "idem": idem}
    rows = await store.find("credit_contributions", query, limit=1)
    if not rows:
        # Reuse an older journal-only entry if the process stopped before saving its receipt.
        previous = await ledger.find_by_idem(_contribution_key(user["id"], idem))
        if previous and line(CASH, amount) not in previous["lines"]:
            raise CreditError("This contribution key was already used for a different amount.", 409)
        try:
            rows = [await store.insert("credit_contributions", user["id"], {
                "amount_cents": amount, "idem": idem, "ledger_seq": None, "settlement": "simulated"})]
        except store.Conflict:
            rows = await store.find("credit_contributions", query, limit=1)
    record = rows[0]
    if record["amount_cents"] != amount:
        raise CreditError("This contribution key was already used for a different amount.", 409)
    return await _post_contribution(record, user)


def _contribution_key(user_id: str, idem: str) -> str:
    return f"credit-contribution:{user_id}:{idem}"


async def _post_contribution(record: dict, actor: dict) -> dict:
    if record.get("ledger_seq") is not None:
        return record
    amount = record["amount_cents"]
    entry = await ledger.post("credit_contribution", [line(CASH, amount), line(CAPITAL, -amount)],
                              memo="Simulated contribution to the AutoGig demo pool", refs={"user_id": record["user_id"]},
                              idem=_contribution_key(record["user_id"], record["idem"]))
    if line(CASH, amount) not in entry["lines"]:
        raise CreditError("The stored contribution and ledger amounts disagree.", 409)
    updated = await store.update("credit_contributions", record["id"], {"ledger_seq": entry["seq"]},
                                 expect_version=record["version"])
    if updated is None:
        return await store.get("credit_contributions", record["id"])
    await audit(actor, "contribution", "credit_contribution", record["id"], {"amount_cents": amount})
    return updated


async def statement(user_id: str) -> dict:
    """Simulated statement. The attribution is an integer pro-rata illustration, not a forecast or a promise."""
    mine = [c for c in await store.find("credit_contributions", {"user_id": user_id}, limit=1000)
            if c.get("ledger_seq") is not None]
    withdrawals = await store.find("credit_withdrawals", {"user_id": user_id}, limit=1000)
    bal = await balances()
    pool_total = -ledger.usd(bal, CAPITAL)          # net of withdrawals already paid
    withdrawn = sum(w["amount_cents"] for w in withdrawals if w["status"] == "paid")
    mine_total = sum(c["amount_cents"] for c in mine) - withdrawn
    fees = -ledger.usd(bal, INCOME)
    losses = ledger.usd(bal, LOSSES)
    fee_pool = fees * INVESTOR_FEE_SHARE_BPS // BPS
    fee_attr = fee_pool * mine_total // pool_total if pool_total else 0
    loss_attr = losses * mine_total // pool_total if pool_total else 0
    position = await contribution_position(user_id)
    return {"settlement": "simulated", "notice": SIM + " Attributed amounts are an illustration of pool results, never a forecast.",
            "contributedCents": mine_total + withdrawn, "withdrawnCents": withdrawn, "netContributedCents": mine_total,
            "withdrawableCents": position["withdrawableCents"], "pendingWithdrawalCents": position["pendingCents"],
            "withdrawals": withdrawals, "poolContributionsCents": pool_total,
            "shareBps": mine_total * BPS // pool_total if pool_total else 0,
            "attributedFeesCents": fee_attr, "attributedLossesCents": loss_attr,
            "simulatedNetCents": fee_attr - loss_attr, "contributions": mine}


# ------------------------------------------------------------------------------------------------------ applications
async def eligibility(user: dict) -> list[str]:
    """Reasons this account cannot apply (empty = may apply)."""
    reasons = []
    if user.get("role") not in ("admin", "freelancer"):
        reasons.append("Only freelancer and agency accounts can request project credit.")
    profile = await store.profile(user["id"])
    if not profile or (profile.get("kyc") or {}).get("status") != "verified":
        reasons.append("Identity verification (simulated) must be approved first: open Capital, then Verification.")
    return reasons


async def apply(user: dict, fields: dict) -> dict:
    reasons = await eligibility(user)
    if reasons:
        raise CreditError(" ".join(reasons), 403)
    from .. import auth
    if auth.is_owner(user):
        raise CreditError("Platform owners review applications and cannot apply.", 403)
    amount = fields["requested_cents"]
    if not (MIN_REQUEST <= amount <= MAX_REQUEST):
        raise CreditError(f"Request between ${MIN_REQUEST // 100} and ${MAX_REQUEST // 100:,}.", 422)
    scope = {"user_id": user["id"]}
    open_apps = await store.find("credit_applications", {**scope, "open": True}, limit=1)
    unfinished = await store.find("credit_applications", {
        **scope, "status": "accepted", "reservation": {"$in": [None, "held", "pending"]},
    }, limit=1)
    open_agr = await store.find("credit_agreements", {**scope, "status": {"$in": list(OPEN_AGREEMENT)}}, limit=1)
    if open_apps or unfinished or open_agr:
        raise CreditError("You already have an open application or an unpaid credit agreement.", 409)
    try:
        rec = await _insert_application(user, amount, fields)
    except store.Conflict:
        raise CreditError("You already have an open application or an unpaid credit agreement.", 409)
    await audit(user, "application_submitted", "credit_application", rec["id"], {"requested_cents": amount})
    await _tell_operators("Project credit application", f"{_usd(amount)} requested for \"{rec['title'][:60]}\". Review it in "
                          "Project credit, then Review.")
    return rec


async def _insert_application(user: dict, amount: int, fields: dict) -> dict:
    return await store.insert("credit_applications", user["id"], {
        "title": fields["title"], "description": fields["description"], "requested_cents": amount,
        "preferred_installments": fields["installments"],
        "status": "submitted", "open": True, "reservation": "none", "offer": None, "decision": None, "settlement": "simulated",
        "applicant_name": user.get("name", ""), "applicant_email": user.get("email", "")})


async def history_signals(user_id: str) -> dict:
    agreements = await store.find("credit_agreements", {"user_id": user_id}, limit=200)
    profile = await store.profile(user_id)
    return {"kycStatus": ((profile or {}).get("kyc") or {}).get("status", "none"),
            "agreementsRepaid": sum(a["status"] == "repaid" for a in agreements),
            "agreementsDefaulted": sum(a["status"] == "defaulted" for a in agreements),
            "agreementsOpen": sum(a["status"] in OPEN_AGREEMENT for a in agreements)}


async def _cas(coll: str, rec: dict, fields: dict) -> dict:
    updated = await store.update(coll, rec["id"], fields, expect_version=rec["version"])
    if updated is None:
        raise CreditError("This record changed at the same moment. Reload and try again.", 409)
    return updated


async def decide(owner: dict, app_id: str, *, approve: bool, grade: str = "", fee_bps: int = 0, installments: int = 0,
                 principal_cents: int = 0, note: str = "") -> dict:
    app = await store.get("credit_applications", app_id)
    if not app:
        raise CreditError("Application not found.", 404)
    if app["user_id"] == owner["id"]:
        raise CreditError("You cannot review your own application.", 403)
    if app["status"] != "submitted":
        raise CreditError(f"This application is already {app['status']}.", 409)
    if not approve:
        out = await _cas("credit_applications", app, {"status": "declined", "open": False, "decision": {"by": owner["id"], "note": note[:500], "at": now()}})
        await audit(owner, "application_declined", "credit_application", app_id, {})
        await _tell(app["user_id"], "Credit application not approved",
                    f"\"{app['title'][:60]}\" was not approved." + (f" Reviewer's note: {note[:200]}" if note.strip() else ""),
                    "warning")
        return out
    if grade not in GRADES or not (MIN_FEE_BPS <= fee_bps <= MAX_FEE_BPS) or not (1 <= installments <= MAX_INSTALLMENTS):
        raise CreditError("An offer needs a grade A-E, a fee of 1%-20% and 1-6 installments.", 422)
    if not (MIN_REQUEST <= principal_cents <= min(MAX_REQUEST, app["requested_cents"])):
        raise CreditError("The offered amount must be between the minimum and what was requested.", 422)
    if (await store.profile(app["user_id"]) or {}).get("kyc", {}).get("status") != "verified":
        raise CreditError("The applicant is no longer identity-verified.", 409)
    expires = now() + timedelta(days=OFFER_VALID_DAYS)
    fee_total = principal_cents * fee_bps // BPS
    offer = {"principal_cents": principal_cents, "fee_bps": fee_bps, "fee_total_cents": fee_total, "installments": installments,
             "total_repayable_cents": principal_cents + fee_total, "installment_days": INSTALLMENT_DAYS, "expires_at": expires, "grade": grade,
             "signals": await history_signals(app["user_id"])}
    # 1) claim the application (only one decision on it can win), 2) reserve the money in the ledger. The ledger serialises
    # its writers and checks the balance inside that section, so two offers can never reserve the same cash.
    claimed = await _cas("credit_applications", app, {"status": "offered", "offer": offer, "reservation": "pending",
                                                      "decision": {"by": owner["id"], "note": note[:500], "at": now()}})
    out = await _reserve_or_revert(claimed)
    await audit(owner, "offer_made", "credit_application", app_id, {"principal_cents": principal_cents, "fee_bps": fee_bps, "grade": grade})
    await _tell(app["user_id"], "You have a credit offer",
                f"{_usd(principal_cents)} for \"{app['title'][:60]}\", repaid as {_usd(principal_cents + fee_total)} in "
                f"{installments} installment{'s' if installments != 1 else ''}. Accept or decline it by "
                f"{expires:%b %d, %Y}.", "success")
    return out


async def _mark(coll: str, record_id: str, fields: dict) -> dict:
    """Bookkeeping-only update: retries on a version clash because the fields never conflict with each other."""
    for _ in range(8):
        rec = await store.get(coll, record_id)
        updated = await store.update(coll, record_id, fields, expect_version=rec["version"])
        if updated is not None:
            return updated
    raise CreditError("This record is busy. Try again.", 409)


async def _reserve_or_revert(app: dict) -> dict:
    p = app["offer"]["principal_cents"]
    try:
        await ledger.post("credit_reserve", [line(CASH, -p), line(RESERVED, p)], memo="Simulated funds set aside for an offer",
                          refs={"user_id": app["user_id"], "application_id": app["id"]}, idem=f"credit-reserve:{app['id']}",
                          check=ledger.require_non_negative(CASH))
    except LedgerRejected:
        await _mark("credit_applications", app["id"], {"status": "submitted", "open": True, "offer": None, "reservation": "none"})
        raise CreditError("The simulated pool does not have enough uncommitted funds for this offer.", 409)
    return await _mark("credit_applications", app["id"], {"reservation": "held"})


async def _release(app: dict) -> None:
    """Give an offer's reserved funds back to the pool (rejected, withdrawn, expired). Idempotent."""
    current = await store.get("credit_applications", app["id"])
    if not current or current.get("reservation") in ("none", "released", "used") or not current.get("offer"):
        return
    p = current["offer"]["principal_cents"]
    if current.get("reservation") == "pending":
        try:                                    # make sure the reserve entry exists before reversing it (crash repair)
            await ledger.post("credit_reserve", [line(CASH, -p), line(RESERVED, p)], memo="Simulated funds set aside for an offer",
                              refs={"user_id": current["user_id"], "application_id": current["id"]}, idem=f"credit-reserve:{current['id']}",
                              check=ledger.require_non_negative(CASH))
        except LedgerRejected:
            await _mark("credit_applications", current["id"], {"reservation": "released"})
            return
    await ledger.post("credit_release", [line(CASH, p), line(RESERVED, -p)], memo="Simulated reserved funds returned to the pool",
                      refs={"user_id": current["user_id"], "application_id": current["id"]}, idem=f"credit-release:{current['id']}",
                      check=ledger.require_non_negative(RESERVED))
    await _mark("credit_applications", current["id"], {"reservation": "released"})


async def reject_offer(user: dict, app_id: str) -> dict:
    app = await store.get("credit_applications", app_id, user_id=user["id"])
    if not app or app["status"] != "offered":
        raise CreditError("There is no open offer to reject.", 404)
    out = await _cas("credit_applications", app, {"status": "rejected", "open": False})
    await _release(out)
    await audit(user, "offer_rejected", "credit_application", app_id, {})
    return out


async def withdraw(user: dict, app_id: str) -> dict:
    app = await store.get("credit_applications", app_id, user_id=user["id"])
    if not app or app["status"] not in OPEN_APPLICATION:
        raise CreditError("There is no open application to withdraw.", 404)
    out = await _cas("credit_applications", app, {"status": "withdrawn", "open": False})
    await _release(out)
    await audit(user, "application_withdrawn", "credit_application", app_id, {})
    return out


async def accept_offer(user: dict, app_id: str, accept_terms: bool) -> dict:
    if not accept_terms:
        raise CreditError("Accept the terms to continue. They describe a simulation, not a real loan.", 422)
    app = await store.get("credit_applications", app_id, user_id=user["id"])
    if not app or app["status"] != "offered":
        raise CreditError("There is no open offer to accept.", 404)
    offer = app["offer"]
    if store.aware(offer["expires_at"]) <= now():
        expired = await _cas("credit_applications", app, {"status": "expired", "open": False})
        await _release(expired)
        raise CreditError("This offer has expired.", 409)
    if app.get("reservation") == "pending":      # a crash left the money unreserved: reserve it now or give the offer back
        app = await _reserve_or_revert(app)
    app = await _cas("credit_applications", app, {"status": "accepted", "accepted_at": now()})
    agr = await _finish_acceptance(app)
    await audit(user, "offer_accepted", "credit_agreement", agr["id"], {"principal_cents": agr["principal_cents"]})
    first = agr["schedule"][0]
    await _tell(user["id"], "Credit funds sent",
                f"{_usd(agr['principal_cents'])} for \"{agr['title'][:60]}\". First installment of "
                f"{_usd(installment_open(first))} is due {store.aware(first['due_at']):%b %d, %Y}.", "success")
    return agr


async def _finish_acceptance(app: dict) -> dict:
    """Recover the agreement and disbursement from a durable acceptance intent."""
    query = {"application_id": app["id"]}
    rows = await store.find("credit_agreements", query, limit=1)
    if rows:
        agr = rows[0]
    else:
        offer = app["offer"]
        started = app.get("accepted_at") or now()
        try:
            agr = await store.insert("credit_agreements", app["user_id"], {
                "application_id": app["id"], "title": app["title"], "grade": offer["grade"],
                "principal_cents": offer["principal_cents"], "fee_bps": offer["fee_bps"],
                "fee_total_cents": offer["fee_total_cents"], "status": "active",
                "schedule": build_schedule(offer["principal_cents"], offer["fee_bps"], offer["installments"], store.aware(started)),
                "repayments": [], "disbursed": False, "written_off_cents": 0, "accepted_at": started,
                "settlement": "simulated"})
        except store.Conflict:
            agr = (await store.find("credit_agreements", query, limit=1))[0]
    if agr["status"] == "cancelled":
        raise CreditError("The reserved funds need operator review.", 409)
    agr = await _disburse(agr)
    await _mark("credit_applications", app["id"], {"reservation": "used", "open": False})
    return agr


async def _disburse(agr: dict) -> dict:
    if agr["disbursed"]:
        return agr
    await ledger.post("credit_disbursement", [line(RECEIVABLE, agr["principal_cents"]), line(RESERVED, -agr["principal_cents"])],
                      memo="Simulated credit disbursement", refs={"user_id": agr["user_id"], "agreement_id": agr["id"]},
                      idem=f"credit-disburse:{agr['id']}", check=ledger.require_non_negative(RESERVED))
    return await _mark("credit_agreements", agr["id"], {"disbursed": True})


async def repay(user: dict, agreement_id: str, amount: int, idem: str) -> dict:
    agr = await store.get("credit_agreements", agreement_id, user_id=user["id"])
    if not agr:
        raise CreditError("There is no open credit agreement to repay.", 404)
    done = next((r for r in agr["repayments"] if r["idem"] == idem), None)
    if done:
        if done["amount_cents"] != amount:
            raise CreditError("This repayment key was already used for a different amount.", 409)
        return await _post_repayments(agr)
    if agr["status"] not in OPEN_AGREEMENT:
        raise CreditError("There is no open credit agreement to repay.", 404)
    if not agr["disbursed"]:
        raise CreditError("This agreement is still being funded. Try again after it is ready.", 409)
    owed = total_open(agr["schedule"])
    if amount <= 0 or amount > owed:
        raise CreditError(f"Enter an amount between $0.01 and the ${owed / 100:,.2f} still owed.", 422)
    schedule, prin, fee = apply_payment(agr["schedule"], amount)
    rep = {"id": f"{agreement_id[:8]}-{len(agr['repayments']) + 1}", "idem": idem, "amount_cents": amount, "principal_cents": prin,
           "fee_cents": fee, "at": now(), "posted": False}
    status = "repaid" if total_open(schedule) == 0 else ("active" if overdue_days({"schedule": schedule}, now()) < 0 else agr["status"])
    agr = await _cas("credit_agreements", agr, {"schedule": schedule, "repayments": agr["repayments"] + [rep],
                                              "status": status, "ledger_reconciled": False})
    agr = await _post_repayments(agr)
    await audit(user, "repayment", "credit_agreement", agr["id"], {"amount_cents": amount})
    left = total_open(agr["schedule"])
    if left == 0:
        await _tell(user["id"], "Credit repaid in full", f"\"{agr['title'][:60]}\" is fully repaid. Thank you.", "success")
    else:
        await _tell(user["id"], "Repayment received", f"{_usd(amount)} received for \"{agr['title'][:60]}\"; "
                    f"{_usd(left)} still owed.", "success")
    return agr


async def _post_repayments(agr: dict) -> dict:
    for _ in range(5):
        pending = [r for r in agr["repayments"] if not r["posted"]]
        if not pending and (agr["status"] != "repaid" or agr.get("ledger_reconciled")):
            return agr
        for r in pending:
            await ledger.post("credit_repayment", [line(CASH, r["amount_cents"]), line(RECEIVABLE, -r["principal_cents"]), line(INCOME, -r["fee_cents"])],
                              memo="Simulated repayment", refs={"user_id": agr["user_id"], "agreement_id": agr["id"]},
                              idem=f"credit-repay:{agr['id']}:{r['id']}")
        marked = [dict(r, posted=True) if not r["posted"] else r for r in agr["repayments"]]
        fields = {"repayments": marked}
        if agr["status"] == "repaid":
            fields["ledger_reconciled"] = True
        updated = await store.update("credit_agreements", agr["id"], fields, expect_version=agr["version"])
        agr = updated or await store.get("credit_agreements", agr["id"])
    raise CreditError("Repayments are still being reconciled. Try again.", 409)


async def _finish_writeoff(agr: dict, actor: dict) -> None:
    lost = agr["written_off_cents"]
    existing = await ledger.find_by_idem(f"credit-writeoff:{agr['id']}") if agr.get("ledger_reconciled") is None else None
    if lost:
        await ledger.post("credit_writeoff", [line(LOSSES, lost), line(RECEIVABLE, -lost)], memo="Simulated write-off of unpaid principal",
                          refs={"user_id": agr["user_id"], "agreement_id": agr["id"]}, idem=f"credit-writeoff:{agr['id']}")
    await _cas("credit_agreements", agr, {"ledger_reconciled": True})
    if not existing:
        await audit(actor, "agreement_defaulted", "credit_agreement", agr["id"], {"written_off_cents": lost})


# ------------------------------------------------------------------------------------------------------------- jobs
def overdue_days(agr: dict, at) -> int:
    late = [at - store.aware(i["due_at"]) for i in agr["schedule"] if installment_open(i) > 0 and store.aware(i["due_at"]) < at]
    return max((d.days for d in late), default=-1)


async def run_jobs(actor: dict | None = None, at=None) -> dict:
    """Idempotent maintenance pass, safe to run from several processes at once: expire old offers and return their money, finish
    interrupted ledger steps, then mark agreements late or defaulted. Every transition is a compare-and-set and every ledger
    entry has a fixed key, so a second run (or a concurrent one) changes nothing that is already done."""
    at = at or now()
    who = actor or {"id": "system", "role": "system"}
    summary = {"late": 0, "defaulted": 0, "expiredOffers": 0, "repaired": 0, "reminders": 0, "withdrawalsRepaired": 0}

    async def attempt(label, coro):
        try:
            return await coro
        except (CreditError, store.Conflict):
            return None                          # another worker did it first, or the record changed: the next pass retries
        except Exception as exc:                 # one bad record must not stop the pass
            import logging
            logging.getLogger("autopilot.credit").error("credit job failed for %s (%s)", label, type(exc).__name__)
            return None

    for record in await store.find("credit_contributions", {"ledger_seq": None}, limit=5000):
        if await attempt(f"post contribution {record['id']}", _post_contribution(record, who)):
            summary["repaired"] += 1
    for record in await store.find("credit_withdrawals", {"status": "paying"}, limit=5000):
        if await attempt(f"pay withdrawal {record['id']}", _pay_withdrawal(record, who)):
            summary["withdrawalsRepaired"] += 1
    for app in await store.find("credit_applications", {"status": "offered"}, limit=5000):
        if store.aware(app["offer"]["expires_at"]) <= at:
            async def expire(a=app):
                done = await _cas("credit_applications", a, {"status": "expired", "open": False})
                await _release(done)
                await _tell(a["user_id"], "Credit offer expired",
                            f"The offer for \"{a['title'][:60]}\" expired before it was accepted. You can apply again.", "warning")
                return True
            if await attempt(f"expire {app['id']}", expire()):
                summary["expiredOffers"] += 1
        elif app.get("reservation") == "pending":
            if await attempt(f"reserve {app['id']}", _reserve_or_revert(app)):
                summary["repaired"] += 1
    for app in await store.find("credit_applications", {"status": {"$in": ["rejected", "withdrawn", "expired", "declined"]}}, limit=5000):
        if app.get("reservation") in ("held", "pending"):
            async def release(a=app):
                await _release(a)
                return True
            if await attempt(f"release {app['id']}", release()):
                summary["repaired"] += 1
    for app in await store.find("credit_applications", {"status": "accepted", "reservation": {"$in": [None, "held", "pending"]}}, limit=5000):
        if await attempt(f"complete acceptance {app['id']}", _finish_acceptance(app)):
            summary["repaired"] += 1
    terminal = {"status": {"$in": ["repaid", "defaulted"]}, "ledger_reconciled": {"$in": [None, False]}}
    for agr in await store.find("credit_agreements", terminal, limit=5000):
        async def finish(a=agr):
            a = await _post_repayments(a)
            if a["status"] == "defaulted":
                await _finish_writeoff(a, who)
            return a.get("ledger_reconciled") or a["status"] == "defaulted"
        if await attempt(f"settle {agr['id']}", finish()):
            summary["repaired"] += 1
    for agr in await store.find("credit_agreements", {"status": {"$in": list(OPEN_AGREEMENT)}}, limit=5000):
        async def process(a=agr):
            counts = {"repaired": 0, "late": 0, "defaulted": 0, "reminders": 0}
            if not a["disbursed"]:
                a = await _disburse(a)
                counts["repaired"] += 1
            if any(not r["posted"] for r in a["repayments"]):
                a = await _post_repayments(a)
                counts["repaired"] += 1
            late_days = overdue_days(a, at)
            if late_days >= DEFAULT_AFTER_DAYS:
                lost = principal_open(a["schedule"])
                a = await _cas("credit_agreements", a, {"status": "defaulted", "written_off_cents": lost, "ledger_reconciled": False})
                await _finish_writeoff(a, who)
                counts["defaulted"] += 1
                await _tell(a["user_id"], "Credit agreement in default",
                            f"\"{a['title'][:60]}\" is {late_days} days overdue and is now in default. Contact the platform to "
                            "arrange repayment.", "warning")
            elif late_days >= 0 and a["status"] == "active":
                a = await _cas("credit_agreements", a, {"status": "late"})
                counts["late"] += 1
                await audit(who, "agreement_late", "credit_agreement", a["id"], {})
                await _tell(a["user_id"], "Credit repayment overdue",
                            f"An installment of \"{a['title'][:60]}\" is overdue; {_usd(total_open(a['schedule']))} is still owed. "
                            f"After {DEFAULT_AFTER_DAYS} days overdue the agreement goes into default.", "warning")
            elif late_days < 0 and await _remind(a, at):
                counts["reminders"] += 1
            return counts
        got = await attempt(f"agreement {agr['id']}", process())
        for k, v in (got or {}).items():
            summary[k] += v
    return summary


async def _remind(agr: dict, at) -> bool:
    """One reminder per installment, REMINDER_DAYS before it falls due. The reminder is recorded with a
    compare-and-set before the notification, so concurrent job runs send it once."""
    upcoming = next((i for i in agr["schedule"] if installment_open(i) > 0), None)
    if upcoming is None or upcoming["n"] in (agr.get("reminded") or []):
        return False
    due = store.aware(upcoming["due_at"])
    if not (at < due <= at + timedelta(days=REMINDER_DAYS)):
        return False
    try:
        await _cas("credit_agreements", agr, {"reminded": [*(agr.get("reminded") or []), upcoming["n"]]})
    except CreditError:
        return False                              # another run recorded it first
    await _tell(agr["user_id"], "Credit installment due soon",
                f"Installment {upcoming['n']} of \"{agr['title'][:60]}\" ({_usd(installment_open(upcoming))}) is due "
                f"{due:%b %d, %Y}.")
    return True


# ----------------------------------------------------------------------------------------- contribution withdrawals
WITHDRAWAL_STATUSES = ("requested", "paying", "paid", "declined", "cancelled")


async def contribution_position(user_id: str, *, exclude: str | None = None) -> dict:
    """What the contributor may ask back: net contributions, less their pro-rata share of written-off losses, less
    requests already waiting. Fee attribution is never paid out: it is an illustration only."""
    mine = [c for c in await store.find("credit_contributions", {"user_id": user_id}, limit=1000) if c.get("ledger_seq") is not None]
    requests = await store.find("credit_withdrawals", {"user_id": user_id}, limit=1000)
    contributed = sum(c["amount_cents"] for c in mine)
    withdrawn = sum(w["amount_cents"] for w in requests if w["status"] == "paid")
    pending = sum(w["amount_cents"] for w in requests if w["status"] in ("requested", "paying") and w["id"] != exclude)
    bal = await balances()
    pool_total = -ledger.usd(bal, CAPITAL)
    net = contributed - withdrawn
    loss_share = ledger.usd(bal, LOSSES) * net // pool_total if pool_total > 0 else 0
    return {"contributedCents": contributed, "withdrawnCents": withdrawn, "netCents": net, "pendingCents": pending,
            "lossShareCents": loss_share, "withdrawableCents": max(0, net - loss_share - pending),
            "poolAvailableCents": ledger.usd(bal, CASH)}


async def request_withdrawal(user: dict, amount: int, idem: str, note: str = "") -> dict:
    rows = await store.find("credit_withdrawals", {"user_id": user["id"], "idem": idem}, limit=1)
    if rows:
        if rows[0]["amount_cents"] != amount:
            raise CreditError("This request key was already used for a different amount.", 409)
        return rows[0]
    position = await contribution_position(user["id"])
    if amount < MIN_CONTRIBUTION:
        raise CreditError(f"Withdraw at least ${MIN_CONTRIBUTION // 100}.", 422)
    if amount > position["withdrawableCents"]:
        raise CreditError(f"You can ask for up to {_usd(position['withdrawableCents'])} (your net contributions, less your "
                          "share of losses and requests already waiting).", 422)
    try:
        record = await store.insert("credit_withdrawals", user["id"], {
            "amount_cents": amount, "idem": idem, "status": "requested", "note": " ".join(note.split())[:300] or None,
            "ledger_seq": None, "settlement": "simulated"})
    except store.Conflict:
        return (await store.find("credit_withdrawals", {"user_id": user["id"], "idem": idem}, limit=1))[0]
    await audit(user, "withdrawal_requested", "credit_withdrawal", record["id"], {"amount_cents": amount})
    await _tell_operators("Contribution withdrawal request", f"{_usd(amount)} requested back from the demo credit pool.")
    return record


async def cancel_withdrawal(user: dict, withdrawal_id: str) -> dict:
    record = await store.get("credit_withdrawals", withdrawal_id, user_id=user["id"])
    if not record or record["status"] != "requested":
        raise CreditError("There is no waiting request to cancel.", 404)
    out = await _cas("credit_withdrawals", record, {"status": "cancelled", "decided_at": now()})
    await audit(user, "withdrawal_cancelled", "credit_withdrawal", withdrawal_id, {})
    return out


async def _pay_withdrawal(record: dict, actor: dict) -> dict:
    """Post the payout of an approved request (status paying) and mark it paid. Idempotent (fixed ledger key)."""
    amount = record["amount_cents"]
    entry = await ledger.post("credit_withdrawal", [line(CASH, -amount), line(CAPITAL, amount)],
                              memo="Simulated contribution withdrawal from the AutoGig demo pool",
                              refs={"user_id": record["user_id"], "withdrawal_id": record["id"]},
                              idem=f"credit-withdrawal:{record['id']}", check=ledger.require_non_negative(CASH))
    out = await _mark("credit_withdrawals", record["id"], {"status": "paid", "ledger_seq": entry["seq"], "paid_at": now()})
    await audit(actor, "withdrawal_paid", "credit_withdrawal", record["id"], {"amount_cents": amount})
    return out


async def review_withdrawal(owner: dict, withdrawal_id: str, *, approve: bool, note: str = "") -> dict:
    record = await store.get("credit_withdrawals", withdrawal_id)
    if not record:
        raise CreditError("Withdrawal request not found.", 404)
    if record["user_id"] == owner["id"]:
        raise CreditError("You cannot review your own request.", 403)
    if record["status"] == "paying":
        return await _pay_withdrawal(record, owner)          # finish an interrupted approval
    if record["status"] != "requested":
        raise CreditError(f"This request is already {record['status']}.", 409)
    note = " ".join(note.split())[:300]
    if not approve:
        out = await _cas("credit_withdrawals", record, {"status": "declined", "review_note": note or None, "decided_at": now()})
        await audit(owner, "withdrawal_declined", "credit_withdrawal", withdrawal_id, {})
        await _tell(record["user_id"], "Withdrawal request declined",
                    f"Your request for {_usd(record['amount_cents'])} was declined." + (f" Note: {note}" if note else ""), "warning")
        return out
    position = await contribution_position(record["user_id"], exclude=record["id"])
    if record["amount_cents"] > position["withdrawableCents"]:
        raise CreditError(f"The contributor can now withdraw at most {_usd(position['withdrawableCents'])}; decline this request "
                          "and ask for a new one.", 409)
    paying = await _cas("credit_withdrawals", record, {"status": "paying", "review_note": note or None, "decided_at": now()})
    try:
        out = await _pay_withdrawal(paying, owner)
    except LedgerRejected:
        await _mark("credit_withdrawals", record["id"], {"status": "requested"})
        raise CreditError("The pool doesn't have enough uncommitted cash right now (money is out in credit or set aside for "
                          "offers). Approve it after repayments come in.", 409)
    await _tell(record["user_id"], "Withdrawal paid", f"{_usd(record['amount_cents'])} of your contributions was returned.", "success")
    return out


async def scheduled_pass() -> dict | None:
    """What the background scheduler runs. Never raises."""
    try:
        return await run_jobs()
    except Exception as exc:
        import logging
        logging.getLogger("autopilot.credit").error("scheduled credit pass failed (%s)", type(exc).__name__)
        return None


async def scheduler_loop(interval_seconds: int = 3600) -> None:
    import asyncio
    while True:
        await scheduled_pass()
        await asyncio.sleep(interval_seconds)


# ------------------------------------------------------------------------------------------------- private documents
async def add_document(user: dict, app_id: str, label: str, data: bytes) -> dict:
    app = await store.get("credit_applications", app_id, user_id=user["id"])
    if not app or app["status"] != "submitted":
        raise CreditError("Documents can be added only while your application is waiting for review.", 404)
    label = label.strip()[:80]
    if not label:
        raise CreditError("Give the document a short label.", 422)
    if not data or len(data) > MAX_DOC_BYTES:
        raise CreditError(f"Each file must be between 1 byte and {MAX_DOC_BYTES // (1024 * 1024)} MB.", 422)
    mime, ext = sniff_document(data)
    import hashlib
    existing = await store.find("credit_documents", {"application_id": app_id}, limit=20)
    if len(existing) >= MAX_DOCS:
        raise CreditError(f"At most {MAX_DOCS} documents per application.", 409)
    slot = max((d["slot"] for d in existing), default=0) + 1
    try:
        rec = await store.insert("credit_documents", user["id"], {
            "application_id": app_id, "slot": slot, "label": label, "mime": mime, "ext": ext, "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "data": data})
    except store.Conflict:
        raise CreditError("Another upload happened at the same moment. Try again.", 409)
    await audit(user, "document_uploaded", "credit_document", rec["id"], {"size": len(data), "mime": mime})
    return rec


async def documents_for(app_id: str) -> list[dict]:
    rows = await store.find("credit_documents", {"application_id": app_id}, limit=20)
    return sorted(({k: v for k, v in r.items() if k != "data"} for r in rows), key=lambda r: r["slot"])


async def get_document(user: dict, doc_id: str, *, is_owner: bool) -> dict:
    doc = await store.get("credit_documents", doc_id, user_id=None if is_owner else user["id"])
    if not doc:
        raise CreditError("Document not found.", 404)
    if is_owner and doc["user_id"] != user["id"]:
        await audit(user, "document_viewed", "credit_document", doc_id, {"application_id": doc["application_id"]})
    return doc


async def delete_document(user: dict, app_id: str, doc_id: str) -> None:
    app = await store.get("credit_applications", app_id, user_id=user["id"])
    doc = await store.get("credit_documents", doc_id, user_id=user["id"])
    if not app or app["status"] != "submitted" or not doc or doc["application_id"] != app_id:
        raise CreditError("Document not found, or the application is no longer editable.", 404)
    await store.delete("credit_documents", doc_id)
    await audit(user, "document_deleted", "credit_document", doc_id, {})
