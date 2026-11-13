"""Startup validation: production must refuse unsafe or lossy configurations."""
import pytest

from app.config import Settings

GOOD = dict(
    environment="production",
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


def test_in_memory_demo_needs_an_explicit_opt_in():
    make(mongodb_uri=None, allow_in_memory_db=True).validate_for_production()


@pytest.mark.parametrize("origins", ["*", "http://localhost:3000", ""])
def test_cors_must_name_the_real_frontend(origins):
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        make(cors_origins=origins).validate_for_production()


def test_all_problems_are_reported_together():
    with pytest.raises(RuntimeError) as err:
        make(secret_key="dev-secret", mongodb_uri=None, cors_origins="*").validate_for_production()
    text = str(err.value)
    assert "SECRET_KEY" in text and "MONGODB_URI" in text and "CORS_ORIGINS" in text
