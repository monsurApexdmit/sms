"""Two-factor authentication with authenticator apps (TOTP, RFC 6238).

The shared secret is encrypted at rest (Fernet, key derived from SECRET_KEY), codes are
accepted for the current 30-second step and one either side, and a step that has been
used once is never accepted again. Recovery codes are random, shown once, stored as
salted SHA-256 hashes and removed when used.
"""

import base64
import hashlib
import hmac
import io
import json
import secrets
import time
from datetime import UTC, datetime

import pyotp
import segno
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import UserTotp
from app.services.accounts import ROLES
from app.services.settings import get_setting

STEP = 30
WINDOW = 1  # steps accepted either side of the current one
RECOVERY_CODES = 10
ISSUER_FALLBACK = "School Management"


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _now_ts() -> float:
    return time.time()


def _fernet() -> Fernet:
    key = hashlib.sha256(f"user-totp:{get_settings().secret_key}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_secret(token: str) -> str | None:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None  # SECRET_KEY changed: the user must be reset by an admin


def required_roles(db: Session) -> set[str]:
    raw = get_setting(db, "mfa_required_roles")
    return {r.strip() for r in raw.split(",") if r.strip() in ROLES}


def get_totp(db: Session, role: str, user_id: int) -> UserTotp | None:
    return db.scalars(select(UserTotp).where(UserTotp.role == role, UserTotp.user_id == user_id)).first()


def is_enabled(db: Session, role: str, user_id: int) -> bool:
    row = get_totp(db, role, user_id)
    return row is not None and row.confirmed_at is not None


def start_setup(db: Session, role: str, user_id: int, account_label: str) -> tuple[str, str, str]:
    """Create (or replace) the pending secret. Returns (secret, otpauth URI, QR as an SVG data URI).
    The caller commits. Refuses nothing: callers check that 2FA is not already confirmed."""
    secret = pyotp.random_base32()
    row = get_totp(db, role, user_id)
    if row is None:
        row = UserTotp(role=role, user_id=user_id, created_at=_now(), last_used_step=0)
        db.add(row)
    row.secret_encrypted = encrypt_secret(secret)
    row.confirmed_at, row.recovery_codes, row.last_used_step = None, None, 0
    issuer = get_setting(db, "system_name") or ISSUER_FALLBACK
    uri = pyotp.TOTP(secret).provisioning_uri(name=account_label, issuer_name=issuer)
    return secret, uri, qr_data_uri(uri)


def qr_data_uri(text: str) -> str:
    buf = io.BytesIO()
    segno.make(text, error="m").save(buf, kind="svg", scale=5, border=2, xmldecl=False, dark="#000", light="#fff")
    return "data:image/svg+xml;base64," + base64.b64encode(buf.getvalue()).decode()


def check_code(row: UserTotp, code: str) -> bool:
    """True for a valid, not yet used code; marks its step used. The caller commits."""
    code = "".join(code.split())
    if not (code.isdigit() and len(code) == 6):
        return False
    secret = decrypt_secret(row.secret_encrypted)
    if secret is None:
        return False
    totp = pyotp.TOTP(secret)
    current = int(_now_ts()) // STEP
    for step in range(current - WINDOW, current + WINDOW + 1):
        if step > (row.last_used_step or 0) and hmac.compare_digest(totp.at(step * STEP), code):
            row.last_used_step = step
            return True
    return False


def _hash_code(code: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{code}".encode()).hexdigest()


def _normalize(code: str) -> str:
    return "".join(ch for ch in code.lower() if ch.isalnum())


def new_recovery_codes(row: UserTotp) -> list[str]:
    """Replace the recovery codes; returns the plain codes (shown once). The caller commits."""
    codes = []
    hashed = []
    for _ in range(RECOVERY_CODES):
        raw = base64.b32encode(secrets.token_bytes(5)).decode().lower()  # 8 chars, 40 bits
        code = f"{raw[:4]}-{raw[4:]}"
        salt = secrets.token_hex(8)
        codes.append(code)
        hashed.append(f"{salt}${_hash_code(_normalize(code), salt)}")
    row.recovery_codes = json.dumps(hashed)
    return codes


def recovery_codes_left(row: UserTotp) -> int:
    return len(json.loads(row.recovery_codes or "[]"))


def use_recovery_code(row: UserTotp, code: str) -> bool:
    """True if `code` is an unused recovery code; it is removed. The caller commits."""
    wanted = _normalize(code)
    if not wanted:
        return False
    hashed = json.loads(row.recovery_codes or "[]")
    for i, entry in enumerate(hashed):
        salt, _, digest = entry.partition("$")
        if hmac.compare_digest(_hash_code(wanted, salt), digest):
            del hashed[i]
            row.recovery_codes = json.dumps(hashed)
            return True
    return False


def confirm(row: UserTotp, code: str) -> list[str] | None:
    """Turn a pending secret on. Returns the recovery codes, or None if the code is wrong."""
    if not check_code(row, code):
        return None
    row.confirmed_at = _now()
    return new_recovery_codes(row)
