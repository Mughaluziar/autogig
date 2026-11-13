"""Social sign-in: Google, GitHub, Microsoft and Apple against fake providers."""
import base64
import hashlib
import json
import time
from urllib.parse import parse_qs, urlencode, urlparse

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa

from app import auth, db, oauth
from app.config import get_settings
from conftest import bearer, run, signup

API = "https://api.example.test"


class FakeProviders:
    """Token endpoints and user-info APIs. `people` maps an auth code to who signs in."""

    def __init__(self, monkeypatch):
        self.people: dict[str, dict] = {}
        self.token_forms: list[tuple[str, dict]] = []
        self.apple_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.apple_nonce: str | None = None
        monkeypatch.setattr(oauth, "_post_form", self._post_form)
        monkeypatch.setattr(oauth, "_get_json", self._get_json)
        monkeypatch.setattr(oauth, "_apple_keys", self._apple_keys)

    async def _post_form(self, url, data, headers=None):
        self.token_forms.append((url, dict(data)))
        person = self.people.get(data.get("code"))
        if not person:
            return 400, {"error": "invalid_grant"}
        tokens = {"access_token": f"at-{data['code']}", "token_type": "Bearer"}
        if "microsoftonline" in url:
            tokens["id_token"] = jwt.encode({"aud": "ms-client", "exp": time.time() + 600, **person["claims"]},
                                            "irrelevant-secret-for-unsigned-check-000000", algorithm="HS256")
        if "appleid" in url:
            claims = {"iss": oauth.APPLE_ISSUER, "aud": "com.example.web", "exp": int(time.time()) + 600,
                      "iat": int(time.time()), "nonce": person.get("nonce", self.apple_nonce), **person["claims"]}
            tokens["id_token"] = jwt.encode(claims, self.apple_key, algorithm="RS256", headers={"kid": "k1"})
        return 200, tokens

    async def _get_json(self, url, token, headers=None):
        person = self.people.get(token.removeprefix("at-"))
        if not person:
            return 401, {}
        if "googleapis" in url:
            return 200, person["claims"]
        if url.endswith("/user"):
            return 200, person["user"]
        if url.endswith("/user/emails"):
            return 200, person["emails"]
        return 404, {}

    async def _apple_keys(self):
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.apple_key.public_key()))
        return [{**jwk, "kid": "k1", "alg": "RS256", "use": "sig"}]


@pytest.fixture
def providers(monkeypatch):
    s = get_settings()
    ec_key = ec.generate_private_key(ec.SECP256R1()).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    for field, value in {
        "public_api_url": API,
        "google_client_id": "g-client", "google_client_secret": "g-secret",
        "github_client_id": "gh-client", "github_client_secret": "gh-secret",
        "microsoft_client_id": "ms-client", "microsoft_client_secret": "ms-secret",
        "apple_client_id": "com.example.web", "apple_team_id": "TEAM123", "apple_key_id": "KEY123",
        "apple_private_key": ec_key.replace("\n", "\\n"),
    }.items():
        monkeypatch.setattr(s, field, value)
    return FakeProviders(monkeypatch)


def start(client, provider, **params):
    res = client.get(f"/api/auth/oauth/{provider}/start?{urlencode(params)}", follow_redirects=False)
    assert res.status_code == 303, res.text
    url = urlparse(res.headers["location"])
    return url, {k: v[0] for k, v in parse_qs(url.query).items()}


def finish(client, provider, state, code, **extra):
    if provider == "apple":
        res = client.post(f"/api/auth/oauth/{provider}/callback",
                          content=urlencode({"state": state, "code": code, **extra}),
                          headers={"Content-Type": "application/x-www-form-urlencoded"}, follow_redirects=False)
    else:
        res = client.get(f"/api/auth/oauth/{provider}/callback?{urlencode({'state': state, 'code': code, **extra})}",
                         follow_redirects=False)
    assert res.status_code == 303, res.text
    url = urlparse(res.headers["location"])
    return url, {k: v[0] for k, v in parse_qs(url.query).items()}


def sign_in(client, provider, code, **start_params):
    _, q = start(client, provider, **start_params)
    url, params = finish(client, provider, q["state"], code)
    assert url.path == "/auth/callback", params
    res = client.post("/api/auth/oauth/exchange", json={"code": params["code"]})
    assert res.status_code == 200, res.text
    return res.json()


# --- Configuration -------------------------------------------------------------
def test_providers_report_nothing_configured_by_default(client):
    data = client.get("/api/auth/providers").json()
    assert {p["id"] for p in data["providers"]} == {"google", "apple", "github", "microsoft"}
    assert not any(p["configured"] for p in data["providers"])
    assert data["showUnconfigured"] is True


def test_providers_report_configured(client, providers):
    assert all(p["configured"] for p in client.get("/api/auth/providers").json()["providers"])


def test_unconfigured_start_returns_to_login(client):
    res = client.get("/api/auth/oauth/google/start", follow_redirects=False)
    assert res.status_code == 303
    assert res.headers["location"].endswith("/login?oauth_error=not_configured")


def test_unknown_provider_is_404(client):
    assert client.get("/api/auth/oauth/myspace/start", follow_redirects=False).status_code == 404


# --- Google --------------------------------------------------------------------
def test_google_sign_up_with_pkce(client, providers):
    providers.people["c1"] = {"claims": {"sub": "g-1", "email": "Maya@Example.com", "email_verified": True, "name": "Maya Lin"}}
    url, q = start(client, "google", role="freelancer", next="/freelancer/profile")
    assert url.netloc == "accounts.google.com"
    assert q["redirect_uri"] == f"{API}/api/auth/oauth/google/callback"
    assert q["code_challenge_method"] == "S256"
    data = sign_in_with_state(client, "google", q["state"], "c1")
    assert data["newAccount"] is True and data["next"] == "/freelancer/profile"
    user = data["user"]
    assert user["email"] == "maya@example.com" and user["role"] == "freelancer" and user["name"] == "Maya Lin"
    assert user["emailVerified"] is True and user["hasPassword"] is False
    # The verifier sent to Google matches the challenge in the authorize URL.
    verifier = providers.token_forms[-1][1]["code_verifier"]
    assert base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode() == q["code_challenge"]
    assert client.get("/api/notifications", headers=bearer(data["token"])).status_code == 200


def sign_in_with_state(client, provider, state, code):
    url, params = finish(client, provider, state, code)
    assert url.path == "/auth/callback", params
    return client.post("/api/auth/oauth/exchange", json={"code": params["code"]}).json()


def test_returning_identity_signs_in_to_the_same_account(client, providers):
    providers.people["c1"] = {"claims": {"sub": "g-1", "email": "maya@example.com", "email_verified": True}}
    first = sign_in(client, "google", "c1", role="freelancer")
    providers.people["c2"] = {"claims": {"sub": "g-1", "email": "maya@example.com", "email_verified": True}}
    again = sign_in(client, "google", "c2", role="admin")
    assert again["newAccount"] is False
    assert again["user"]["id"] == first["user"]["id"] and again["user"]["role"] == "freelancer"


def test_verified_email_links_to_existing_password_account(client, providers):
    existing = signup(client, email="agency@example.com")
    providers.people["c1"] = {"claims": {"sub": "g-9", "email": "agency@example.com", "email_verified": True}}
    data = sign_in(client, "google", "c1", role="freelancer")
    assert data["newAccount"] is False
    assert data["user"]["id"] == existing["user"]["id"] and data["user"]["role"] == "admin"
    assert run(client, db.find_identity, "google", "g-9")["email"] == "agency@example.com"


def test_state_is_single_use_and_handoff_is_single_use(client, providers):
    providers.people["c1"] = {"claims": {"sub": "g-1", "email": "maya@example.com", "email_verified": True}}
    _, q = start(client, "google")
    url, params = finish(client, "google", q["state"], "c1")
    assert url.path == "/auth/callback"
    url2, params2 = finish(client, "google", q["state"], "c1")
    assert url2.path == "/login" and params2["oauth_error"] == "expired"
    assert client.post("/api/auth/oauth/exchange", json={"code": params["code"]}).status_code == 200
    assert client.post("/api/auth/oauth/exchange", json={"code": params["code"]}).status_code == 400


def test_state_from_another_provider_is_rejected(client, providers):
    _, q = start(client, "google")
    url, params = finish(client, "github", q["state"], "c1")
    assert params["oauth_error"] == "expired"


def test_denied_and_rejected_codes(client, providers):
    _, q = start(client, "google")
    _, params = finish(client, "google", q["state"], "", error="access_denied")
    assert params["oauth_error"] == "denied"
    _, q = start(client, "google")
    _, params = finish(client, "google", q["state"], "bad-code")
    assert params["oauth_error"] == "rejected"


def test_retired_client_account_cannot_use_social_sign_in(client, providers):
    run(client, db.create_user, "Old Client", "client@example.com", auth.hash_password("correct-horse"), "client", None)
    providers.people["c1"] = {"claims": {"sub": "g-2", "email": "client@example.com", "email_verified": True}}
    _, q = start(client, "google")
    _, params = finish(client, "google", q["state"], "c1")
    assert params["oauth_error"] == "retired"


def test_role_param_is_limited_to_signup_roles(client, providers):
    providers.people["c1"] = {"claims": {"sub": "g-3", "email": "x@example.com", "email_verified": True}}
    assert sign_in(client, "google", "c1", role="client")["user"]["role"] == "admin"


# --- GitHub --------------------------------------------------------------------
def test_github_uses_primary_verified_email(client, providers):
    providers.people["c1"] = {
        "user": {"id": 42, "login": "octocat", "name": None, "email": "public@example.com"},
        "emails": [{"email": "old@example.com", "primary": False, "verified": True},
                   {"email": "octo@example.com", "primary": True, "verified": True},
                   {"email": "unverified@example.com", "primary": False, "verified": False}],
    }
    data = sign_in(client, "github", "c1", role="admin")
    assert data["user"]["email"] == "octo@example.com" and data["user"]["name"] == "octocat"
    assert data["user"]["emailVerified"] is True


# --- Microsoft -----------------------------------------------------------------
def test_microsoft_work_email_without_domain_proof_cannot_take_over_an_account(client, providers):
    signup(client, email="agency@example.com")
    providers.people["c1"] = {"claims": {"tid": "tenant-x", "oid": "o-1", "sub": "s-1", "email": "agency@example.com"}}
    _, q = start(client, "microsoft")
    _, params = finish(client, "microsoft", q["state"], "c1")
    assert params["oauth_error"] == "email_conflict"


def test_microsoft_unverified_new_account_must_confirm_email(client, providers, monkeypatch):
    monkeypatch.setattr(get_settings(), "email_verification", True)
    providers.people["c1"] = {"claims": {"tid": "tenant-x", "oid": "o-1", "sub": "s-1", "email": "new@corp.example"}}
    data = sign_in(client, "microsoft", "c1")
    assert data["newAccount"] is True
    assert data["user"]["emailVerified"] is False and data["user"]["verificationRequired"] is True
    assert client.get("/api/notifications", headers=bearer(data["token"])).status_code == 403
    assert run(client, db.find_user, "new@corp.example")["verify"]["code_hash"]


def test_microsoft_personal_account_is_verified(client, providers):
    providers.people["c1"] = {"claims": {"tid": oauth.MS_CONSUMER_TENANT, "oid": "o-2", "sub": "s-2",
                                         "email": "me@outlook.example", "name": "Sam"}}
    data = sign_in(client, "microsoft", "c1")
    assert data["user"]["emailVerified"] is True and data["user"]["name"] == "Sam"


# --- Apple ---------------------------------------------------------------------
def test_apple_form_post_with_verified_id_token(client, providers):
    url, q = start(client, "apple", role="investor")
    assert url.netloc == "appleid.apple.com" and q["response_mode"] == "form_post" and q["nonce"]
    providers.apple_nonce = q["nonce"]
    providers.people["c1"] = {"claims": {"sub": "apple-1", "email": "private@privaterelay.appleid.com",
                                         "email_verified": "true"}}
    user_json = json.dumps({"name": {"firstName": "Ada", "lastName": "Park"}})
    url, params = finish(client, "apple", q["state"], "c1", user=user_json)
    assert url.path == "/auth/callback"
    data = client.post("/api/auth/oauth/exchange", json={"code": params["code"]}).json()
    assert data["user"]["name"] == "Ada Park" and data["user"]["role"] == "investor"
    # Apple's client secret is an ES256 JWT for this team and key.
    secret = providers.token_forms[-1][1]["client_secret"]
    assert jwt.get_unverified_header(secret)["kid"] == "KEY123"
    assert jwt.decode(secret, options={"verify_signature": False})["iss"] == "TEAM123"


def test_apple_id_token_with_wrong_nonce_is_rejected(client, providers):
    _, q = start(client, "apple")
    providers.people["c1"] = {"nonce": "someone-elses-nonce",
                              "claims": {"sub": "apple-1", "email": "a@example.com", "email_verified": True}}
    _, params = finish(client, "apple", q["state"], "c1")
    assert params["oauth_error"] == "rejected"


def test_apple_id_token_signed_by_another_key_is_rejected(client, providers, monkeypatch):
    _, q = start(client, "apple")
    providers.apple_nonce = q["nonce"]
    providers.people["c1"] = {"claims": {"sub": "apple-1", "email": "a@example.com", "email_verified": True}}
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    async def other_keys():
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(other.public_key()))
        return [{**jwk, "kid": "k1"}]

    monkeypatch.setattr(oauth, "_apple_keys", other_keys)
    _, params = finish(client, "apple", q["state"], "c1")
    assert params["oauth_error"] == "rejected"


@pytest.mark.parametrize("next_path, expected", [
    ("/checkout?plan=pro", "/checkout?plan=pro"),
    ("//evil.example", ""),
    ("/\\evil.example", ""),
    ("https://evil.example", ""),
])
def test_next_survives_the_round_trip_only_when_relative(client, providers, next_path, expected):
    providers.people["c1"] = {"claims": {"sub": "g-7", "email": "n@example.com", "email_verified": True}}
    assert sign_in(client, "google", "c1", next=next_path)["next"] == expected
