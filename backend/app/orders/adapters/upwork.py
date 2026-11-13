"""Upwork: order/contract notification emails only.

Upwork is a human-in-the-loop integration in this app: Autopilot never calls the
Upwork API, never signs in to Upwork and never stores Upwork credentials
(docs/upwork-assistant.md). Contract and offer notices the user forwards to
their private Autopilot address are recognised here; job-alert emails become
Job Radar leads elsewhere (app/upwork_alerts.py). Orders detected from email
stay unverifiable: the user confirms them on upwork.com.

The subject patterns follow Upwork's usual wording and have NOT been checked
against real notification emails yet.
"""
import re
from dataclasses import dataclass

from ..models import Kind, OrderStatus
from .base import EmailRule, OrderAdapter

_I = re.I


@dataclass
class UpworkAdapter(OrderAdapter):
    key: str = "upwork"
    platform: str = "Upwork"
    email_domains: tuple[str, ...] = ("upwork.com",)
    email_kind: Kind = Kind.CONTRACT
    email_rules: tuple[EmailRule, ...] = (
        EmailRule(re.compile(r"\b(?:offer|contract)\b.*\b(?:cancel|withdrawn|declined|expired)", _I), OrderStatus.CANCELLED),
        EmailRule(re.compile(r"\bcontract\b.*\b(?:ended|closed|complete)", _I), OrderStatus.COMPLETED),
        EmailRule(re.compile(r"\bcontract\b.*\bpaused\b", _I), OrderStatus.PAUSED),
        EmailRule(re.compile(r"\bcontract\b.*\b(?:started|begun|begins)\b|\byou(?:'|’)?ve been hired\b", _I), OrderStatus.ACTIVE),
        EmailRule(re.compile(r"\b(?:new |received an |sent you an )?offer\b", _I), OrderStatus.OFFER),
    )
    # An explicit offer link gives the offer id used in notification emails.
    order_id_pattern: re.Pattern = re.compile(r"upwork\.com/\S*?/offers?/(\d{6,})", _I)
    limitations: tuple[str, ...] = (
        "Upwork contracts are detected from forwarded notification emails only; Autopilot does not connect to Upwork.",
        "Email-detected Upwork orders are never marked verified. Confirm each one on upwork.com.",
        "The notification parser has not yet been checked against real Upwork emails.",
    )

    # ---- email ---------------------------------------------------------------
    def email_title(self, subject: str, body: str) -> str | None:
        # "Your contract has started: Build a dashboard" -> "Build a dashboard"
        tail = subject.split(":", 1)[1] if ":" in subject else subject
        return re.sub(r"\s+", " ", tail).strip().strip("\"'“”").strip()[:200] or None
