"""Launch gate. Mainnet stays closed until every item below is recorded by a
platform owner with evidence AND TOKEN_MAINNET_ENABLED is true. Test
networks are always allowed; unknown chains never are.

The gate is a record of decisions made outside this app (by counsel,
auditors, the treasury signers). It cannot make an unlawful sale lawful; it
makes sure nobody switches mainnet on by accident or alone.
"""
from .. import repo
from ..capital import store as cstore
from ..config import get_settings
from . import state
from .chain import CHAINS

ITEMS: list[tuple[str, str, str]] = [
    ("securities_opinion", "US securities opinion",
     "Written opinion on the offering exemption (e.g. Reg D 506(c) with Reg S), transfer restrictions and lock-up."),
    ("jurisdiction_opinions", "Other jurisdictions",
     "Opinions for every country in CAPITAL_INVESTOR_JURISDICTIONS (in the EU: MiCA vs. MiFID qualification)."),
    ("insurance_opinion", "Protection fund opinion",
     "Opinion that the discretionary protection fund isn't regulated insurance where we operate, or a licensed carrier."),
    ("kyc_vendor", "Regulated KYC and accreditation",
     "A regulated KYC/AML provider (sanctions, PEP, monitoring) and third-party accreditation verification are live."),
    ("settlement_partner", "Settlement partner",
     "A licensed USDC custody/payments or banking partner is live for subscriptions and redemptions."),
    ("audit", "Independent audit",
     "Audit report(s) for the contracts. Name the audited commit; it must match the deployed bytecode."),
    ("safe_signers", "Treasury signers",
     "Safe owners, threshold and key ceremony recorded; the deployer holds no role on any contract."),
    ("owner_authorization", "Owner authorization",
     "Explicit written authorization from the platform owner to launch on mainnet."),
]
KEYS = {key for key, _, _ in ITEMS}
MIN_EVIDENCE = 10


class GateClosed(Exception):
    pass


async def status() -> dict:
    recorded = await state.prefixed("gate:")
    items = []
    for key, label, description in ITEMS:
        doc = recorded.get(f"gate:{key}") or {}
        items.append({"key": key, "label": label, "description": description, "done": bool(doc.get("done")),
                      "evidence": doc.get("evidence", ""), "recordedBy": doc.get("recorded_by"),
                      "recordedAt": doc.get("recorded_at")})
    return {"items": items, "passed": all(i["done"] for i in items),
            "mainnetEnabled": get_settings().token_mainnet_enabled}


async def record(owner: dict, key: str, done: bool, evidence: str) -> dict:
    if key not in KEYS:
        raise ValueError("Unknown gate item.")
    evidence = (evidence or "").strip()
    if done and len(evidence) < MIN_EVIDENCE:
        raise ValueError("Record the evidence: a document reference, report link or decision note.")
    await state.put(f"gate:{key}", {"done": done, "evidence": evidence[:2000], "recorded_by": owner["email"],
                                    "recorded_at": cstore.now()})
    await repo.log_activity(owner["id"], "Token", f"Launch gate: {key} marked {'done' if done else 'not done'}")
    return await status()


async def check_chain(chain_id: int) -> None:
    """Raise GateClosed unless the program may operate on `chain_id`."""
    chain = CHAINS.get(chain_id)
    if chain is None:
        raise GateClosed(f"Chain {chain_id} isn't supported.")
    if not chain["mainnet"]:
        return
    if not get_settings().token_mainnet_enabled:
        raise GateClosed("Mainnet is off (TOKEN_MAINNET_ENABLED).")
    gate = await status()
    if not gate["passed"]:
        missing = ", ".join(i["label"] for i in gate["items"] if not i["done"])
        raise GateClosed(f"The launch gate isn't complete: {missing}.")
