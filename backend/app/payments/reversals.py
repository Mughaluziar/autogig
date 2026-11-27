"""Refunds and disputes of pay-link payments: pure state changes on a link document.

The webhook (routers/payments.py) finds the link, runs one of these on a copy and writes the result with the
store's compare-and-set, so a retried or concurrent event can't apply twice and can't overwrite the owner's
refresh. Each change is also monotonic on its own: a refund only ever raises `refunded_cents` (Stripe sends the
charge's cumulative `amount_refunded`), and a closed dispute never reopens, so events arriving twice or out of
order change nothing. Amounts are integer cents.

Milestone states
  due        payable online.
  paid       paid online or by hand. A partial refund keeps it paid and records `refunded_cents`; the milestone is
             settled and the refund was the owner's concession. An open dispute keeps it paid and records `dispute`;
             a won dispute or a closed inquiry leaves it paid.
  refunded   the whole payment went back to the client: a full refund, or a lost dispute. It counts as unpaid in
             the totals, but the client can't pay it online again until the owner re-opens it (POST /api/pay-links
             with `reopen`), marks it paid by hand or removes it; its refunded payment then moves to
             `extra_payments` (see retire) so later events for that charge still find it.

A payment in `extra_payments` (a duplicate, or a retired refunded payment) takes the same refund and dispute
records but never changes a milestone.
"""
from copy import deepcopy
from datetime import datetime, timezone

OPEN_DISPUTE = ("warning_needs_response", "warning_under_review", "needs_response", "under_review")
CLOSED_DISPUTE = ("won", "lost", "warning_closed")


def _records(link: dict, kind: str) -> list[dict]:
    return link["milestones"] if kind == "milestone" else link.setdefault("extra_payments", [])


def paid_cents(record: dict, kind: str) -> int:
    """What the client actually paid for this record."""
    if kind == "milestone":
        return int(record.get("amount_paid_cents") or record["amount_cents"])
    return int(record.get("amount_cents") or 0)


def locate(link: dict, payment_intent: str, milestone_id: str = "") -> tuple[str, int] | None:
    """("milestone", index) or ("extra", index) of the payment made with this PaymentIntent."""
    extra = link.get("extra_payments") or []
    if payment_intent:
        for i, m in enumerate(link["milestones"]):
            if m.get("payment_intent") == payment_intent:
                return ("milestone", i)
        for i, p in enumerate(extra):
            if p.get("payment_intent") == payment_intent:
                return ("extra", i)
    # Paid before PaymentIntent ids were stored: the charge's metadata names the milestone. Only when no older
    # duplicate payment for that milestone (also without an id) could be the one meant.
    if milestone_id:
        for i, m in enumerate(link["milestones"]):
            if (m["id"] == milestone_id and m["status"] in ("paid", "refunded") and not m.get("payment_intent")
                    and m.get("paid_via") not in (None, "manual")):
                if any(p.get("milestone_id") == milestone_id and not p.get("payment_intent") for p in extra):
                    return None
                return ("milestone", i)
    return None


def _fields(link: dict) -> dict:
    return {"milestones": link["milestones"], "extra_payments": link.get("extra_payments") or []}


def _title(link: dict, kind: str, rec: dict) -> str:
    if kind == "milestone":
        return rec["title"]
    m = next((x for x in link["milestones"] if x["id"] == rec.get("milestone_id")), None)
    return m["title"] if m else "a payment"


def refund(link: dict, where: tuple[str, int], payment_intent: str, *, refunded_cents: int, full: bool,
           at: datetime) -> tuple[dict | None, dict]:
    """Record the charge's cumulative refunded amount. Returns (fields to write or None, change)."""
    link = deepcopy(link)
    kind, i = where
    rec = _records(link, kind)[i]
    paid = paid_cents(rec, kind)
    prev = int(rec.get("refunded_cents") or 0)
    total = min(refunded_cents, paid) if paid else refunded_cents
    if total <= prev:
        return None, {"result": "duplicate"}
    full = full or total >= paid
    rec.update(refunded_cents=total, refunded_at=at, payment_intent=payment_intent)
    became = kind == "milestone" and full and rec["status"] == "paid"
    if became:
        rec["status"] = "refunded"
    return _fields(link), {
        "result": "applied", "kind": kind, "title": _title(link, kind, rec), "delta_cents": total - prev,
        "total_cents": total, "paid_cents": paid, "full": full, "became_refunded": became,
    }


def _when(ts) -> datetime | None:
    return datetime.fromtimestamp(ts, timezone.utc) if isinstance(ts, (int, float)) and ts > 0 else None


def dispute(link: dict, where: tuple[str, int], payment_intent: str, obj: dict, *,
            at: datetime) -> tuple[dict | None, dict]:
    """Record a dispute's current state. A lost dispute counts as a full refund. Returns (fields or None, change)."""
    dispute_id, status = str(obj.get("id") or "")[:100], str(obj.get("status") or "")[:40]
    if not dispute_id or not status:
        return None, {"result": "ignored"}
    link = deepcopy(link)
    kind, i = where
    rec = _records(link, kind)[i]
    old = rec.get("dispute") or {}
    same = old.get("id") == dispute_id
    if same and (old.get("status") == status or old.get("status") in CLOSED_DISPUTE):
        return None, {"result": "duplicate"}  # a replay, or an update that arrived after the close
    paid = paid_cents(rec, kind)
    amount = obj.get("amount") if isinstance(obj.get("amount"), int) else paid
    closed = status in CLOSED_DISPUTE
    rec["dispute"] = {
        "id": dispute_id, "status": status, "reason": str(obj.get("reason") or "")[:60], "amount_cents": amount,
        "respond_by": _when((obj.get("evidence_details") or {}).get("due_by")),
        "opened_at": old.get("opened_at") if same else at, "updated_at": at, "closed_at": at if closed else None,
    }
    rec["payment_intent"] = payment_intent or rec.get("payment_intent")
    became = False
    if status == "lost":
        rec["refunded_cents"] = max(int(rec.get("refunded_cents") or 0), paid)
        rec["refunded_at"] = at
        became = kind == "milestone" and rec["status"] == "paid"
        if became:
            rec["status"] = "refunded"
    stage = {"won": "won", "lost": "lost", "warning_closed": "closed"}.get(status) or ("updated" if same else "opened")
    return _fields(link), {
        "result": "applied", "kind": kind, "title": _title(link, kind, rec), "stage": stage, "status": status,
        "reason": rec["dispute"]["reason"], "amount_cents": amount, "respond_by": rec["dispute"]["respond_by"],
        "became_refunded": became,
    }


def retire(milestone: dict, why: str) -> dict:
    """The refunded payment of a milestone the owner re-opened, marked paid by hand or removed, as an
    extra_payments record, so its history stays and later refund/dispute events still find it."""
    return {
        "milestone_id": milestone["id"], "session_id": milestone.get("session_id"),
        "payment_intent": milestone.get("payment_intent"), "amount_cents": paid_cents(milestone, "milestone"),
        "via": milestone.get("paid_via"), "at": milestone.get("paid_at"),
        "refunded_cents": int(milestone.get("refunded_cents") or 0), "refunded_at": milestone.get("refunded_at"),
        "dispute": milestone.get("dispute"), "retired": why,
    }


def holds_money(record: dict) -> bool:
    """An extra payment the client is still owed back (not refunded, not lost in a dispute)."""
    return not record.get("retired") and int(record.get("refunded_cents") or 0) < int(record.get("amount_cents") or 0)
