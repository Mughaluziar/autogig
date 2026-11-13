"""Order adapter registry.

To add a platform: subclass OrderAdapter in a new module, set what it
supports (connection_kind, email rules, API methods), and add an instance to
_ADAPTERS. Storage, verification, retries, the scheduler, the audit trail
and the dashboard pick it up without changes.
"""
from .base import OrderAdapter
from .fiverr import FiverrAdapter
from .freelancer import FreelancerAdapter
from .upwork import UpworkAdapter

_ADAPTERS: tuple[OrderAdapter, ...] = (UpworkAdapter(), FreelancerAdapter(), FiverrAdapter())
_BY_NAME = {name.lower(): a for a in _ADAPTERS for name in (a.platform, a.key)}

# Marketplaces in docs/platform-matrix.md with no order integration, and why.
UNSUPPORTED_PLATFORMS: list[dict] = [
    {"platform": "Thumbtack", "reason": "Its Partner Platform has lead webhooks, but partner approval hasn't been granted."},
    {"platform": "Malt", "reason": "Its API covers invoices and payments only, and it isn't connected. Client requests arrive by email."},
    {"platform": "PeoplePerHour", "reason": "There's no API, and the notification sender isn't documented. Its terms forbid crawling and auto-responders."},
    {"platform": "Guru", "reason": "There's no API, and the notification sender isn't documented."},
    {"platform": "Lancers", "reason": "The notification sender is documented, but no order email has been reviewed yet."},
    {"platform": "Contra", "reason": "Its terms prohibit automated access and storing other users' data without permission."},
    {"platform": "Toptal", "reason": "There's no talent API, and its website terms prohibit automated access."},
    {"platform": "LinkedIn", "reason": "Its terms prohibit automated access, and it has no order concept."},
]


def get_adapter(platform: str | None) -> OrderAdapter | None:
    return _BY_NAME.get((platform or "").strip().lower())


def all_adapters() -> tuple[OrderAdapter, ...]:
    return _ADAPTERS


__all__ = ["OrderAdapter", "UNSUPPORTED_PLATFORMS", "all_adapters", "get_adapter"]
