"""Request and response models for app/api/v1/endpoints/auth.py."""

from pydantic import BaseModel, EmailStr, Field


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


class MfaChallengeOut(BaseModel):
    """Password accepted, second step needed (see app/api/v1/endpoints/mfa.py)."""

    # True: send a code to /auth/mfa/verify. False with enroll_required: set up 2FA first.
    mfa_required: bool
    enroll_required: bool = False
    mfa_token: str


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
