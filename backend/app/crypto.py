"""Encryption at rest for third-party credentials (OAuth access and refresh tokens).

TOKEN_ENCRYPTION_KEY holds one or more Fernet keys, comma-separated. The first
key encrypts; every key decrypts. To rotate, put a new key first and keep the
old one until stored tokens have been refreshed (they are re-encrypted with the
first key whenever they're written).

Generate a key:
    python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Without a valid key, nothing that stores credentials can be switched on.
"""
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from .config import get_settings


class DecryptError(Exception):
    """A stored value couldn't be decrypted (wrong or rotated-out key, or tampering)."""


@lru_cache(maxsize=4)
def _fernet(raw: str) -> MultiFernet | None:
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    if not keys:
        return None
    try:
        return MultiFernet([Fernet(k.encode()) for k in keys])
    except (ValueError, TypeError):
        return None


def key_problem(raw: str | None) -> str | None:
    """Why a TOKEN_ENCRYPTION_KEY value is unusable, or None when it's fine."""
    if not (raw or "").strip():
        return "TOKEN_ENCRYPTION_KEY is not set."
    if _fernet(raw) is None:
        return "TOKEN_ENCRYPTION_KEY must be one or more Fernet keys (32 url-safe base64 bytes), comma-separated."
    return None


def configured() -> bool:
    return key_problem(get_settings().token_encryption_key) is None


def _cipher() -> MultiFernet:
    cipher = _fernet(get_settings().token_encryption_key or "")
    if cipher is None:
        raise RuntimeError(key_problem(get_settings().token_encryption_key) or "Encryption is not configured.")
    return cipher


def encrypt(value: str) -> str:
    return _cipher().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    try:
        return _cipher().decrypt(value.encode()).decode()
    except (InvalidToken, ValueError, TypeError) as exc:
        raise DecryptError("A stored credential couldn't be decrypted.") from exc
