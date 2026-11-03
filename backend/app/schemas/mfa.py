"""Request and response models for app/api/v1/endpoints/mfa.py."""

from pydantic import BaseModel, Field, model_validator

from app.schemas.auth import TokenOut


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


class EnrolledUserOut(BaseModel):
    role: str
    user_id: int
    name: str | None
    email: str | None
    confirmed_at: str | None
