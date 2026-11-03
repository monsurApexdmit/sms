"""Request and response models for app/api/v1/endpoints/messages.py."""

from pydantic import BaseModel, Field


class Contact(BaseModel):
    ref: str
    role: str
    name: str


class MessageOut(BaseModel):
    message_id: int
    sender: str | None
    sender_name: str
    message: str | None
    timestamp: str | None
    read_status: int | None = None
    attachment_name: str | None = None
    attachment_url: str | None = None
    mine: bool


class ThreadOut(BaseModel):
    code: str
    other: str
    other_name: str
    last_message: str | None
    last_timestamp: str | None
    unread: int


class GroupIn(BaseModel):
    group_name: str = Field(min_length=1, max_length=200)
    members: list[str] = Field(default_factory=list)  # "role_id"


class GroupOut(BaseModel):
    code: str
    group_name: str | None
    members: list[str]
    member_names: list[str]
    last_timestamp: str | None
