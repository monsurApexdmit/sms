"""Request and response models for app/api/v1/endpoints/notifications.py."""

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.services.notifications import CATEGORIES


class NotificationOut(BaseModel):
    notification_id: int
    category: str
    title: str
    body: str | None
    link: str | None
    created_at: datetime
    read_at: datetime | None


class PreferenceItem(BaseModel):
    category: str
    in_app: bool = True
    email: bool = False
    sms: bool = False
    push: bool = True
    whatsapp: bool = False

    @field_validator("category")
    @classmethod
    def known(cls, v: str) -> str:
        if v not in CATEGORIES:
            raise ValueError("Unknown category")
        return v


class PreferencesIn(BaseModel):
    items: list[PreferenceItem] = Field(max_length=len(CATEGORIES))


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=200)
    auth: str = Field(min_length=1, max_length=100)


class SubscribeIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=500)
    keys: PushKeys

    @field_validator("endpoint")
    @classmethod
    def https(cls, v: str) -> str:
        if not v.startswith("https://"):
            raise ValueError("endpoint must be an https URL")
        return v


class UnsubscribeIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=500)


class ChannelSettingsIn(BaseModel):
    whatsapp_token: str | None = Field(default=None, max_length=1000)
    whatsapp_phone_number_id: str | None = Field(default=None, max_length=50)
    whatsapp_template: str | None = Field(default=None, max_length=100)
    whatsapp_template_language: str | None = Field(default=None, max_length=20)
    vapid_subject: str | None = Field(default=None, max_length=200)
