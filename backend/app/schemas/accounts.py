"""Request and response models for app/api/v1/endpoints/accounts.py."""

from pydantic import BaseModel, EmailStr, Field


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str | None = Field(default=None, min_length=8, max_length=200)


class AdminIn(AccountIn):
    phone: str | None = None
    address: str | None = None


class TeacherIn(AccountIn):
    phone: str | None = None
    address: str | None = None
    birthday: str | None = None
    sex: str | None = None
    religion: str | None = None
    blood_group: str | None = None
    designation: str | None = None
    about: str | None = None
    social_links: str | None = None
    show_on_website: int | None = 0


class ParentIn(AccountIn):
    phone: str | None = None
    address: str | None = None
    profession: str | None = None
