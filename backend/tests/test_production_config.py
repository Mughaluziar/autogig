"""Startup validation: production must refuse unsafe or lossy configurations."""
import pytest

from app.config import Settings

GOOD = dict(
    environment="production",
    email_verification=True,
    secret_key="x" * 40,
    mongodb_uri="mongodb://example.invalid:27017",
    cors_origins="https://app.example.com",
)


def make(**overrides) -> Settings:
    return Settings(_env_file=None, **{**GOOD, **overrides})


def test_good_production_config_passes():
    make().validate_for_production()


def test_non_production_is_never_blocked():
    Settings(_env_file=None, environment="development", secret_key="dev-secret").validate_for_production()


@pytest.mark.parametrize("key", ["dev-secret", "change-me-in-production", "short"])
def test_weak_secret_key_is_refused(key):
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        make(secret_key=key).validate_for_production()


def test_missing_mongodb_is_refused_in_production():
    with pytest.raises(RuntimeError, match="MONGODB_URI"):
        make(mongodb_uri=None).validate_for_production()


def test_legacy_memory_override_cannot_allow_production_startup(monkeypatch):
    monkeypatch.setenv("ALLOW_IN_MEMORY_DB", "true")
    with pytest.raises(RuntimeError, match="MONGODB_URI"):
        make(mongodb_uri="  ").validate_for_production()


@pytest.mark.parametrize("origins", ["*", "http://localhost:3000", ""])
def test_cors_must_name_the_real_frontend(origins):
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        make(cors_origins=origins).validate_for_production()


def test_all_problems_are_reported_together():
    with pytest.raises(RuntimeError) as err:
        make(secret_key="dev-secret", mongodb_uri=None, cors_origins="*").validate_for_production()
    text = str(err.value)
    assert "SECRET_KEY" in text and "MONGODB_URI" in text and "CORS_ORIGINS" in text


def test_bad_encryption_key_is_refused():
    with pytest.raises(RuntimeError):
        make(token_encryption_key="not-a-fernet-key").validate_for_production()


# --- the stricter production checks added in the production-readiness pass -----------------
@pytest.mark.parametrize("origins", ["http://app.example.com", "https://app.example.com,http://localhost:3000",
                                     "https://app.example.com,http://staging.example.com"])
def test_production_cors_must_be_https_only(origins):
    with pytest.raises(RuntimeError, match="https://"):
        make(cors_origins=origins).validate_for_production()


def test_public_site_url_must_be_https():
    with pytest.raises(RuntimeError, match="PUBLIC_SITE_URL"):
        make(public_site_url="http://app.example.com").validate_for_production()
    make(public_site_url="https://app.example.com").validate_for_production()


def test_demo_data_must_be_off_in_production():
    with pytest.raises(RuntimeError, match="SEED_DEMO_DATA"):
        make(seed_demo_data=True).validate_for_production()


def test_cookies_cannot_be_forced_insecure_in_production():
    with pytest.raises(RuntimeError, match="COOKIE_SECURE"):
        make(cookie_secure="false").validate_for_production()
    make(cookie_secure="true").validate_for_production()
    make(cookie_secure="").validate_for_production()


@pytest.mark.parametrize("hops", [-1, 6])
def test_proxy_hops_must_be_sane(hops):
    with pytest.raises(RuntimeError, match="TRUSTED_PROXY_HOPS"):
        make(trusted_proxy_hops=hops).validate_for_production()


def test_rate_limit_floor():
    with pytest.raises(RuntimeError, match="RATE_LIMIT_PER_MINUTE"):
        make(rate_limit_per_minute=10).validate_for_production()


def test_warnings_name_every_missing_integration_but_do_not_block_startup():
    cfg = make(owner_emails="", email_verification=True)           # (the test env sets both)
    cfg.validate_for_production()                                   # starts fine...
    text = " | ".join(cfg.production_warnings())                   # ...but says what is off
    for needle in ("email provider", "GROQ_API_KEY", "Inbound email", "SENTRY_DSN", "Stripe", "OWNER_EMAILS", "EDGE_SHARED_SECRET"):
        assert needle in text, needle


def test_warnings_disappear_when_the_integrations_are_configured():
    cfg = make(resend_api_key="k", groq_api_key="k", inbound_email_domain="in.example.com",
               inbound_email_webhook_secret="s", sentry_dsn="https://x@y.ingest.sentry.io/1",
               stripe_secret_key="k", stripe_webhook_secret="w", owner_emails="me@example.com", email_verification=True,
               edge_shared_secret="e" * 40, require_edge_proof=True)
    assert cfg.production_warnings() == []


def test_memory_rate_limit_backend_needs_a_single_instance_declaration():
    with pytest.raises(RuntimeError, match="second API instance"):
        make(rate_limit_backend="memory").validate_for_production()
    make(rate_limit_backend="memory", single_instance=True).validate_for_production()
    make(rate_limit_backend="auto").validate_for_production()
    with pytest.raises(RuntimeError, match="RATE_LIMIT_BACKEND must be"):
        make(rate_limit_backend="redis").validate_for_production()


def test_production_cannot_disable_email_verification():
    with pytest.raises(RuntimeError, match="EMAIL_VERIFICATION"):
        make(email_verification=False).validate_for_production()


def test_mongo_failure_aborts_startup_and_degrades_health(monkeypatch, caplog):
    import asyncio

    from pymongo.errors import ServerSelectionTimeoutError

    from app import db
    from app.main import health, startup

    class UnavailableMongo:
        async def command(self, command):
            assert command == "ping"
            raise ServerSelectionTimeoutError("private connection details")

    monkeypatch.setattr(db, "enabled", lambda: True)
    monkeypatch.setattr(db, "_get_db", UnavailableMongo)
    with pytest.raises(RuntimeError, match="MongoDB connection or index initialization failed"):
        asyncio.run(startup())
    assert asyncio.run(health()).status_code == 503
    assert "private connection details" not in caplog.text


@pytest.mark.parametrize(("settings", "variable"), [
    ({"stripe_secret_key": "sk_live_example"}, "STRIPE_SECRET_KEY"),
    ({"stripe_secret_key": "rk_live_example"}, "STRIPE_SECRET_KEY"),
    ({"payments_crypto_enabled": True}, "PAYMENTS_CRYPTO_ENABLED"),
    ({"token_mainnet_enabled": True}, "TOKEN_MAINNET_ENABLED"),
])
def test_demo_release_refuses_live_finance(settings, variable):
    with pytest.raises(RuntimeError, match=variable):
        make(**settings).validate_for_production()


@pytest.mark.parametrize("key", ["cors_origins", "public_site_url"])
def test_production_rejects_secret_bearing_origins_without_echoing_them(key):
    with pytest.raises(RuntimeError) as err:
        make(**{key: "https://user:fixture-secret@example.com"}).validate_for_production()
    assert key.upper() in str(err.value) and "fixture-secret" not in str(err.value)
