"""Who may open the simulated money modules (Banking, Marketplace, Capital, Token).

These record entries in Autopilot's own ledger and move no real money. They are meant for controlled investor
demonstrations, not for ordinary public users, so access is a setting (SIMULATED_MODULES):
  off      only platform owners
  invited  platform owners and accounts an owner has granted access to (the production default)
  all      every signed-in user (the default outside production)
"""
from fastapi import Depends, HTTPException, Request

from .auth import current_user, is_owner
from .config import get_settings

DENIED = "This module is a demonstration and is not available to your account."


def allowed(account: dict | None, user: dict) -> bool:
    if is_owner(user):
        return True
    mode = get_settings().simulated_modules_mode
    if mode == "all":
        return True
    return mode == "invited" and bool((account or {}).get("simulated_access"))


def require_simulated_access(request: Request, user: dict = Depends(current_user)) -> dict:
    if not allowed(getattr(request.state, "account", None), user):
        raise HTTPException(403, DENIED)
    return user
