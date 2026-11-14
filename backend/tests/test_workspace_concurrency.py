"""Workspace saves under concurrency: PUT /api/state is optimistic (the caller sends the version it
loaded). Normal single-tab saves chain; a stale or simultaneous save is rejected with the newer copy
and never overwrites it. The browser reacts to the 409 by refusing to save further and asking for a
reload (see components/dashboard/dashboard-shell.tsx); these tests cover the server contract.
"""
from concurrent.futures import ThreadPoolExecutor

import pytest

from conftest import bearer, signup


@pytest.fixture
def alice(client):
    return bearer(signup(client, email="alice@example.com")["token"])


def put(client, who, state, version):
    return client.put("/api/state", headers=who, json={"state": state, "version": version})


def test_single_tab_saves_chain_and_persist(client, alice):
    assert client.get("/api/state", headers=alice).json() == {"state": {}, "version": 0}
    version = 0
    for i in range(1, 6):
        res = put(client, alice, {"gigs": [{"n": i}]}, version)
        assert res.status_code == 200 and res.json() == {"version": i}
        version = res.json()["version"]
    assert client.get("/api/state", headers=alice).json() == {"state": {"gigs": [{"n": 5}]}, "version": 5}


def test_stale_tab_is_rejected_with_the_newer_copy_and_does_not_overwrite_it(client, alice):
    assert put(client, alice, {"gigs": ["seed"]}, 0).json() == {"version": 1}
    # Tab A and tab B both loaded version 1.
    assert put(client, alice, {"gigs": ["seed", "from A"]}, 1).json() == {"version": 2}
    stale = put(client, alice, {"gigs": ["seed", "from B"]}, 1)
    assert stale.status_code == 409
    body = stale.json()
    assert body["version"] == 2 and body["state"] == {"gigs": ["seed", "from A"]}      # what B needs to reload
    # Nothing of B's edit reached the server, and the version did not move.
    assert client.get("/api/state", headers=alice).json() == {"state": {"gigs": ["seed", "from A"]}, "version": 2}


def test_rejected_save_can_be_repeated_without_changing_anything(client, alice):
    put(client, alice, {"a": 1}, 0)
    put(client, alice, {"a": 2}, 1)
    for _ in range(3):                                   # a client must not "retry until it wins"
        assert put(client, alice, {"a": "stale"}, 1).status_code == 409
    assert client.get("/api/state", headers=alice).json() == {"state": {"a": 2}, "version": 2}


def test_reloading_then_saving_works_again(client, alice):
    put(client, alice, {"a": 1}, 0)
    put(client, alice, {"a": 2}, 1)
    assert put(client, alice, {"a": "B"}, 1).status_code == 409
    latest = client.get("/api/state", headers=alice).json()          # what "Reload" does
    assert put(client, alice, {"a": "B redone"}, latest["version"]).json() == {"version": 3}


@pytest.mark.parametrize("start", [0, 4])
def test_simultaneous_saves_from_one_version_exactly_one_wins(client, alice, start):
    for v in range(start):                                              # start=4 -> an existing workspace
        assert put(client, alice, {"n": v}, v).status_code == 200
    sent = [{"writer": i, "payload": [i] * 50} for i in range(8)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda s: put(client, alice, s, start), sent))
    codes = sorted(r.status_code for r in results)
    assert codes == [200] + [409] * 7, codes
    winner = next(i for i, r in enumerate(results) if r.status_code == 200)
    stored = client.get("/api/state", headers=alice).json()
    assert stored["version"] == start + 1
    assert stored["state"] == sent[winner]                              # one writer's copy, whole and unmixed
    for r in results:
        if r.status_code == 409:
            assert r.json()["version"] == start + 1 and r.json()["state"] == sent[winner]


def test_workspaces_are_independent_per_user(client, alice):
    bob = bearer(signup(client, email="bob@example.com")["token"])
    put(client, alice, {"owner": "alice"}, 0)
    put(client, alice, {"owner": "alice 2"}, 1)
    assert put(client, bob, {"owner": "bob"}, 0).json() == {"version": 1}      # Bob's version is his own
    assert client.get("/api/state", headers=alice).json()["state"] == {"owner": "alice 2"}


def test_server_owned_fields_are_still_dropped_on_a_successful_save(client, alice):
    assert put(client, alice, {"gigs": [], "monetization": {"plan": "pro"}}, 0).status_code == 200
    assert "monetization" not in client.get("/api/state", headers=alice).json()["state"]


def test_the_workspace_requires_a_session(client):
    assert client.get("/api/state").status_code == 401
    assert client.put("/api/state", json={"state": {}, "version": 0}).status_code == 401
