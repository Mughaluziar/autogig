"""Risk policy for the capital program. Every limit lives here.

Amounts are integer cents. Rates are basis points (1% = 100 bps), so all
money math stays in integers.
"""
from dataclasses import dataclass

from ..config import get_settings

BPS = 10_000


@dataclass(frozen=True)
class Policy:
    # Early payment
    advance_rate_bps: int = 7_000            # up to 70% of a fixed-price order
    fee_bps: int = 300                       # flat 3% of the principal per advance
    min_advance_cents: int = 50_00
    max_advance_cents: int = 2_500_00
    max_outstanding_per_freelancer_cents: int = 5_000_00
    term_days: int = 30
    grace_days: int = 15
    quote_ttl_minutes: int = 15
    # The order must have been confirmed by the platform API this recently.
    order_freshness_hours: int = 24
    # Fee split (sums to BPS)
    investor_share_bps: int = 7_000
    protection_share_bps: int = 2_000
    platform_share_bps: int = 1_000
    # Cash kept back from advances so investors can withdraw.
    liquidity_reserve_bps: int = 1_000
    # Standalone protection
    protection_max_cover_bps: int = 8_000    # up to 80% of the order value
    protection_premium_bps: int = 400        # 4% of the covered amount
    protection_max_cover_cents: int = 2_000_00
    protection_term_days: int = 180
    # Standalone cover can only be bought this soon after an order arrives
    # (orders.arrived_at), so nobody insures an order once it looks troubled.
    protection_offer_window_hours: int = 24

    def __post_init__(self):
        assert self.investor_share_bps + self.protection_share_bps + self.platform_share_bps == BPS


DEFAULT_POLICY = Policy()

# Currencies the pool can lend in. The pool is USD-denominated (USDC once a
# settlement partner exists), so only USD orders are financed for now.
POOL_CURRENCY = "USD"

# Order states that count as a loss for protection: the client cancelled or
# was refunded. "disputed" waits for the platform's resolution.
LOSS_STATUSES = frozenset({"cancelled", "refunded"})
PENDING_LOSS_STATUSES = frozenset({"disputed"})
ADVANCEABLE_STATUSES = frozenset({"active", "delivered"})
# Only statuses the platform API itself reported count as evidence.
TRUSTED_STATUS_SOURCES = frozenset({"api_sync", "webhook"})


def policy() -> Policy:
    return DEFAULT_POLICY


def investor_jurisdictions() -> set[str]:
    """Allowed investor countries (ISO-2). Empty = no allowlist, which is
    only acceptable while settlement is simulated."""
    raw = get_settings().capital_investor_jurisdictions
    return {c.strip().upper() for c in raw.split(",") if c.strip()}


def bps_of(amount_cents: int, bps: int) -> int:
    """Floor of amount × bps / 10,000 in integer math."""
    return amount_cents * bps // BPS


def split_fee(fee_cents: int, p: Policy) -> dict[str, int]:
    """Split a fee into investor / protection / platform shares. Rounding
    remainders go to investors so the parts always sum to the fee."""
    protection = bps_of(fee_cents, p.protection_share_bps)
    platform = bps_of(fee_cents, p.platform_share_bps)
    return {"investors": fee_cents - protection - platform, "protection": protection, "platform": platform}
