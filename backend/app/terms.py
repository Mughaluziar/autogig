"""Terms of Service / Privacy Policy acceptance, recorded on the server.

Every acceptance is appended to `terms_acceptances` (never edited): user id, the exact document versions, the UTC time
and how it happened. The latest one is mirrored on the account (`terms_accepted`) so sign-in responses can say, without
another query, whether the person must accept a newer version. Versions come from settings (TERMS_VERSION,
PRIVACY_VERSION); a "draft-..." version means the text has not been reviewed by a lawyer."""
from typing import Literal

from . import db, rights_store
from .config import get_settings


def current() -> dict[str, str]:
    s = get_settings()
    return {"terms": s.terms_version, "privacy": s.privacy_version}


def required() -> bool:
    return get_settings().require_terms_acceptance


def needs_acceptance(user_doc: dict) -> bool:
    if not required():
        return False
    return (user_doc.get("terms_accepted") or {}).get("versions") != current()


async def record(user_doc: dict, method: Literal["signup", "reaccept"], versions: dict[str, str]) -> dict:
    row = await rights_store.add("terms_acceptances", {
        "user_id": user_doc["id"], "terms_version": versions["terms"], "privacy_version": versions["privacy"],
        "accepted_at": rights_store.now(), "method": method,
    })
    await db.update_user(user_doc["email"], {"terms_accepted": {"versions": dict(versions), "at": row["accepted_at"]}})
    return row


def versions_match(sent: dict | None) -> bool:
    return bool(sent) and sent.get("terms") == current()["terms"] and sent.get("privacy") == current()["privacy"]
