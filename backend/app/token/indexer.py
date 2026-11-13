"""Chain indexer: confirmed events → idempotent capital-ledger entries.

Runs from the worker (queue.scheduled_token_sync) and on demand by an owner.
It only reads the chain. Every posting is keyed by
`chain:<chainId>:<txHash>:<logIndex>`, so re-reading a block range after a
crash or a restart never double-posts.

Each run:
  1. Reads USDC transfers into the Safe and every pool-token Transfer up to
     (head - TOKEN_CONFIRMATIONS), in block/log order, advancing a cursor.
  2. Advances wallet onboarding (identity created → propose registration;
     registered → wallet ready).
  3. Expires unpaid subscriptions and drafts unfreezes for ended lock-ups.
  4. Reconciles on-chain supply and balances with the ledger mirror at the
     same block. A mismatch pauses new subscriptions and alerts operators.
"""
import logging
from datetime import timedelta

from ..capital import ledger, store
from ..capital.ledger import line
from ..config import get_settings
from . import chain, service, state
from .chain import TRANSFER_TOPIC, USDC_UNITS_PER_CENT, ZERO_ADDRESS, address_from_topic, calldata, topic_address

log = logging.getLogger(__name__)
BLOCK_CHUNK = 2_000
MAX_CHUNKS_PER_RUN = 50
UNRECONCILED = "token:unreconciled"


def _event(log_: dict) -> dict:
    return {"block": int(log_["blockNumber"], 16), "index": int(log_["logIndex"], 16), "tx": log_["transactionHash"],
            "from": address_from_topic(log_["topics"][1]), "to": address_from_topic(log_["topics"][2]),
            "value": int(log_["data"], 16), "contract": chain.norm(log_["address"])}


def _idem(event: dict) -> str:
    return f"chain:{get_settings().token_chain_id}:{event['tx']}:{event['index']}"


async def sync() -> dict:
    s = get_settings()
    if not s.token_program_enabled or service.missing_config():
        return {"status": "not_configured"}
    addrs = await service.require_ready()
    head = await chain.block_number() - s.token_confirmations
    cursor_doc = await state.get("cursor") or {"block": max(0, s.token_start_block - 1)}
    cursor = cursor_doc["block"]
    handled = 0
    for _ in range(MAX_CHUNKS_PER_RUN):
        if cursor >= head:
            break
        start, end = cursor + 1, min(head, cursor + BLOCK_CHUNK)
        payments = await chain.get_logs(addrs["usdc"], [TRANSFER_TOPIC, None, topic_address(addrs["safe"])], start, end)
        transfers = await chain.get_logs(addrs["token"], [TRANSFER_TOPIC], start, end)
        events = sorted((_event(item) for item in payments + transfers if not item.get("removed")),
                        key=lambda e: (e["block"], e["index"]))
        for event in events:
            if event["contract"] == addrs["usdc"]:
                await _on_payment(event)
            else:
                await _on_token_transfer(event)
            handled += 1
        cursor = end
        await state.put("cursor", {"block": cursor, "at": store.now()})

    onboarding = await _advance_onboarding(cursor)
    expired = await _expire_subscriptions()
    unfreezes = await _lockups(cursor)
    rec = await reconcile(cursor)
    result = {"status": "ok", "block": cursor, "head": head, "events": handled, "onboarding": onboarding,
              "expired": expired, "unfreezes": unfreezes, "reconciled": rec["ok"]}
    log.info("token sync: %s", result)
    return result


# --------------------------------------------------------------------------- #
# Event handlers (each is safe to run twice on the same event)
# --------------------------------------------------------------------------- #
async def _on_payment(event: dict) -> None:
    idem = _idem(event)
    subs = await store.find("token_subscriptions", {"payment.idem": idem}, limit=1)
    if not subs:
        wallet = await service.wallet_by_address(event["from"])
        candidates = await store.find("token_subscriptions", {
            "wallet": event["from"], "status": "awaiting_payment", "usdc_units": event["value"]}, limit=1)
        if not wallet or not candidates:
            if await store.find("token_alerts", {"refs.idem": idem}, limit=1):
                return
            await service.alert("unmatched_payment",
                                f"{event['value'] / 10 ** chain.USDC_DECIMALS:,.6f} USDC from {event['from']} "
                                "doesn't match an open subscription. Review and refund it from the Safe.",
                                {"idem": idem, "tx": event["tx"], "from": event["from"], "units": event["value"]})
            return
        sub = candidates[0]
        sub = await store.update("token_subscriptions", sub["id"], {
            "status": "minting", "payment": {"idem": idem, "tx": event["tx"], "block": event["block"],
                                             "units": event["value"]}}, expect_version=sub["version"])
        if sub is None:
            return  # changed under us (e.g. cancelled); the next run re-reads this block range
    else:
        sub = subs[0]
    if sub["share_units"] is None:
        cents = event["value"] // USDC_UNITS_PER_CENT
        entry = await service.post_subscription_payment(sub, cents, idem, event["tx"])
        units = next(l["amount"] for l in entry["lines"] if l["account"] == f"token:pending:{sub['user_id']}")
        sub = await store.update("token_subscriptions", sub["id"], {"share_units": units},
                                 expect_version=sub["version"]) or sub
    if sub["mint_proposal_id"] is None and sub["share_units"]:
        token = service.addresses()["token"]
        proposal = await service.propose("mint", sub["user_id"],
                                         f"Mint {service.units_to_tokens(sub['share_units']):,.6f} tokens to {sub['wallet']}",
                                         [{"to": token, "data": calldata(service.SIG_MINT, [sub["wallet"], sub["share_units"]]),
                                           "description": "Token.mint"},
                                          {"to": token, "data": calldata(service.SIG_FREEZE, [sub["wallet"], sub["share_units"]]),
                                           "description": "Token.freezePartialTokens (lock-up)"}],
                                         {"subscription_id": sub["id"], "wallet": sub["wallet"]})
        await store.update("token_subscriptions", sub["id"], {"mint_proposal_id": proposal["id"]},
                           expect_version=sub["version"])


async def _on_token_transfer(event: dict) -> None:
    idem = _idem(event)
    if await ledger.find_by_idem(idem):
        return
    sender, receiver, units = event["from"], event["to"], event["value"]
    refs = {"tx": event["tx"], "block": event["block"]}
    if sender == ZERO_ADDRESS:
        subs = await store.find("token_subscriptions", {"wallet": receiver, "status": "minting",
                                                        "share_units": units}, limit=1)
        if subs:
            sub = subs[0]
            await ledger.post("token_mint", [line(f"token:pending:{sub['user_id']}", -units, "SHARE"),
                                             line(f"token:{receiver}", units, "SHARE")],
                              memo="Pool-share tokens minted", refs={**refs, "user_id": sub["user_id"],
                                                                      "subscription_id": sub["id"]},
                              idem=idem, settlement=service.settlement_label())
            lockup = store.now() + _lockup()
            await store.update("token_subscriptions", sub["id"], {"status": "minted", "minted_at": store.now(),
                                                                  "lockup_until": lockup}, expect_version=sub["version"])
            await service.set_proposal(sub["mint_proposal_id"], "executed")
            return
        lines = [line(f"token:{receiver}", units, "SHARE"), line(UNRECONCILED, -units, "SHARE")]
        detail = f"Unexpected mint of {service.units_to_tokens(units):,.6f} tokens to {receiver}."
    elif receiver == ZERO_ADDRESS:
        lines = [line(f"token:{sender}", -units, "SHARE"), line(UNRECONCILED, units, "SHARE")]
        detail = (f"Burn of {service.units_to_tokens(units):,.6f} tokens from {sender}. Redemptions aren't automated "
                  "yet: settle the payout and the pool's shares by hand, then resolve this alert.")
    else:
        await ledger.post("token_transfer", [line(f"token:{sender}", -units, "SHARE"),
                                             line(f"token:{receiver}", units, "SHARE")],
                          memo="Pool-share token transfer", refs=refs, idem=idem, settlement=service.settlement_label())
        return
    await ledger.post("token_unreconciled", lines, memo=detail, refs=refs, idem=idem,
                      settlement=service.settlement_label())
    await service.alert("unreconciled_supply", detail, {**refs, "idem": idem})


def _lockup() -> timedelta:
    return timedelta(days=get_settings().token_lockup_days)


# --------------------------------------------------------------------------- #
# Housekeeping
# --------------------------------------------------------------------------- #
async def _advance_onboarding(block: int) -> int:
    addrs = service.addresses()
    moved = 0
    for wallet in await store.find("token_wallets", {"status": "linked"}, limit=500):
        if await service.onboard(wallet):
            moved += 1
    for wallet in await store.find("token_wallets", {"status": "identity_pending"}, limit=500):
        identity = chain.norm(await chain.call(addrs["idFactory"], "getIdentity(address)", [wallet["address"]],
                                               ["address"], block))
        if identity != ZERO_ADDRESS:
            await service.propose_registration(wallet, identity)
            moved += 1
    for wallet in await store.find("token_wallets", {"status": "registration_pending"}, limit=500):
        if await chain.call(addrs["identityRegistry"], "isVerified(address)", [wallet["address"]], ["bool"], block):
            await store.update("token_wallets", wallet["id"], {"status": "registered", "registered_at": store.now()},
                               expect_version=wallet["version"])
            await service.set_proposal(wallet.get("register_proposal_id"), "executed")
            moved += 1
    return moved


async def _expire_subscriptions() -> int:
    expired = 0
    for sub in await store.find("token_subscriptions", {"status": "awaiting_payment",
                                                        "expires_at": {"$lte": store.now()}}, limit=500):
        if await store.update("token_subscriptions", sub["id"], {"status": "expired"}, expect_version=sub["version"]):
            expired += 1
    return expired


async def _lockups(block: int) -> int:
    """Draft unfreezes for ended lock-ups, and mark them done once the
    frozen balance on-chain has dropped accordingly."""
    token = service.addresses()["token"]
    drafted = 0
    for sub in await store.find("token_subscriptions", {"status": "minted", "unfreeze_proposal_id": None,
                                                        "lockup_until": {"$lte": store.now()}}, limit=500):
        proposal = await service.propose(
            "unfreeze", sub["user_id"], f"End lock-up: unfreeze {service.units_to_tokens(sub['share_units']):,.6f} "
                                        f"tokens for {sub['wallet']}",
            [{"to": token, "data": calldata(service.SIG_UNFREEZE, [sub["wallet"], sub["share_units"]]),
              "description": "Token.unfreezePartialTokens"}], {"subscription_id": sub["id"], "wallet": sub["wallet"]})
        await store.update("token_subscriptions", sub["id"], {"unfreeze_proposal_id": proposal["id"]},
                           expect_version=sub["version"])
        drafted += 1
    minted = await store.find("token_subscriptions", {"status": "minted"}, limit=2000)
    for wallet in {s["wallet"] for s in minted if s.get("unfreeze_proposal_id")}:
        mine = [s for s in minted if s["wallet"] == wallet]
        still_locked = sum(s["share_units"] for s in mine if not s.get("unfreeze_proposal_id"))
        frozen = await chain.call(token, "getFrozenTokens(address)", [wallet], ["uint256"], block)
        if frozen <= still_locked:
            for sub in (s for s in mine if s.get("unfreeze_proposal_id")):
                await store.update("token_subscriptions", sub["id"], {"status": "unlocked", "unlocked_at": store.now()},
                                   expect_version=sub["version"])
                await service.set_proposal(sub["unfreeze_proposal_id"], "executed")
    return drafted


async def reconcile(block: int) -> dict:
    """Compare on-chain supply and balances with the ledger mirror at `block`."""
    addrs = service.addresses()
    shares = (await ledger.balances()).get("SHARE") or {}
    mirrored = {acct.removeprefix("token:"): units for acct, units in shares.items()
                if acct.startswith("token:0x")}
    ledger_supply = sum(mirrored.values())
    onchain_supply = await chain.call(addrs["token"], "totalSupply()", [], ["uint256"], block)
    balances: dict[str, int] = {}
    mismatches = []
    for address, units in list(mirrored.items())[:500]:
        actual = await chain.call(addrs["token"], "balanceOf(address)", [address], ["uint256"], block)
        balances[address] = actual
        if actual != units:
            mismatches.append({"address": address, "ledger": units, "onchain": actual})
    unreconciled = int(shares.get(UNRECONCILED, 0))
    safe_usdc = await chain.call(addrs["usdc"], "balanceOf(address)", [addrs["safe"]], ["uint256"], block)
    ok = onchain_supply == ledger_supply and not mismatches and unreconciled == 0
    previous = await state.get("reconcile") or {}
    result = {"ok": ok, "at": store.now(), "block": block, "onchainSupply": onchain_supply,
              "ledgerSupply": ledger_supply, "mismatches": mismatches[:50], "unreconciled": unreconciled,
              "safeUsdcUnits": safe_usdc, "balances": balances}
    await state.put("reconcile", result)
    if previous.get("ok", True) and not ok:
        await service._notify("Token reconciliation failed",
                              f"On-chain supply {onchain_supply}, ledger {ledger_supply}, "
                              f"{len(mismatches)} wallet mismatch(es), unreconciled {unreconciled}. "
                              "New subscriptions are paused.")
    return result
