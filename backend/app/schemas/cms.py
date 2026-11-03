"""Request and response models for app/api/v1/endpoints/cms.py."""

from datetime import date

from pydantic import BaseModel, EmailStr, Field


class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr = Field(max_length=254)
    phone: str | None = Field(default=None, max_length=50)
    message: str = Field(min_length=1, max_length=5000)
    recaptcha_token: str | None = Field(default=None, max_length=4000)


class SlideIn(BaseModel):
    title: str = ""
    description: str = ""
    image: str


class EventIn(BaseModel):
    title: str = Field(min_length=1)
    date: date
    status: int = Field(default=1, ge=0, le=1)
