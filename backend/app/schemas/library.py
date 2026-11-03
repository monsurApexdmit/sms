"""Request and response models for app/api/v1/endpoints/library.py."""

from pydantic import BaseModel, Field, field_validator

from app.models import BookRequest
from app.schemas.common import out_schema


class BookIn(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    author: str | None = None
    class_id: str | None = None  # text column in the legacy schema
    price: str | None = None
    total_copies: int = Field(default=1, ge=0)
    issued_copies: int | None = Field(default=0, ge=0)
    status: str | None = "available"

    @field_validator("class_id", "price", mode="before")
    @classmethod
    def as_text(cls, v):
        return None if v is None else str(v)


class TransportIn(BaseModel):
    route_name: str = Field(min_length=1)
    number_of_vehicle: str | None = None
    description: str | None = None
    route_fare: str | None = None


class DormitoryIn(BaseModel):
    name: str = Field(min_length=1)
    number_of_room: str | None = None
    description: str | None = None


RequestBase = out_schema(BookRequest)


class BookRequestOut(RequestBase):  # type: ignore[misc,valid-type]
    book_name: str | None = None
    student_name: str | None = None


class BookRequestIn(BaseModel):
    book_id: int
    issue_start_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    issue_end_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


class BookRequestStatus(BaseModel):
    status: int = Field(ge=1, le=2)  # 1 = issue, 2 = reject
