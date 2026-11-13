"""Agent Fleet Copilot — turns a free-form instruction into one fleet action.

POST /api/fleet/copilot {message, context} -> {reply, action, aiGenerated}
POST /api/fleet/draft   {job…, tone, instructions} -> {proposal, proposalId, aiGenerated}

The browser parses common commands itself (lib/fleet-copilot.ts) and only
sends what it couldn't parse. This route asks the configured LLM (llm.py) for
a short reply plus at most one action from a fixed list. Without an LLM it
answers aiGenerated=false and the browser shows its own help.

The action is a suggestion: it's validated here against the agents the
browser sent, and the browser carries it out inside the user's guardrails.
Nothing in this route touches a marketplace, sends a message or spends money.

/fleet/draft is the Writer agent's proposal draft: the same as Job Radar's
/radar/proposal, plus the user's own prompt and rules for that agent. Drafts
are saved to the same "proposals" collection, so Job Radar lists them too.
"""
import json
import re
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import llm, repo
from ..auth import current_user

router = APIRouter(prefix="/fleet", tags=["fleet"])

_AUTONOMY = {"manual", "assisted", "approve", "auto"}
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class AgentContext(BaseModel):
    id: str = Field(min_length=1, max_length=60)
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["scout", "writer", "applier", "closer", "keeper"]
    state: Literal["running", "paused", "stopped"]
    autonomy: Literal["manual", "assisted", "approve", "auto"]
    lastStatus: str = Field(default="", max_length=20)
    lastSummary: str = Field(default="", max_length=200)
    lastError: str = Field(default="", max_length=200)


class FleetContext(BaseModel):
    agents: list[AgentContext] = Field(default_factory=list, max_length=20)
    pendingApprovals: int = Field(default=0, ge=0, le=10_000)
    killSwitch: bool = False
    quietHours: str = Field(default="", max_length=40)
    dailyCap: int = Field(default=0, ge=0, le=10_000)
    actionsToday: int = Field(default=0, ge=0, le=10_000)


class CopilotBody(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    context: FleetContext = Field(default_factory=FleetContext)


_SYSTEM = """You are Copilot inside Autopilot's Agent Fleet, a control panel for a freelancer's agents:
Scout (scans job feeds), Writer (drafts proposals), Applier (follow-ups on the pipeline),
Closer (drafts inbox replies), Account Keeper (checks accounts and credits).
Agents never send anything to clients or marketplaces; drafts wait for the user's approval.

Answer the user in at most 3 short sentences, using only facts in the fleet context.
If the user asks for a change, also return ONE action. Reply with JSON only:
{"reply": "...", "action": null | {"type": ..., ...}}

Allowed actions (ids must be agent ids from the context):
{"type":"pause","ids":["<id>",...] or "all"}
{"type":"resume","ids":["<id>",...] or "all"}
{"type":"stop","ids":["<id>",...]}
{"type":"kill","on":true|false}
{"type":"run","id":"<id>","query":"<optional search keywords for a scout>","dryRun":false}
{"type":"explain","id":"<id>"}
{"type":"autonomy","id":"<id>","level":"manual"|"assisted"|"approve"|"auto"}
{"type":"cap","value":<1-500>}
{"type":"quiet","start":"HH:MM","end":"HH:MM"}
{"type":"quiet-off"}
{"type":"status"} {"type":"approvals"} {"type":"digest"} {"type":"help"}
Never invent agents, numbers or results."""


def _extract_json(text: str) -> dict | None:
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fenced:
        text = fenced.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(text[start:end + 1])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _valid_action(raw: object, agent_ids: set[str]) -> dict | None:
    """Only well-formed actions on agents the user actually has survive."""
    if not isinstance(raw, dict):
        return None
    kind = raw.get("type")

    def ids_ok(value: object, allow_all: bool) -> list[str] | str | None:
        if allow_all and value == "all":
            return "all"
        if isinstance(value, list):
            ids = [i for i in value if isinstance(i, str) and i in agent_ids]
            return ids or None
        return None

    if kind in ("pause", "resume"):
        ids = ids_ok(raw.get("ids"), allow_all=True)
        return {"type": kind, "ids": ids} if ids else None
    if kind == "stop":
        ids = ids_ok(raw.get("ids"), allow_all=False)
        return {"type": "stop", "ids": ids} if ids else None
    if kind == "kill" and isinstance(raw.get("on"), bool):
        return {"type": "kill", "on": raw["on"]}
    if kind in ("run", "explain", "autonomy"):
        agent_id = raw.get("id")
        if not isinstance(agent_id, str) or agent_id not in agent_ids:
            return None
        if kind == "explain":
            return {"type": "explain", "id": agent_id}
        if kind == "autonomy":
            level = raw.get("level")
            return {"type": "autonomy", "id": agent_id, "level": level} if level in _AUTONOMY else None
        action: dict = {"type": "run", "id": agent_id, "dryRun": raw.get("dryRun") is True}
        query = raw.get("query")
        if isinstance(query, str) and query.strip():
            action["query"] = query.strip()[:120]
        return action
    if kind == "cap":
        value = raw.get("value")
        if isinstance(value, (int, float)) and not isinstance(value, bool) and 1 <= value <= 500:
            return {"type": "cap", "value": int(value)}
        return None
    if kind == "quiet":
        start, end = raw.get("start"), raw.get("end")
        if isinstance(start, str) and isinstance(end, str) and _HHMM.match(start) and _HHMM.match(end):
            return {"type": "quiet", "start": start, "end": end}
        return None
    if kind in ("quiet-off", "status", "approvals", "digest", "help"):
        return {"type": kind}
    return None


@router.post("/copilot")
async def copilot(body: CopilotBody, user: dict = Depends(current_user)):
    if not llm.enabled():
        return {"reply": None, "action": None, "aiGenerated": False}
    context = body.context.model_dump()
    generated = await llm.achat(
        [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": f"Fleet context: {json.dumps(context)}\n\nUser: {body.message}"},
        ],
        max_tokens=300,
        temperature=0.2,
    )
    data = _extract_json(generated or "")
    if not data:
        return {"reply": None, "action": None, "aiGenerated": False}
    reply = data.get("reply")
    reply = reply.strip()[:600] if isinstance(reply, str) and reply.strip() else None
    action = _valid_action(data.get("action"), {a.id for a in body.context.agents})
    return {"reply": reply, "action": action, "aiGenerated": bool(reply or action)}


class DraftBody(BaseModel):
    jobId: str = Field(default="", max_length=160)
    jobTitle: str = Field(min_length=1, max_length=300)
    jobDescription: str = Field(default="", max_length=4000)
    jobUrl: str = Field(default="", max_length=1000)
    platform: str = Field(default="", max_length=100)
    matchScore: int = Field(default=0, ge=0, le=100)
    skills: str = Field(default="", max_length=1000)
    userName: str = Field(default="", max_length=160)
    tone: str = Field(default="professional", max_length=40)
    instructions: str = Field(default="", max_length=1500)


def _template_proposal(body: DraftBody) -> str:
    skills = body.skills or "this kind of work"
    return (
        f"Hi, your posting for \"{body.jobTitle}\" lines up closely with my work in {skills}. "
        "I've delivered similar projects recently and can start right away. "
        "My plan: (1) a quick call to confirm scope and success criteria, (2) a working first version fast, "
        "(3) revisions until you're happy. What's your ideal timeline?"
    )


@router.post("/draft")
async def draft(body: DraftBody, user: dict = Depends(current_user)):
    rules = body.instructions.strip()
    system = (
        "You write winning freelance proposals. 120-160 words, first person, "
        f"{body.tone} tone. Open with a specific hook about THIS job, show relevant "
        "experience, give a concrete 2-3 step plan, end with one question. "
        "No greetings like 'Dear', no placeholders, no invented facts about the freelancer, plain text."
    )
    if rules:
        system += f"\nThe freelancer's own rules for every proposal (follow them unless they conflict with honesty):\n{rules}"
    generated = await llm.achat(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": (
                f"Freelancer: {body.userName or 'a specialist'}. Skills: {body.skills or 'not specified'}.\n"
                f"Job title: {body.jobTitle}\nPlatform: {body.platform or 'unknown'}\n"
                f"Job description: {body.jobDescription[:1500]}\n\nWrite the proposal to submit."
            )},
        ],
        max_tokens=500,
    )
    text = (generated or "").strip() or _template_proposal(body)
    saved = await repo.add("proposals", user["id"], {
        "jobId": body.jobId, "jobTitle": body.jobTitle, "jobUrl": body.jobUrl,
        "platform": body.platform, "matchScore": body.matchScore, "body": text,
        "status": "draft", "aiGenerated": bool(generated), "source": "Agent Fleet",
    })
    return {"ok": True, "proposal": text, "proposalId": saved["id"], "aiGenerated": bool(generated)}
