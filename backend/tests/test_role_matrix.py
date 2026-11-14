"""Direct API access by role: agency (admin), freelancer, investor, platform owner, and nobody.
The browser's access-denied page (lib/access.ts) is only a convenience; this is the authority."""
import pytest

from conftest import bearer, signup

AGENCY_ONLY = ["/api/pool/admin/specs", "/api/pool/admin/contracts", "/api/pool/admin/earnings",
               "/api/automation/jobs", "/api/automation/status", "/api/growth/provider-status",
               "/api/upwork/status", "/api/freelancer/bid-rules"]
FREELANCER_ONLY = ["/api/pool/specs", "/api/pool/my-bids", "/api/pool/my-contracts", "/api/pool/earnings"]
ANY_SIGNED_IN = ["/api/state", "/api/audit-log", "/api/settings", "/api/notifications", "/api/upwork/leads",
                 "/api/user-monetization"]
OWNER_ONLY = ["/api/beta-testers"]


@pytest.fixture
def people(client):
    return {
        "agency": bearer(signup(client, email="agency@example.com", role="admin")["token"]),
        "freelancer": bearer(signup(client, email="fl@example.com", role="freelancer")["token"]),
        "investor": bearer(signup(client, email="inv@example.com", role="investor")["token"]),
        # OWNER_EMAILS in conftest: the platform owner passes every role check, whatever role they signed up as.
        "owner": bearer(signup(client, email="owner@example.com", role="freelancer")["token"]),
    }


def status(client, who, path, people):
    return client.get(path, headers=people[who] if who else {}).status_code


@pytest.mark.parametrize("path", AGENCY_ONLY + FREELANCER_ONLY + ANY_SIGNED_IN + OWNER_ONLY)
def test_nobody_gets_in_without_a_session(client, path):
    assert client.get(path).status_code == 401


@pytest.mark.parametrize("path", AGENCY_ONLY)
def test_agency_only_endpoints(client, people, path):
    assert status(client, "agency", path, people) == 200
    assert status(client, "owner", path, people) == 200
    assert status(client, "freelancer", path, people) == 403
    assert status(client, "investor", path, people) == 403


@pytest.mark.parametrize("path", FREELANCER_ONLY)
def test_freelancer_only_endpoints(client, people, path):
    assert status(client, "freelancer", path, people) == 200
    assert status(client, "owner", path, people) == 200
    assert status(client, "agency", path, people) == 403
    assert status(client, "investor", path, people) == 403


@pytest.mark.parametrize("path", ANY_SIGNED_IN)
def test_endpoints_open_to_every_signed_in_role(client, people, path):
    for who in people:
        assert status(client, who, path, people) == 200, (who, path)


@pytest.mark.parametrize("path", OWNER_ONLY)
def test_owner_only_endpoints(client, people, path):
    assert status(client, "owner", path, people) == 200
    for who in ("agency", "freelancer", "investor"):
        assert status(client, who, path, people) == 403


def test_a_forbidden_response_carries_no_agency_data(client, people):
    agency = people["agency"]
    assert client.post("/api/pool/admin/specs", headers=agency, json={
        "title": "Secret spec", "summary": "s", "stack": ["x"], "estHours": 10, "deadline": "2099-01-01"}).status_code == 200
    for who in ("freelancer", "investor"):
        res = client.get("/api/pool/admin/specs", headers=people[who])
        assert res.status_code == 403 and "Secret spec" not in res.text
