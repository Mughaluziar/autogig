"""Public endpoints — reachable without signing in.

Marketing pages use these: the pricing page (plans), the beta signup form and
the landing page's early-access waitlist (cards, financing, investing).
Everything else in the API requires a session token (see app/auth.py).
"""
import re
import time
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import repo
from ..store import DB

router = APIRouter(tags=["public"])


@router.get("/plans")
def list_plans():
    return DB["plans"]


# --- Beta testers — signups saved to MongoDB (owners review them in /api/beta-testers) ---
class BetaTesterBody(BaseModel):
    name: str
    email: str
    role: str = "freelancer"
    area: str = ""
    feedback: str = ""
    rating: int = 0


@router.post("/beta-testers")
async def create_beta_tester(body: BetaTesterBody):
    record = {
        "id": f"bt-{uuid4().hex[:8]}",
        "name": body.name.strip()[:120],
        "email": body.email.strip().lower()[:200],
        "role": body.role[:40],
        "area": body.area[:200],
        "feedback": body.feedback[:2000],
        "rating": body.rating,
        "status": "Invited",
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if not await repo.add_beta_tester(record):
        raise HTTPException(409, "This email is already registered for the beta")
    return record


# --- Waitlist — landing-page early access (owners review it in /api/waitlist) ---
# Nothing here is an application for credit or an investment: it records
# interest so the team can follow up when a product opens.
WAITLIST_ANSWER_KEYS = {
    "debit-card": {"role", "revenue", "payout"},
    "credit-card": {"role", "revenue", "spend", "rewards", "platforms", "offer"},
    "financing": {"role", "revenue", "amount", "use", "years"},
    "investor": {"interest", "ticket", "accredited"},
}
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _clean_answer(value):
    """Short strings, short lists of strings, bounded numbers; else dropped."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return max(0, min(float(value), 10_000_000))
    if isinstance(value, str):
        return value.strip()[:80]
    if isinstance(value, list):
        return [str(v).strip()[:60] for v in value[:8] if isinstance(v, (str, int, float))]
    return None


class WaitlistBody(BaseModel):
    email: str = Field(max_length=200)
    product: Literal["debit-card", "credit-card", "financing", "investor"]
    name: str = Field(default="", max_length=120)
    answers: dict = Field(default_factory=dict)
    consent: bool = False


@router.post("/waitlist")
async def join_waitlist(body: WaitlistBody):
    email = body.email.strip().lower()
    if not _EMAIL.match(email):
        raise HTTPException(422, "Enter a valid email address")
    if not body.consent:
        raise HTTPException(422, "Please agree to be contacted about early access")
    allowed = WAITLIST_ANSWER_KEYS[body.product]
    answers = {k: v for k, v in ((k, _clean_answer(v)) for k, v in body.answers.items() if k in allowed) if v not in (None, "", [])}
    record = {
        "id": f"wl-{uuid4().hex[:8]}",
        "product": body.product,
        "email": email,
        "name": body.name.strip()[:120],
        "answers": answers,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    created = await repo.add_waitlist_entry(record)
    # A repeat signup is not an error: the visitor is already on the list.
    return {"ok": True, "product": body.product, "already": not created}
