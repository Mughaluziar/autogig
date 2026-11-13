"""Upwork job leads from the user's own alert emails — the human-in-the-loop assistant.

What this does:   reads Upwork job-alert emails the user forwards (or Outlook-syncs)
                  to their private Autopilot inbox address, turns each job into a
                  lead, and shows it in Job Radar where the user can have an AI
                  draft a proposal, edit it, copy it, and open the original job.
What it never does: call the Upwork API, log in to Upwork, store Upwork passwords or
                  cookies, or submit a proposal. The user always reads, edits and
                  submits on upwork.com themselves.

Endpoints (any signed-in user; every row is scoped to the caller):
  GET    /api/upwork/leads                list leads (newest first)
  GET    /api/upwork/leads/{id}           one lead
  POST   /api/upwork/leads/import         paste an alert email or a single job by hand
  PATCH  /api/upwork/leads/{id}           {status: new|dismissed}
"""
import logging
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import repo, upwork_alerts as alerts
from ..auth import current_user

log = logging.getLogger("autopilot.upwork_leads")
router = APIRouter(tags=["upwork-leads"])

LEAD_ID_PREFIX = "upwork-lead:"
MAX_LEADS_PER_EMAIL = 25
MANUAL_SUBMISSION_NOTICE = (
    "Review and edit this proposal, then submit it yourself on Upwork. "
    "Autopilot never submits proposals or logs in to Upwork for you."
)


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def lead_listing(lead: dict) -> dict:
    """A stored lead as a Job Radar listing (the shape /api/radar/jobs returns)."""
    return {
        "id": f"{LEAD_ID_PREFIX}{lead['id']}",
        "kind": "gig",
        "title": lead.get("title", "Upwork job"),
        "company": lead.get("company", "Upwork client"),
        "source": alerts.SOURCE,
        "url": lead.get("url", ""),
        "tags": lead.get("tags", []),
        "budget": lead.get("budget"),
        "budgetMin": lead.get("budgetMin"),
        "currency": lead.get("currency", "USD"),
        "rateType": lead.get("rateType"),
        "description": lead.get("description", ""),
        "postedAt": lead.get("postedAt", ""),
        "proposals": None,
        "clientVerified": None,
        "manualSubmitOnly": True,
        "leadId": lead["id"],
    }


async def ingest_alert(user_id: str, subject: str, text_body: str, html_body: str,
                       received_at: str = "", *, notify: bool = True) -> dict:
    """Store every job in one alert email as a lead. Idempotent: a job the user
    already has (same Upwork job id) is counted as a duplicate, not re-added."""
    jobs = alerts.parse_alert(subject, text_body, html_body)[:MAX_LEADS_PER_EMAIL]
    return await store_jobs(user_id, jobs, received_at or _now(), notify=notify)


async def store_jobs(user_id: str, jobs: list, received_at: str, *, notify: bool = True) -> dict:
    added: list[dict] = []
    duplicates = 0
    for job in jobs:
        lead = await repo.add_unique("upwork_leads", user_id, {
            **job.listing_fields(received_at), "status": "new",
        }, job.dedupe_key)
        if lead:
            added.append(lead)
        else:
            duplicates += 1
    if added and notify:
        first = added[0]["title"]
        body = first if len(added) == 1 else f"{first} and {len(added) - 1} more"
        await repo.notify(user_id, f"{len(added)} new Upwork job{'s' if len(added) != 1 else ''}", body, "info")
    return {"added": len(added), "duplicates": duplicates, "found": len(jobs),
            "leads": [lead_listing(lead) for lead in added]}


async def listings_for_radar(user_id: str, limit: int = 100) -> list[dict]:
    """The user's undismissed leads as radar listings (used by /api/radar/jobs)."""
    leads = await repo.list_for("upwork_leads", user_id, limit=limit)
    return [lead_listing(lead) for lead in leads if lead.get("status") != "dismissed"]


async def listing_by_id(user_id: str, listing_id: str) -> dict | None:
    if not listing_id.startswith(LEAD_ID_PREFIX):
        return None
    lead = await repo.get("upwork_leads", user_id, listing_id[len(LEAD_ID_PREFIX):][:64])
    return lead_listing(lead) if lead else None


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@router.get("/upwork/leads")
async def list_leads(status: str = "", limit: int = 100, user: dict = Depends(current_user)):
    if not 1 <= limit <= 200:
        raise HTTPException(422, "limit must be between 1 and 200")
    leads = await repo.list_for("upwork_leads", user["id"], limit=200)
    if status:
        leads = [lead for lead in leads if lead.get("status") == status]
    else:
        leads = [lead for lead in leads if lead.get("status") != "dismissed"]
    return {"leads": [{**lead_listing(lead), "status": lead.get("status", "new"),
                       "receivedAt": lead.get("postedAt", "")} for lead in leads[:limit]],
            "notice": MANUAL_SUBMISSION_NOTICE}


@router.get("/upwork/leads/{lead_id}")
async def get_lead(lead_id: str, user: dict = Depends(current_user)):
    lead = await repo.get("upwork_leads", user["id"], lead_id[:64])
    if not lead:
        raise HTTPException(404, "Lead not found")
    return {**lead_listing(lead), "status": lead.get("status", "new"), "notice": MANUAL_SUBMISSION_NOTICE}


class ImportBody(BaseModel):
    # Either paste a whole alert email (text and/or HTML)…
    subject: str = Field(default="", max_length=500)
    text: str = Field(default="", max_length=100_000)
    html: str = Field(default="", max_length=200_000)
    # …or describe a single job by hand.
    title: str = Field(default="", max_length=300)
    url: str = Field(default="", max_length=1000)
    description: str = Field(default="", max_length=4000)
    skills: list[str] = Field(default_factory=list, max_length=15)
    budget: float | None = Field(default=None, ge=0, le=10_000_000)
    rateType: Literal["hourly", "fixed"] | None = None


@router.post("/upwork/leads/import")
async def import_leads(body: ImportBody, user: dict = Depends(current_user)):
    if body.title.strip():
        jobs = [alerts.manual_job(body.title, body.url, body.description, body.skills, body.budget, body.rateType)]
    elif body.text.strip() or body.html.strip():
        jobs = alerts.parse_alert(body.subject, body.text, body.html)[:MAX_LEADS_PER_EMAIL]
        if not jobs:
            raise HTTPException(422, "No Upwork job links were found in that text. Paste the whole alert email, "
                                     "or enter the job's title and link yourself.")
    else:
        raise HTTPException(422, "Paste an Upwork alert email, or enter a job title.")
    result = await store_jobs(user["id"], jobs, _now(), notify=False)
    await repo.log_activity(user["id"], "Upwork assistant",
                            f"Imported {result['added']} Upwork job(s) ({result['duplicates']} already saved)")
    return result


class LeadPatch(BaseModel):
    status: Literal["new", "dismissed"]


@router.patch("/upwork/leads/{lead_id}")
async def patch_lead(lead_id: str, body: LeadPatch, user: dict = Depends(current_user)):
    lead = await repo.update("upwork_leads", user["id"], lead_id[:64], {"status": body.status})
    if not lead:
        raise HTTPException(404, "Lead not found")
    return {"ok": True, "status": lead["status"]}
