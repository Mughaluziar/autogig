"""Banking, Marketplace, Capital and Token are simulated: in 'invited' mode only owners and granted accounts reach them."""
import pytest

from app.config import get_settings
from conftest import bearer, signup

ROUTES = ["/api/capital/overview", "/api/banking/accounts", "/api/marketplace/listings", "/api/token/me"]


@pytest.fixture
def people(client):
    owner = signup(client, email="owner@example.com", role="admin")
    ann = signup(client, email="ann@example.com", role="freelancer")
    inv = signup(client, email="inv@example.com", role="investor")
    return {"owner": bearer(owner["token"]), "ann": bearer(ann["token"]), "inv": bearer(inv["token"]), "ann_id": ann["user"]["id"]}


def status(client, who, path):
    return client.get(path, headers=who).status_code


def test_every_route_is_gated_for_ordinary_users_in_invited_mode(client, people, monkeypatch):
    monkeypatch.setattr(get_settings(), "simulated_modules", "invited")
    for path in ROUTES:
        assert status(client, people["ann"], path) == 403, path
        assert status(client, people["inv"], path) == 403, path
        assert status(client, people["owner"], path) != 403, path
    body = client.get(ROUTES[0], headers=people["ann"]).json()
    assert "demonstration" in body["detail"]


def test_granting_and_revoking_access(client, people, monkeypatch):
    monkeypatch.setattr(get_settings(), "simulated_modules", "invited")
    grant = client.post(f"/api/admin/users/{people['ann_id']}/simulated-access", headers=people["owner"], json={"enabled": True})
    assert grant.status_code == 200
    for path in ROUTES:
        assert status(client, people["ann"], path) != 403, path
    assert client.get("/api/auth/me", headers=people["ann"]).json()["user"]["modules"]["simulated"] is True
    client.post(f"/api/admin/users/{people['ann_id']}/simulated-access", headers=people["owner"], json={"enabled": False})
    assert status(client, people["ann"], ROUTES[0]) == 403
    assert client.get("/api/auth/me", headers=people["ann"]).json()["user"]["modules"]["simulated"] is False


def test_only_owners_can_grant(client, people, monkeypatch):
    monkeypatch.setattr(get_settings(), "simulated_modules", "invited")
    for who in ("ann", "inv"):
        res = client.post(f"/api/admin/users/{people['ann_id']}/simulated-access", headers=people[who], json={"enabled": True})
        assert res.status_code == 403
    assert client.post(f"/api/admin/users/{people['ann_id']}/simulated-access", json={"enabled": True}).status_code == 401
    assert client.post("/api/admin/users/u-nope/simulated-access", headers=people["owner"], json={"enabled": True}).status_code == 404
    assert status(client, people["ann"], ROUTES[0]) == 403


def test_off_mode_leaves_only_owners(client, people, monkeypatch):
    monkeypatch.setattr(get_settings(), "simulated_modules", "off")
    client.post(f"/api/admin/users/{people['ann_id']}/simulated-access", headers=people["owner"], json={"enabled": True})
    assert status(client, people["ann"], ROUTES[0]) == 403               # a grant does nothing while the modules are off
    assert status(client, people["owner"], ROUTES[0]) != 403


def test_all_mode_and_defaults(client, people, monkeypatch):
    monkeypatch.setattr(get_settings(), "simulated_modules", "all")
    assert all(status(client, people["ann"], p) != 403 for p in ROUTES)
    s = get_settings()
    monkeypatch.setattr(s, "simulated_modules", "")
    monkeypatch.setattr(s, "environment", "production")
    assert s.simulated_modules_mode == "invited"                           # production default
    monkeypatch.setattr(s, "environment", "development")
    assert s.simulated_modules_mode == "all"


def test_production_refuses_public_modules_without_the_opt_in(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "environment", "production")
    monkeypatch.setattr(s, "simulated_modules", "all")
    monkeypatch.setattr(s, "allow_public_simulated_modules", False)
    assert any("SIMULATED_MODULES=all" in p for p in s.production_problems())
    monkeypatch.setattr(s, "allow_public_simulated_modules", True)
    assert not any("SIMULATED_MODULES" in p for p in s.production_problems())
    monkeypatch.setattr(s, "simulated_modules", "bogus")
    assert any("must be off, invited or all" in p for p in s.production_problems())
