"""Job Radar detail endpoint — one listing by id for the detail/apply pages."""
import pytest

from conftest import bearer, signup
from app import job_sources
from app.routers import radar

SOURCES = {s.id: s for s in job_sources.SOURCES}


def _row(ref, title, *, tags=(), description="Build things", kind=None):
    return job_sources.job(SOURCES["rok"], ref=ref, title=title, url=f"https://remoteok.com/remote-jobs/{ref}",
                           company="Acme", description=description, tags=tags, kind=kind)


@pytest.fixture
def feed(monkeypatch):
    """Replace the live feeds with a fixed set of rows."""
    radar.reset_recent()
    rows = [
        _row(1, "Senior Python Engineer", tags=["python", "django"], description="P" * 2500),
        _row(2, "Python API Developer", tags=["python", "fastapi"]),
        _row(3, "Django Backend Contractor", tags=["django", "python"], kind="gig"),
        _row(4, "Brand Designer", tags=["figma"]),
    ]
    monkeypatch.setattr(job_sources, "enabled_sources", lambda settings=None: [SOURCES["rok"]])

    async def fetch(source, client, skills):
        return rows

    monkeypatch.setattr(job_sources, "fetch_source", fetch)
    yield rows
    radar.reset_recent()


def test_list_trims_descriptions_and_detail_serves_the_full_text(client, feed):
    alice = bearer(signup(client, email="detail-alice@example.com")["token"])
    listed = client.get("/api/radar/jobs?q=python", headers=alice).json()["jobs"]
    long = next(j for j in listed if j["id"] == "rok-1")
    assert long["truncated"] is True and len(long["description"]) <= 601

    detail = client.get("/api/radar/jobs/rok-1", headers=alice)
    assert detail.status_code == 200
    body = detail.json()
    assert body["origin"] == "scan"
    assert body["job"]["description"] == "P" * 2500
    assert "truncated" not in body["job"]


def test_similar_listings_share_kind_and_skills(client, feed):
    alice = bearer(signup(client, email="similar-alice@example.com")["token"])
    client.get("/api/radar/jobs?q=python", headers=alice)
    similar = client.get("/api/radar/jobs/rok-1", headers=alice).json()["similar"]
    ids = [j["id"] for j in similar]
    assert ids[0] == "rok-2", "shares a tag and title words"
    assert "rok-3" not in ids, "a gig is never offered as a similar job"
    assert "rok-4" not in ids, "nothing in common"
    assert "rok-1" not in ids


def test_detail_is_per_user_and_404s_for_unknown_listings(client, feed):
    alice = bearer(signup(client, email="scope-alice@example.com")["token"])
    bob = bearer(signup(client, email="scope-bob@example.com")["token"])
    client.get("/api/radar/jobs?q=python", headers=alice)
    assert client.get("/api/radar/jobs/rok-1", headers=bob).status_code == 404
    missing = client.get("/api/radar/jobs/rok-999", headers=alice)
    assert missing.status_code == 404
    assert "scan" in missing.json()["detail"]
    assert client.get("/api/radar/jobs/rok-1").status_code == 401


def test_cached_scans_are_remembered_too(client, feed):
    alice = bearer(signup(client, email="cache-alice@example.com")["token"])
    client.get("/api/radar/jobs?q=python", headers=alice)
    radar._RECENT.clear()  # the result cache still answers the next scan
    client.get("/api/radar/jobs?q=python", headers=alice)
    assert client.get("/api/radar/jobs/rok-2", headers=alice).status_code == 200


def test_saved_jobs_stay_reachable_after_the_scan_expires(client, feed):
    alice = bearer(signup(client, email="saved-alice@example.com")["token"])
    job = {"id": "gh-acme-7", "kind": "job", "title": "Staff Engineer", "company": "Acme", "source": "Greenhouse",
           "url": "https://boards.greenhouse.io/acme/jobs/7", "description": "Lead the platform team."}
    assert client.put("/api/radar/saved-jobs/gh-acme-7", headers=alice, json=job).status_code == 200
    body = client.get("/api/radar/jobs/gh-acme-7", headers=alice).json()
    assert body["origin"] == "saved" and body["job"]["title"] == "Staff Engineer"
    assert "proposals" not in body["job"], "unknown signals aren't stored as empty values"


def test_saved_gigs_keep_their_marketplace_signals(client, feed):
    alice = bearer(signup(client, email="signals-alice@example.com")["token"])
    gig = {"id": "flx-9", "kind": "gig", "title": "Django fixes", "url": "https://www.freelancer.com/projects/x",
           "budget": 750, "currency": "USD", "rateType": "fixed", "budgetMin": 250, "proposals": 14}
    assert client.put("/api/radar/saved-jobs/flx-9", headers=alice, json=gig).status_code == 200
    saved = client.get("/api/radar/saved", headers=alice).json()["jobs"][0]
    assert saved["rateType"] == "fixed" and saved["budgetMin"] == 250 and saved["proposals"] == 14
    bad = client.put("/api/radar/saved-jobs/flx-9", headers=alice, json={**gig, "rateType": "weekly"})
    assert bad.status_code == 422


def test_ids_with_slashes_resolve(client, feed):
    alice = bearer(signup(client, email="slash-alice@example.com")["token"])
    me = client.get("/api/auth/me", headers=alice).json()["user"]["id"]
    radar._remember(me, [{**feed[0], "id": "up/~01abc"}])
    assert client.get("/api/radar/jobs/up/~01abc", headers=alice).json()["job"]["id"] == "up/~01abc"


def test_recent_index_is_bounded():
    radar.reset_recent()
    rows = [{"id": f"x-{i}", "title": "t", "kind": "job"} for i in range(radar._RECENT_ROWS + 50)]
    radar._remember("u1", rows)
    kept = radar._recent_rows("u1")
    assert len(kept) == radar._RECENT_ROWS
    assert kept[-1]["id"] == f"x-{radar._RECENT_ROWS + 49}", "newest rows survive"
    radar.reset_recent()
