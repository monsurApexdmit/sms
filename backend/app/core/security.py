import hashlib
import hmac
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings

_argon = PasswordHasher()
ALGORITHM = "HS256"


# --- passwords ----------------------------------------------------------------


def hash_password(plain: str) -> str:
    if get_settings().password_hash_scheme == "sha1":
        return hashlib.sha1(plain.encode()).hexdigest()
    return _argon.hash(plain)


def verify_password(plain: str, stored: str | None) -> bool:
    if not stored:
        return False
    if stored.startswith("$argon2"):
        try:
            return _argon.verify(stored, plain)
        except (VerificationError, InvalidHashError):
            return False
    # Legacy CodeIgniter hashes: unsalted sha1 hex.
    return hmac.compare_digest(hashlib.sha1(plain.encode()).hexdigest(), stored)


def needs_rehash(stored: str) -> bool:
    if get_settings().password_hash_scheme == "sha1":
        return False
    return not stored.startswith("$argon2") or _argon.check_needs_rehash(stored)


def password_fingerprint(stored: str | None) -> str:
    """Short digest of the stored hash. Embedded in tokens so that changing the
    password invalidates every refresh/reset token issued before the change."""
    return hashlib.sha256((stored or "").encode()).hexdigest()[:16]


# --- tokens -------------------------------------------------------------------


def create_token(*, role: str, user_id: int, fp: str, kind: str, lifetime: timedelta) -> str:
    now = datetime.now(UTC)
    payload = {"sub": f"{role}:{user_id}", "fp": fp, "typ": kind, "iat": now, "exp": now + lifetime}
    return jwt.encode(payload, get_settings().secret_key, algorithm=ALGORITHM)


def decode_token(token: str, kind: str) -> dict[str, Any] | None:
    try:
        payload = jwt.decode(token, get_settings().secret_key, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("typ") != kind:
        return None
    return payload


# --- signed media URLs --------------------------------------------------------


def _media_sig(path: str, exp: int) -> str:
    key = get_settings().secret_key.encode()
    return hmac.new(key, f"{path}|{exp}".encode(), hashlib.sha256).hexdigest()[:32]


def sign_media_path(path: str, seconds: int | None = None) -> str:
    """Return a relative URL that grants time-limited read access to an upload."""
    exp = int(time.time()) + (seconds or get_settings().media_url_seconds)
    return f"/api/media/{path}?exp={exp}&sig={_media_sig(path, exp)}"


def verify_media_signature(path: str, exp: int, sig: str) -> bool:
    if exp < time.time():
        return False
    return hmac.compare_digest(_media_sig(path, exp), sig)
