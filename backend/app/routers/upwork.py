"""Upwork proposal drafting and the manual-submission gate (human-in-the-loop).

Restored after the Upwork API/OAuth/GraphQL integration was retired: nothing here
talks to Upwork.

  GET  /api/upwork/status                 -> how the assistant is set up (email alerts, no API)
  POST /api/upwork/proposal/prepare       -> AI-drafted proposal + suggested rate; saved as a draft; never submitted
  POST /api/upwork/proposal/submit        -> always refuses: copy the proposal and submit it yourself on Upwork
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import llm, repo
from ..auth import current_user
from ..config import get_settings

log = logging.getLogger("autopilot.upwork")
router = APIRouter(tags=["upwork"])


@router.get("/upwork/status")
async def status(user: dict = Depends(current_user)):
    settings = get_settings()
    platforms = {p.strip().lower() for p in settings.inbound_email_platforms.split(",") if p.strip()}
    return {
        "connected": False,
        "mode": "human-in-the-loop",
        "emailAlertsReady": bool(settings.inbound_email_domain and settings.inbound_email_webhook_secret and "upwork" in platforms),
        "note": "Upwork jobs come from the alert emails you forward; you review and submit every proposal yourself.",
    }


class ProposalPrepareBody(BaseModel):
    jobId: str
    title: str
    description: str = ""
    skills: list[str] = []
    type: str = "fixed"
    budget: float | None = None
    hourlyMax: float | None = None
    userName: str = ""


@router.post("/upwork/proposal/prepare")
async def proposal_prepare(body: ProposalPrepareBody, user: dict = Depends(current_user)):
    """Draft an Upwork proposal (cover letter + suggested rate). Does NOT submit."""
    if body.type == "hourly":
        suggested = body.hourlyMax or 50
    else:
        suggested = body.budget or 500
    raw = await llm.achat(
        [
            {"role": "system", "content": (
                "You write winning Upwork proposals. 100-150 words, open with a specific hook from "
                "the job, give a crisp 2-3 step plan, show one relevant proof point, end with a "
                "question. Confident, human, no buzzwords. Plain text only."
            )},
            {"role": "user", "content": (
                f"Job: {body.title}. Details: {body.description[:500]}. "
                f"Skills: {', '.join(body.skills)}. Type: {body.type}. "
                f"Applicant: {body.userName or 'an experienced freelancer'}."
            )},
        ],
        max_tokens=3000,
    )
    proposal = (raw or "").strip()
    ai = bool(proposal and len(proposal) > 40)
    if not ai:
        proposal = (
            f"Hi — your '{body.title}' post is right in my wheelhouse. Here's my plan: "
            f"(1) a quick call to lock scope and success criteria, (2) build in small, reviewable "
            f"milestones, (3) hand off with clean docs. I work with "
            f"{', '.join(body.skills[:3]) or 'your stack'} every week and can share directly relevant "
            f"samples. What's your ideal start date?"
        )
    await repo.log_activity(user["id"], "Upwork assistant", f"Prepared Upwork proposal for '{body.title}'")
    saved = await repo.add("proposals", user["id"], {
        "jobId": body.jobId, "jobTitle": body.title, "platform": "Upwork",
        "body": proposal, "amount": suggested, "status": "draft", "aiGenerated": ai,
    })
    return {"suggestedRate": suggested, "proposal": proposal, "proposalId": saved["id"], "aiGenerated": ai}


class ProposalSubmitBody(BaseModel):
    jobId: str
    proposal: str
    rate: float
    approved: bool = False   # HITL gate — must be explicitly true
    proposalId: str | None = Field(default=None, max_length=100)


@router.post("/upwork/proposal/submit")
async def proposal_submit(body: ProposalSubmitBody, user: dict = Depends(current_user)):
    if not body.approved:
        raise HTTPException(422, "Proposal not approved — human approval required before submitting.")
    if not body.proposal or len(body.proposal) < 30:
        raise HTTPException(422, "Proposal too short.")
    # The API mutation exists, but its complete input (screening answers,
    # terms, attachments and Connects options) is not implemented here.
    raise HTTPException(501, "Live Upwork proposal submission is not implemented yet — copy the proposal and submit it on Upwork.")
