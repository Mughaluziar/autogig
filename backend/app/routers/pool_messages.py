"""Messages between a freelancer and an agency in the freelancer pool.

One thread per (spec, freelancer): the freelancer and the agency that posted the spec. It covers questions
before bidding, talk about a bid, and the work on the contract that follows.

Who may start a thread
  freelancer  about a spec that is open for bids, one they bid on (and did not withdraw), or one whose contract
              they hold. The other side is always the agency that posted the spec.
  agency      with a freelancer who bid on one of its specs (a bid the agency can see) or holds its contract.
Once a thread exists either side may write in it while both accounts exist. Nobody else can read it, and a
thread that isn't yours is reported as not found.

Ordering and read state
  Messages are numbered 1, 2, 3... (`seq`) within their thread; the thread holds the highest number given out.
  Each side has a read marker (`owner_read_seq`, `freelancer_read_seq`) that only moves forward. Unread for a
  side = messages from the other side above that side's marker, counted exactly.
  A retried send with the same `clientId` returns the first message instead of storing a second copy.
  The recipient gets one in-app notification per burst: for the first message they haven't read yet.

Endpoints (prefix /api; agency = role admin)
  GET  /pool/threads                  the caller's threads, latest activity first, with unread counts
  GET  /pool/threads/unread           {unread, threads}: the navigation badge
  GET  /pool/threads/options          what the caller can start a thread about
  POST /pool/threads                  {specId, freelancerId? (agency), message?} -> the thread, created if needed
  GET  /pool/threads/{id}/messages    latest page, or ?before=seq (older) or ?after=seq (newer); &limit
  POST /pool/threads/{id}/messages    {body, clientId?} -> the message
  POST /pool/threads/{id}/read        {seq} -> mark read up to there
"""
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .. import db, ratelimit, repo
from ..auth import current_user
from ..config import get_settings
from ..pool import store

log = logging.getLogger("autopilot.pool.messages")
router = APIRouter(tags=["messages"])

MAX_BODY = 4000
PREVIEW = 140
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


# --------------------------------------------------------------------------- #
# Who is asking, and which side of a thread that makes them
# --------------------------------------------------------------------------- #
async def participant(user: dict = Depends(current_user)) -> dict:
    """The caller plus their side of a thread: "owner" (the agency that posted the spec) or "freelancer"."""
    if user["role"] == "freelancer":
        return {**user, "side": "freelancer"}
    if user["role"] == "admin":
        return {**user, "side": "owner"}
    raise HTTPException(403, "Messages are between freelancers and agencies.")


def _other(side: str) -> str:
    return "freelancer" if side == "owner" else "owner"


def _stamp() -> str:
    """Now, as ISO 8601 with milliseconds: threads sort by it, and two messages in one second stay in order."""
    now = store.now()
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


async def _my_thread(thread_id: str, me: dict) -> dict:
    thread = await store.get("threads", thread_id[:64])
    if not thread or thread.get(f"{me['side']}_id") != me["id"]:
        raise HTTPException(404, "Conversation not found.")
    return thread


async def _display_name(user_id: str, *, agency: bool) -> str | None:
    account = await db.find_user_by_id(user_id)
    if not account:
        return None
    if agency:
        return (account.get("company") or "").strip() or account.get("name") or "Agency"
    return account.get("name") or account["email"].split("@")[0]


async def _bid(spec_id: str, freelancer_id: str) -> dict | None:
    return next(iter(await store.find("bids", {"spec_id": spec_id, "freelancer_id": freelancer_id})), None)


async def _contract_with(spec: dict, freelancer_id: str) -> dict | None:
    if not spec.get("contract_id"):
        return None
    contract = await store.get("contracts", spec["contract_id"])
    return contract if contract and contract["freelancer_id"] == freelancer_id else None


async def _freelancer_may_start(spec: dict, freelancer_id: str) -> bool:
    if spec["status"] == "open":
        return True
    bid = await _bid(spec["id"], freelancer_id)
    if bid and bid["status"] != "withdrawn":
        return True
    return await _contract_with(spec, freelancer_id) is not None


async def _agency_may_start(spec: dict, freelancer_id: str) -> bool:
    bid = await _bid(spec["id"], freelancer_id)
    if bid and bid["status"] != "withdrawn":
        return True
    return await _contract_with(spec, freelancer_id) is not None


# --------------------------------------------------------------------------- #
# Output shapes
# --------------------------------------------------------------------------- #
async def _unread(thread: dict, me: dict) -> int:
    read = int(thread.get(f"{me['side']}_read_seq") or 0)
    if int(thread.get("seq") or 0) <= read:
        return 0
    return await store.count_unread(thread["id"], read, me["id"])


def thread_out(thread: dict, me: dict, unread: int) -> dict:
    side, other = me["side"], _other(me["side"])
    return {
        "id": thread["id"], "specId": thread["spec_id"], "title": thread.get("spec_title", ""),
        "counterpart": {"name": thread.get(f"{other}_name") or "", "role": "agency" if other == "owner" else "freelancer"},
        "lastMessageAt": thread.get("last_message_at"), "lastPreview": thread.get("last_preview") or "",
        "lastFromMe": bool(thread.get("last_sender_id")) and thread.get("last_sender_id") == me["id"],
        "unread": unread, "lastSeq": int(thread.get("seq") or 0),
        "myReadSeq": int(thread.get(f"{side}_read_seq") or 0), "theirReadSeq": int(thread.get(f"{other}_read_seq") or 0),
        "createdAt": thread.get("created_at"),
    }


def message_out(msg: dict, thread: dict, me: dict) -> dict:
    sender_side = msg.get("sender_side", "")
    return {
        "id": msg["id"], "threadId": msg["thread_id"], "seq": msg["seq"], "body": msg.get("body") or "",
        # The sender deleted their account: the text is gone, the place in the conversation stays.
        "removed": msg.get("body") is None, "fromMe": msg.get("sender_id") == me["id"],
        "senderRole": "agency" if sender_side == "owner" else "freelancer",
        "senderName": thread.get(f"{sender_side}_name") or "", "createdAt": msg.get("created_at"),
        "clientId": msg.get("client_id"),
    }


async def _thread_detail(thread: dict, me: dict) -> dict:
    """The thread plus where the work stands, and whether a message can be sent."""
    out = thread_out(thread, me, await _unread(thread, me))
    spec = await store.get("specs", thread["spec_id"])
    bid = await _bid(thread["spec_id"], thread["freelancer_id"])
    contract = await _contract_with(spec, thread["freelancer_id"]) if spec else None
    out["context"] = {
        "specStatus": spec["status"] if spec else None, "bidStatus": bid["status"] if bid else None,
        "contractId": contract["id"] if contract else None, "contractStatus": contract["status"] if contract else None,
    }
    other_exists = await db.find_user_by_id(thread[f"{_other(me['side'])}_id"]) is not None
    out["canSend"] = other_exists
    out["cannotSendReason"] = "" if other_exists else "The other person deleted their account, so this conversation is closed."
    return out


# --------------------------------------------------------------------------- #
# Threads
# --------------------------------------------------------------------------- #
@router.get("/pool/threads")
async def list_threads(me: dict = Depends(participant)):
    rows = await store.find("threads", {f"{me['side']}_id": me["id"]})
    rows.sort(key=lambda t: t.get("activity_at") or "", reverse=True)
    return [thread_out(t, me, await _unread(t, me)) for t in rows[:200]]


@router.get("/pool/threads/unread")
async def unread_total(me: dict = Depends(participant)):
    total = threads = 0
    for thread in await store.find("threads", {f"{me['side']}_id": me["id"]}):
        n = await _unread(thread, me)
        if n:
            total += n
            threads += 1
    return {"unread": total, "threads": threads}


@router.get("/pool/threads/options")
async def thread_options(me: dict = Depends(participant)):
    """Who and what the caller can start a conversation about, with the existing thread if there is one."""
    rank = {"contract": 0, "bid": 1, "open": 2}
    found: dict[tuple, dict] = {}

    def offer(key: tuple, option: dict) -> None:
        if key not in found or rank[option["context"]] < rank[found[key]["context"]]:
            found[key] = option

    if me["side"] == "freelancer":
        existing = {t["spec_id"]: t["id"] for t in await store.find("threads", {"freelancer_id": me["id"]})}
        for spec in await store.find("specs", {"status": "open"}):
            offer((spec["id"],), {"specId": spec["id"], "title": spec["title"], "context": "open", "detail": "Open for bids"})
        for bid in await store.find("bids", {"freelancer_id": me["id"]}):
            if bid["status"] != "withdrawn":
                offer((bid["spec_id"],), {"specId": bid["spec_id"], "title": bid.get("spec_title", ""), "context": "bid",
                                          "detail": f"Your bid · {bid['status']}"})
        for contract in await store.find("contracts", {"freelancer_id": me["id"]}):
            offer((contract["spec_id"],), {"specId": contract["spec_id"], "title": contract["title"], "context": "contract",
                                           "detail": f"Your contract · {contract['status']}"})
        for key, option in found.items():
            option["threadId"] = existing.get(key[0])
    else:
        existing = {(t["spec_id"], t["freelancer_id"]): t["id"] for t in await store.find("threads", {"owner_id": me["id"]})}
        for spec in await store.find("specs", {"owner_id": me["id"]}):
            for bid in await store.find("bids", {"spec_id": spec["id"]}):
                if bid["status"] != "withdrawn":
                    offer((spec["id"], bid["freelancer_id"]), {
                        "specId": spec["id"], "title": spec["title"], "freelancerId": bid["freelancer_id"],
                        "freelancerName": bid.get("freelancer_name", ""), "context": "bid", "detail": f"Bid · {bid['status']}"})
        for contract in await store.find("contracts", {"owner_id": me["id"]}):
            offer((contract["spec_id"], contract["freelancer_id"]), {
                "specId": contract["spec_id"], "title": contract["title"], "freelancerId": contract["freelancer_id"],
                "freelancerName": contract.get("freelancer_name", ""), "context": "contract",
                "detail": f"Contract · {contract['status']}"})
        for key, option in found.items():
            option["threadId"] = existing.get(key)
    return sorted(found.values(), key=lambda o: (rank[o["context"]], o["title"].lower()))


class OpenBody(BaseModel):
    specId: str = Field(min_length=1, max_length=64)
    freelancerId: str | None = Field(default=None, max_length=64)
    message: str | None = Field(default=None, max_length=MAX_BODY)


@router.post("/pool/threads")
async def open_thread(body: OpenBody, me: dict = Depends(participant)):
    """Open the conversation about a spec (creating it the first time), optionally with a first message."""
    spec = await store.get("specs", body.specId)
    if me["side"] == "freelancer":
        freelancer_id = me["id"]
        if not spec:
            raise HTTPException(404, "You can message an agency about an open spec, or one you bid on or hold the contract for.")
    else:
        if not spec or spec["owner_id"] != me["id"]:
            raise HTTPException(404, "Spec not found.")
        if not body.freelancerId:
            raise HTTPException(422, "Choose the freelancer to message.")
        freelancer_id = body.freelancerId[:64]

    # A conversation that already exists stays open to both people, whatever happened to the spec since.
    thread = next(iter(await store.find("threads", {"spec_id": spec["id"], "freelancer_id": freelancer_id})), None)
    created = False
    if not thread:
        if me["side"] == "freelancer" and not await _freelancer_may_start(spec, freelancer_id):
            raise HTTPException(404, "You can message an agency about an open spec, or one you bid on or hold the contract for.")
        if me["side"] == "owner" and not await _agency_may_start(spec, freelancer_id):
            raise HTTPException(404, "You can message a freelancer who bid on this spec or holds its contract.")
        owner_name = await _display_name(spec["owner_id"], agency=True)
        freelancer_name = await _display_name(freelancer_id, agency=False)
        if owner_name is None or freelancer_name is None:
            raise HTTPException(409, "That account no longer exists.")
        thread = await store.insert("threads", {
            "spec_id": spec["id"], "spec_title": spec["title"], "owner_id": spec["owner_id"], "owner_name": owner_name,
            "freelancer_id": freelancer_id, "freelancer_name": freelancer_name, "seq": 0, "owner_read_seq": 0,
            "freelancer_read_seq": 0, "last_message_at": None, "last_preview": "", "last_sender_id": None,
            "activity_at": _stamp(), "started_by": me["side"]})
        if thread is None:      # the other side opened it at the same moment
            thread = next(iter(await store.find("threads", {"spec_id": spec["id"], "freelancer_id": freelancer_id})))
        else:
            created = True
    out: dict = {"created": created}
    if body.message and body.message.strip():
        out["message"] = await _send(thread, me, body.message, None)
        thread = await store.get("threads", thread["id"]) or thread
    out["thread"] = thread_out(thread, me, await _unread(thread, me))
    return out


# --------------------------------------------------------------------------- #
# Messages
# --------------------------------------------------------------------------- #
@router.get("/pool/threads/{thread_id}/messages")
async def get_messages(thread_id: str, after: int | None = Query(default=None, ge=0),
                       before: int | None = Query(default=None, ge=1), limit: int = Query(default=50, ge=1, le=100),
                       me: dict = Depends(participant)):
    """Oldest first. Without a cursor: the latest page, `hasMore` = older messages exist. `before`: the page just
    before that seq, same meaning. `after`: newer messages for polling, `hasMore` = there are more after this page.
    Reading does not mark anything read: the page calls /read for what it actually showed."""
    thread = await _my_thread(thread_id, me)
    if after is not None:
        rows = await store.find_messages(thread["id"], after=after, limit=limit)
        has_more = len(rows) == limit
        # Polling stays cheap: the thread's counters, without looking up the spec and contract again.
        info = thread_out(thread, me, await _unread(thread, me))
    else:
        rows = await store.find_messages(thread["id"], before=before, limit=limit + 1)
        has_more = len(rows) > limit
        rows = rows[1:] if has_more else rows
        info = await _thread_detail(thread, me)
    return {"thread": info, "messages": [message_out(m, thread, me) for m in rows], "hasMore": has_more}


def _clean_text(text: str) -> str:
    return _CONTROL.sub("", text.replace("\r\n", "\n").replace("\r", "\n")).strip()


async def _send(thread: dict, me: dict, text: str, client_id: str | None) -> dict:
    text = _clean_text(text)
    if not text:
        raise HTTPException(422, "Write a message first.")
    if client_id:
        dup = next(iter(await store.find("messages", {"thread_id": thread["id"], "client_id": client_id})), None)
        if dup:
            return message_out(dup, thread, me)
    ok, wait = await ratelimit.allow("general", f"pool-messages:{me['id']}", get_settings().pool_message_rate_per_minute)
    if not ok:
        raise HTTPException(429, "You're sending messages too quickly. Wait a moment and try again.",
                            headers={"Retry-After": str(wait)})
    other = _other(me["side"])
    if await db.find_user_by_id(thread[f"{other}_id"]) is None:
        raise HTTPException(409, "The other person deleted their account, so this conversation is closed.")

    stamp = _stamp()
    bumped = await store.increment("threads", thread["id"], "seq", {
        "last_message_at": stamp, "activity_at": stamp, "last_preview": text[:PREVIEW], "last_sender_id": me["id"]})
    if not bumped:
        raise HTTPException(404, "Conversation not found.")
    seq = bumped["seq"]
    msg = await store.insert("messages", {
        "thread_id": thread["id"], "owner_id": thread["owner_id"], "freelancer_id": thread["freelancer_id"],
        "sender_id": me["id"], "sender_side": me["side"], "body": text, "seq": seq, "client_id": client_id})
    if msg is None:             # the same client id arrived twice at the same moment: return the one that won
        dup = next(iter(await store.find("messages", {"thread_id": thread["id"], "client_id": client_id})))
        return message_out(dup, bumped, me)
    await store.raise_to("threads", thread["id"], f"{me['side']}_read_seq", seq)   # you've read what you answer
    if int(bumped.get(f"{other}_read_seq") or 0) >= seq - 1:
        # The first message they haven't read: one notification per burst, not one per message.
        await repo.notify(thread[f"{other}_id"], "New message",
                          f"{thread.get(me['side'] + '_name') or 'Someone'} sent you a message about \"{thread['spec_title']}\".",
                          "info")
    return message_out(msg, bumped, me)


class SendBody(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_BODY)
    clientId: str | None = Field(default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


@router.post("/pool/threads/{thread_id}/messages")
async def send_message(thread_id: str, body: SendBody, me: dict = Depends(participant)):
    thread = await _my_thread(thread_id, me)
    return await _send(thread, me, body.body, body.clientId)


class ReadBody(BaseModel):
    seq: int = Field(ge=0, le=1_000_000_000)


@router.post("/pool/threads/{thread_id}/read")
async def mark_read(thread_id: str, body: ReadBody, me: dict = Depends(participant)):
    thread = await _my_thread(thread_id, me)
    upto = min(body.seq, int(thread.get("seq") or 0))
    thread = await store.raise_to("threads", thread["id"], f"{me['side']}_read_seq", upto) or thread
    return {"readSeq": int(thread.get(f"{me['side']}_read_seq") or 0), "unread": await _unread(thread, me)}
