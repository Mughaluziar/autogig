"""Fiverr — notification email only; orders cannot be verified.

Fiverr publishes no seller-side order API, and its Terms §8.8 prohibit bots
and automated retrieval from the site (docs/platform-matrix.md). Orders are
detected from notification emails the seller forwards, and stay
`unverifiable`: the seller confirms them on fiverr.com.

The subject patterns below follow Fiverr's usual notification wording but
have NOT been checked against real notification samples yet (open item 3 in
docs/platform-matrix.md). Unrecognised emails still reach the unified inbox.
"""
import re
from dataclasses import dataclass

from ..models import OrderStatus
from .base import EmailRule, OrderAdapter

_I = re.I


@dataclass
class FiverrAdapter(OrderAdapter):
    key: str = "fiverr"
    platform: str = "Fiverr"
    email_domains: tuple[str, ...] = ("fiverr.com",)
    email_rules: tuple[EmailRule, ...] = (
        EmailRule(re.compile(r"\border\b.*\bcancel", _I), OrderStatus.CANCELLED),
        EmailRule(re.compile(r"\brefund", _I), OrderStatus.REFUNDED),
        EmailRule(re.compile(r"\border\b.*\bcompleted?\b|\bcompleted?\b.*\border\b", _I), OrderStatus.COMPLETED),
        EmailRule(re.compile(r"\border\b.*\bdelivered\b|\bdelivered\b.*\border\b", _I), OrderStatus.DELIVERED),
        EmailRule(re.compile(r"\breceived (?:a new |an |a )?order\b|\bnew order\b", _I), OrderStatus.ACTIVE),
    )
    # Fiverr order numbers are shown as "#FO" followed by letters and digits.
    order_id_pattern: re.Pattern = re.compile(r"#?\b(FO[A-Z0-9]{6,20})\b")
    limitations: tuple[str, ...] = (
        "Fiverr has no seller order API, and its Terms prohibit bots and automated site access, "
        "so orders can be detected from forwarded notification emails only.",
        "Email-detected Fiverr orders are never marked verified. Confirm each one on fiverr.com.",
        "The notification parser has not yet been checked against real Fiverr emails.",
    )

    def email_client(self, subject: str, body: str) -> str | None:
        match = re.search(r"\border from ([A-Za-z0-9_.-]{2,40})", subject, _I)
        return match.group(1) if match else None
