"""Bid credits in the freelancer pool.

With POOL_BID_CREDITS on (the default), a freelancer's first bid on a spec spends one bid credit from the
same balance the plans and credit packs fill (routers/billing.py): Basic includes 10, Plus adds 50 a month,
Pro is unlimited. Editing the bid, withdrawing it and bidding again on the same spec cost nothing more.

A credit is given back when the bid never had a chance: the spec closed while the bid was being written, or
the agency closed the spec without hiring anyone. A bid that lost to another freelancer keeps its credit spent.

Each bid records what paid for it in `credit`: "spent" (a credit was taken), "plan" (Pro, nothing taken),
"refunded" (taken and given back) or absent (placed while credits were off, or before they existed).
"""
from .. import repo
from ..config import get_settings
from . import store


def enabled() -> bool:
    return get_settings().pool_bid_credits


async def refund(bid: dict) -> bool:
    """Give back the credit a bid spent, once: the compare-and-set on `credit` stops a second refund."""
    if bid.get("credit") != "spent":
        return False
    # The billing write remembers this bid id atomically with the balance change.
    # If the following bid update fails, a retry finishes it without a second refund.
    await repo.refund_pool_bid_credit_once(bid["freelancer_id"], bid["id"])
    return bool(await store.update("bids", bid["id"], {"credit": "refunded"}, expect={"credit": "spent"}))


async def refund_open_bids(spec_id: str) -> int:
    """The spec closed without anyone being hired: refund every bid that was still in the running."""
    n = 0
    for bid in await store.find("bids", {"spec_id": spec_id, "credit": "spent"}):
        if bid.get("status") in ("submitted", "rejected") and await refund(bid):
            n += 1
    return n
