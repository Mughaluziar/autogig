"""MongoDB-only behaviour — skipped unless TEST_MONGODB_URI is set."""
import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient

from app import db, repo
from app.main import app
from conftest import TEST_DB, TEST_MONGODB_URI, run

pytestmark = pytest.mark.skipif(not TEST_MONGODB_URI, reason="needs TEST_MONGODB_URI")


@pytest.fixture
def mongo():
    client = MongoClient(TEST_MONGODB_URI)
    client.drop_database(TEST_DB)
    db._client = db._db = None
    yield client[TEST_DB]
    client.drop_database(TEST_DB)


def test_legacy_shared_state_is_backed_up_not_lost(mongo):
    mongo.app_state.insert_one({"_id": "state", "data": {
        "kpis": {"liveMargin": 1},
        "beta_testers": [{"id": "bt-1", "email": "Bea@Example.com", "name": "Bea"}],
    }})
    with TestClient(app) as client:
        assert mongo.app_state.count_documents({}) == 1
        assert run(client, repo.archive_legacy_state) is True
        assert run(client, repo.archive_legacy_state) is False
    assert mongo.app_state.count_documents({}) == 0
    backups = list(mongo.app_state_backup.find())
    assert len(backups) == 1 and backups[0]["data"]["kpis"] == {"liveMargin": 1}
    assert mongo.beta_testers.find_one({"_id": "bea@example.com"})["name"] == "Bea"


def test_notifications_and_activity_expire(mongo):
    with TestClient(app):
        pass
    for coll, days in (("notifications", 90), ("activity", 180)):
        ttl = [i for i in mongo[coll].list_indexes() if "expireAfterSeconds" in i]
        assert len(ttl) == 1 and ttl[0]["expireAfterSeconds"] == days * 86400


def test_accounts_workspaces_and_simulated_credit_survive_api_restart(mongo):
    from test_credit import APP, contribute, freelancer, offer, uid
    from conftest import bearer, signup

    with TestClient(app) as client:
        owner = bearer(signup(client, email="owner@example.com")["token"])
        investor = bearer(signup(client, email="investor@example.com", role="investor")["token"])
        contribute(client, investor)
        borrower = freelancer(client, owner)
        borrower_id = uid(client, "fl@example.com")
        gig = run(client, repo.add, "gigs", borrower_id, {"title": "Persisted project"})
        application = client.post("/api/credit/applications", headers=borrower, json=APP)
        assert application.status_code == 200
        app_id = application.json()["id"]
        assert offer(client, owner, app_id).status_code == 200
        assert client.post(f"/api/credit/applications/{app_id}/accept", headers=borrower,
                           json={"acceptTerms": True}).status_code == 200

    with TestClient(app) as restarted:
        assert restarted.get("/health").json()["database"] == "ok"
        account = restarted.get("/api/auth/me", headers=investor)
        assert account.status_code == 200 and account.json()["user"]["role"] == "investor"
        assert run(restarted, repo.list_for, "gigs", borrower_id)[0]["id"] == gig["id"]
        assert restarted.get("/api/credit/statement", headers=investor).json()["contributedCents"] == 500_000
        assert restarted.get("/api/credit/agreements", headers=borrower).json()
