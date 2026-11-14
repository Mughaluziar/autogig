"""Every collection the app writes must be classified in datarights.DATA_MAP (export / delete / anonymize / retain),
so a new feature cannot quietly store personal data that account deletion and export would miss."""
import re
from pathlib import Path

import pytest

from app import datarights, repo
from app.capital import store as capital_store
from app.pool import store as pool_store
from conftest import TEST_MONGODB_URI, bearer, signup

APP = Path(__file__).resolve().parents[1] / "app"
ACCESS = re.compile(r"(?:\bmdb|_get_db\(\)|\bdb)\.([a-z][a-z_]+)\.(?:find|insert|update|delete|create_index|count|replace|aggregate|distinct|bulk)")
PAYMENT_NAMES = re.compile(r"\.(pay_links|subscriptions)\b")


def collections_in_source() -> set[str]:
    names: set[str] = set()
    for path in APP.rglob("*.py"):
        text = path.read_text()
        names |= set(ACCESS.findall(text))
        names |= set(PAYMENT_NAMES.findall(text))
    names |= set(repo.LIST_COLLECTIONS) | set(capital_store.COLLECTIONS)
    names |= {f"pool_{c}" for c in pool_store.COLLECTIONS}
    # not collections: attribute names of the db helper module and the drivers
    return names - {"enabled", "find_user", "update_user", "list_users", "create_user", "users_collection"}


def test_every_collection_in_the_source_is_classified():
    missing = sorted(n for n in collections_in_source() if n not in datarights.DATA_MAP)
    assert not missing, f"Classify these collections in app/datarights.py DATA_MAP (export/delete/scrub/keep/none): {missing}"


def test_every_entry_has_a_valid_action_and_a_reason():
    for name, c in datarights.DATA_MAP.items():
        assert c.name == name
        assert c.action in ("delete", "scrub", "keep", "none"), name
        assert c.why.strip(), f"{name} needs a one-line reason"
        if c.action in ("delete", "scrub", "keep") and name not in ("capital_head",):
            assert c.owner, f"{name} has an action but no owner rule"
        if not db_enabled() and c.owner:
            assert c.mem is not None, f"{name} needs an in-memory accessor so memory-mode tests cover it"


def db_enabled() -> bool:
    return bool(TEST_MONGODB_URI)


@pytest.mark.skipif(not TEST_MONGODB_URI, reason="needs a real MongoDB")
def test_collections_a_real_workflow_creates_are_classified(client):
    from app import db
    a = bearer(signup(client, email="a@example.com", role="admin")["token"])
    f = bearer(signup(client, email="f@example.com", role="freelancer", name="Fay")["token"])
    client.put("/api/state", headers=a, json={"state": {"x": 1}, "version": 0})
    client.patch("/api/settings", headers=a, json={"matchThreshold": 70})
    client.post("/api/api-keys", headers=a, json={"name": "k", "scopes": ["read"], "expiresInDays": 30})
    client.post("/api/pool/admin/specs", headers=a, json={"title": "Spec title", "estHours": 5, "deadline": "2099-01-01"})
    client.post("/api/auth/login", json={"email": "f@example.com", "password": "wrong-password-1"})

    async def names():
        return await db._get_db().list_collection_names()
    live = set(client.portal.call(names))
    unclassified = sorted(n for n in live if n not in datarights.DATA_MAP and not n.startswith("system."))
    assert not unclassified, unclassified


def test_the_lifecycle_document_lists_every_collection():
    doc = (Path(__file__).resolve().parents[2] / "docs" / "data-lifecycle.md").read_text()
    missing = [n for n in datarights.DATA_MAP if f"`{n}`" not in doc]
    assert not missing, f"docs/data-lifecycle.md is out of date; missing: {missing}"
