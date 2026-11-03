"""Two-factor authentication: setup, sign-in second step, recovery codes, admin reset.

Sign-in with 2FA: POST /auth/login answers {mfa_required: true, mfa_token} and the
client finishes with POST /auth/mfa/verify. Roles listed in the `mfa_required_roles`
setting that have not set it up get {enroll_required: true, mfa_token} instead: that
token is accepted only by /auth/mfa/setup and /auth/mfa/confirm (every other endpoint
requires an access token), and confirming signs the user in.
"""

from dataclasses import dataclass
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select

from app.api.v1.endpoints.auth import TokenOut, _issue
from app.api.deps import DB, Me, bearer, require_roles
from app.core.security import decode_token, password_fingerprint, verify_password
from app.models import UserTotp
from app.services import mfa
from app.services.accounts import get_account
from app.services.ratelimit import throttle

router = APIRouter(prefix="/auth/mfa", tags=["auth"])

MAX_ATTEMPTS, WINDOW = 5, 300


def _throttle(action: str, role: str, user_id: int) -> None:
    """At most MAX_ATTEMPTS code checks per account and action in WINDOW seconds (5 guesses of a
    6-digit code: brute force is hopeless), counted whether or not the code was right."""
    throttle(f"mfa-{action}:{role}:{user_id}", MAX_ATTEMPTS, WINDOW, "Too many attempts. Try again in a few minutes.")


class StatusOut(BaseModel):
    enabled: bool
    pending: bool
    confirmed_at: str | None
    recovery_codes_left: int
    required: bool


class SetupOut(BaseModel):
    secret: str
    otpauth_uri: str
    qr: str  # SVG data URI


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=10)


class ConfirmOut(BaseModel):
    recovery_codes: list[str]
    # set when setup was forced at sign-in: the user is now signed in
    session: TokenOut | None = None


class VerifyIn(BaseModel):
    mfa_token: str = Field(min_length=1, max_length=2000)
    code: str | None = Field(default=None, max_length=10)
    recovery_code: str | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def one_of(self):
        if not (self.code or self.recovery_code):
            raise ValueError("Enter the code from your authenticator app or a recovery code")
        return self


class DisableIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)
    code: str = Field(min_length=6, max_length=20, description="Authenticator code or a recovery code")


@dataclass(frozen=True)
class SetupAccount:
    role: str
    id: int
    row: object
    # signed in with the enroll-only token from a forced setup
    enrolling: bool


def _setup_account(db: DB, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> SetupAccount:
    """A signed-in user (access token) or one being forced to set up 2FA (enroll-only token)."""
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    if creds is None:
        raise unauthorized
    payload = decode_token(creds.credentials, "access")
    enrolling = payload is None
    if enrolling:
        payload = decode_token(creds.credentials, "mfa_enroll")
    if payload is None:
        raise unauthorized
    role, _, raw_id = str(payload.get("sub", "")).partition(":")
    row = get_account(db, role, int(raw_id)) if raw_id.isdigit() else None
    if row is None or (enrolling and payload.get("fp") != password_fingerprint(row.password)):
        raise unauthorized
    db.info["actor"] = f"{role}-{raw_id}"
    return SetupAccount(role=role, id=int(raw_id), row=row, enrolling=enrolling)


Setup = Annotated[SetupAccount, Depends(_setup_account)]


@router.get("", response_model=StatusOut)
def get_status(user: Me, db: DB):
    row = mfa.get_totp(db, user.role, user.id)
    confirmed = row is not None and row.confirmed_at is not None
    return StatusOut(
        enabled=confirmed,
        pending=row is not None and not confirmed,
        confirmed_at=row.confirmed_at.isoformat() if confirmed else None,
        recovery_codes_left=mfa.recovery_codes_left(row) if confirmed else 0,
        required=user.role in mfa.required_roles(db),
    )


@router.post("/setup", response_model=SetupOut)
def setup(account: Setup, db: DB):
    if mfa.is_enabled(db, account.role, account.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-factor authentication is already on. Turn it off first to move it to a new device.")
    label = account.row.email or f"{account.role}-{account.id}"
    secret, uri, qr = mfa.start_setup(db, account.role, account.id, label)
    db.commit()
    return SetupOut(secret=secret, otpauth_uri=uri, qr=qr)


@router.post("/confirm", response_model=ConfirmOut)
def confirm(body: CodeIn, account: Setup, response: Response, db: DB):
    row = mfa.get_totp(db, account.role, account.id)
    if row is None or row.confirmed_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Start the setup first")
    _throttle("confirm", account.role, account.id)
    codes = mfa.confirm(row, body.code)
    if codes is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code is not right. Check the time on your phone and try again.")
    db.commit()
    session = _issue(response, account.role, account.row) if account.enrolling else None
    return ConfirmOut(recovery_codes=codes, session=session)


@router.post("/verify", response_model=TokenOut)
def verify(body: VerifyIn, response: Response, db: DB):
    """Second sign-in step. Public: authorised by the short-lived mfa_token from /auth/login."""
    expired = HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign-in expired. Enter your password again.")
    payload = decode_token(body.mfa_token, "mfa")
    if payload is None:
        raise expired
    role, _, raw_id = str(payload.get("sub", "")).partition(":")
    row = get_account(db, role, int(raw_id)) if raw_id.isdigit() else None
    if row is None or payload.get("fp") != password_fingerprint(row.password):
        raise expired
    totp = mfa.get_totp(db, role, int(raw_id))
    if totp is None or totp.confirmed_at is None:
        raise expired
    _throttle("verify", role, int(raw_id))
    db.info["actor"] = f"{role}-{raw_id}"
    ok = mfa.check_code(totp, body.code) if body.code else mfa.use_recovery_code(totp, body.recovery_code or "")
    if not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That code is not right")
    db.commit()
    return _issue(response, role, row)


@router.post("/recovery-codes", response_model=ConfirmOut)
def regenerate_recovery_codes(body: CodeIn, user: Me, db: DB):
    row = mfa.get_totp(db, user.role, user.id)
    if row is None or row.confirmed_at is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-factor authentication is not on")
    _throttle("recovery-codes", user.role, user.id)
    if not mfa.check_code(row, body.code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code is not right")
    codes = mfa.new_recovery_codes(row)
    db.commit()
    return ConfirmOut(recovery_codes=codes)


@router.post("/disable", status_code=204)
def disable(body: DisableIn, user: Me, db: DB):
    row = mfa.get_totp(db, user.role, user.id)
    if row is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-factor authentication is not on")
    if row.confirmed_at is not None and user.role in mfa.required_roles(db):
        raise HTTPException(status.HTTP_409_CONFLICT, "Your school requires two-factor authentication for your role")
    _throttle("disable", user.role, user.id)
    account = get_account(db, user.role, user.id)
    if not verify_password(body.password, account.password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password is wrong")
    if row.confirmed_at is not None and not (mfa.check_code(row, body.code) or mfa.use_recovery_code(row, body.code)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code is not right")
    db.delete(row)
    db.commit()


class EnrolledUserOut(BaseModel):
    role: str
    user_id: int
    name: str | None
    email: str | None
    confirmed_at: str | None


@router.get("/users", response_model=list[EnrolledUserOut], dependencies=[Depends(require_roles("admin"))])
def enrolled_users(db: DB):
    """Accounts with two-factor authentication set up (or started), for the admin's reset screen."""
    out = []
    for row in db.scalars(select(UserTotp).order_by(UserTotp.role, UserTotp.user_id)):
        account = get_account(db, row.role, row.user_id)
        out.append(
            EnrolledUserOut(
                role=row.role, user_id=row.user_id, name=account.name if account else None,
                email=account.email if account else None,
                confirmed_at=row.confirmed_at.isoformat() if row.confirmed_at else None,
            )  # fmt: skip
        )
    return out


@router.delete("/users/{role}/{user_id}", status_code=204, dependencies=[Depends(require_roles("admin"))])
def admin_reset(role: Literal["admin", "teacher", "student", "parent", "librarian", "accountant"], user_id: int, db: DB):
    """For a lost phone: removes the user's 2FA so they can sign in with the password and set it up again."""
    row = mfa.get_totp(db, role, user_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That user has no two-factor authentication")
    db.delete(row)
    db.commit()
