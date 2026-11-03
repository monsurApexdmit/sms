from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Cookie, File, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel, EmailStr, Field

from app.core.config import get_settings
from app.core.deps import DB, Me
from app.core.security import (
    create_token,
    decode_token,
    hash_password,
    needs_rehash,
    password_fingerprint,
    verify_password,
)
from app.services.accounts import email_taken, find_by_email, get_account
from app.services.files import save_image, user_image_url
from app.services.jobs import enqueue
from app.services.notify import send_email
from app.services.ratelimit import throttle

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "sms_refresh"


class LoginIn(BaseModel):
    # Plain string on purpose: legacy rows may hold addresses a strict validator rejects.
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class UserOut(BaseModel):
    role: str
    id: int
    name: str
    email: str
    image_url: str | None = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ForgotIn(BaseModel):
    email: str = Field(min_length=1, max_length=254)


class ResetIn(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=200)


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    phone: str | None = None
    address: str | None = None


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=200)


# --- brute-force guard --------------------------------------------------------

MAX_ATTEMPTS, WINDOW = 10, 300


def _throttle(key: str) -> None:
    throttle(f"auth:{key}", MAX_ATTEMPTS, WINDOW, "Too many attempts. Try again in a few minutes.")


# --- helpers ------------------------------------------------------------------


def _user_out(role: str, row) -> UserOut:
    uid = getattr(row, f"{role}_id")
    return UserOut(role=role, id=uid, name=row.name or "", email=row.email or "", image_url=user_image_url(role, uid))


def _issue(response: Response, role: str, row) -> TokenOut:
    s = get_settings()
    uid = getattr(row, f"{role}_id")
    fp = password_fingerprint(row.password)
    access = create_token(role=role, user_id=uid, fp=fp, kind="access", lifetime=timedelta(minutes=s.access_token_minutes))
    refresh = create_token(role=role, user_id=uid, fp=fp, kind="refresh", lifetime=timedelta(days=s.refresh_token_days))
    response.set_cookie(
        REFRESH_COOKIE,
        refresh,
        max_age=s.refresh_token_days * 86400,
        httponly=True,
        secure=s.cookie_secure,
        samesite="strict",
        path="/api/auth",
    )
    return TokenOut(access_token=access, user=_user_out(role, row))


# --- routes -------------------------------------------------------------------


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, request: Request, response: Response, db: DB):
    _throttle(f"{request.client.host if request.client else '?'}:{body.email.lower()}")
    found = find_by_email(db, body.email)
    if found is None or not verify_password(body.password, found[1].password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    role, row = found
    if needs_rehash(row.password):
        row.password = hash_password(body.password)
        db.commit()
    return _issue(response, role, row)


@router.post("/refresh", response_model=TokenOut)
def refresh(response: Response, db: DB, sms_refresh: str | None = Cookie(default=None)):
    payload = decode_token(sms_refresh or "", "refresh")
    if payload is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    role, _, raw_id = str(payload["sub"]).partition(":")
    row = get_account(db, role, int(raw_id)) if raw_id.isdigit() else None
    if row is None or payload.get("fp") != password_fingerprint(row.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    return _issue(response, role, row)


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")


@router.get("/me", response_model=UserOut)
def me(user: Me, db: DB):
    return _user_out(user.role, get_account(db, user.role, user.id))


@router.post("/forgot-password", status_code=202)
def forgot_password(body: ForgotIn, request: Request, tasks: BackgroundTasks, db: DB):
    """Always returns 202 so the endpoint cannot be used to discover accounts.
    Unlike the legacy app, nothing changes until the emailed link is used."""
    _throttle(f"forgot:{request.client.host if request.client else '?'}")
    found = find_by_email(db, body.email)
    if found:
        role, row = found
        s = get_settings()
        token = create_token(
            role=role,
            user_id=getattr(row, f"{role}_id"),
            fp=password_fingerprint(row.password),
            kind="reset",
            lifetime=timedelta(minutes=s.reset_token_minutes),
        )
        link = f"{s.frontend_url}/reset-password?token={token}"
        enqueue(
            tasks,
            send_email,
            row.email,
            "Password reset",
            f"Hello {row.name},\n\nUse this link to set a new password "
            f"(valid {s.reset_token_minutes} minutes):\n{link}\n\nIf you did not ask for this, ignore this email.",
        )
    return {"detail": "If the email exists, a reset link has been sent."}


@router.post("/reset-password", status_code=204)
def reset_password(body: ResetIn, db: DB):
    payload = decode_token(body.token, "reset")
    invalid = HTTPException(status.HTTP_400_BAD_REQUEST, "Reset link is invalid or has expired")
    if payload is None:
        raise invalid
    role, _, raw_id = str(payload["sub"]).partition(":")
    row = get_account(db, role, int(raw_id)) if raw_id.isdigit() else None
    # Fingerprint check makes the link single-use: once the password changes it no longer matches.
    if row is None or payload.get("fp") != password_fingerprint(row.password):
        raise invalid
    row.password = hash_password(body.new_password)
    db.commit()


@router.put("/me", response_model=UserOut)
def update_profile(body: ProfileIn, user: Me, db: DB):
    row = get_account(db, user.role, user.id)
    if email_taken(db, body.email, exclude=(user.role, user.id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email is already used by another account")
    row.name = body.name
    row.email = body.email
    for field in ("phone", "address"):
        if hasattr(row, field):
            setattr(row, field, getattr(body, field))
    db.commit()
    return _user_out(user.role, row)


@router.put("/me/password", status_code=204)
def change_password(body: PasswordChangeIn, user: Me, db: DB):
    row = get_account(db, user.role, user.id)
    if not verify_password(body.current_password, row.password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is wrong")
    row.password = hash_password(body.new_password)
    db.commit()


@router.post("/me/photo", response_model=UserOut)
async def upload_photo(user: Me, db: DB, file: UploadFile = File(...)):
    await save_image(file, f"{user.role}_image/{user.id}.jpg", max_side=600)
    return _user_out(user.role, get_account(db, user.role, user.id))
