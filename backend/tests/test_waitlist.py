"""Landing-page waitlist: public signup, answer sanitising, owner-only listing."""
from conftest import bearer, signup


def join(client, **body):
    payload = {"email": "Maya@Example.com", "product": "credit-card", "consent": True, **body}
    return client.post("/api/waitlist", json=payload)


def test_join_is_public_and_repeat_signup_is_not_an_error(client):
    first = join(client)
    assert first.status_code == 200, first.text
    assert first.json() == {"ok": True, "product": "credit-card", "already": False}
    again = join(client)
    assert again.status_code == 200
    assert again.json()["already"] is True
    # A different product is a separate entry.
    assert join(client, product="debit-card").json()["already"] is False


def test_consent_and_a_real_email_are_required(client):
    assert join(client, consent=False).status_code == 422
    assert join(client, email="not-an-email").status_code == 422
    assert join(client, product="mortgage").status_code == 422


def test_answers_are_limited_to_known_keys_and_sizes(client):
    owner = bearer(signup(client, email="owner@example.com")["token"])
    join(client, answers={
        "role": "agency", "spend": ["software", "ads"] * 10, "rewards": "x" * 500,
        "revenue": "10k-50k", "ssn": "123-45-6789", "nested": {"a": 1},
    })
    rows = client.get("/api/waitlist", headers=owner).json()
    assert len(rows) == 1
    answers = rows[0]["answers"]
    assert rows[0]["email"] == "maya@example.com"
    assert set(answers) == {"role", "spend", "rewards", "revenue"}
    assert len(answers["spend"]) == 8
    assert len(answers["rewards"]) == 80


def test_listing_is_owner_only_and_filters_by_product(client):
    join(client)
    join(client, email="sam@example.com", product="financing", answers={"amount": 25000})
    member = bearer(signup(client, email="member@example.com")["token"])
    assert client.get("/api/waitlist", headers=member).status_code == 403
    owner = bearer(signup(client, email="owner@example.com")["token"])
    rows = client.get("/api/waitlist?product=financing", headers=owner).json()
    assert [r["email"] for r in rows] == ["sam@example.com"]
    assert rows[0]["answers"] == {"amount": 25000}
