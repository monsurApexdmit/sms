"""Request and response models for app/api/v1/endpoints/students.py."""

from pydantic import BaseModel, EmailStr, Field

from app.models import Student
from app.schemas.common import out_schema

StudentBase = out_schema(Student, exclude=("password", "authentication_key"))


class StudentIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str | None = Field(default=None, min_length=8, max_length=200)
    student_code: str | None = None
    birthday: str | None = None
    sex: str | None = None
    religion: str | None = None
    blood_group: str | None = None
    address: str | None = None
    phone: str | None = None
    parent_id: int | None = None
    dormitory_id: int | None = None
    transport_id: int | None = None
    dormitory_room_number: str | None = None
    # enrolment for the running year
    class_id: int
    section_id: int | None = None
    roll: int | None = None


class StudentOut(StudentBase):  # type: ignore[misc,valid-type]
    enroll_id: int | None = None
    class_id: int | None = None
    section_id: int | None = None
    roll: int | None = None
    year: str | None = None
    class_name: str | None = None
    section_name: str | None = None
    parent_name: str | None = None
    image_url: str | None = None


class PromotionItem(BaseModel):
    student_id: int
    class_id: int
    section_id: int | None = None


class PromotionIn(BaseModel):
    to_year: str = Field(pattern=r"^\d{4}-\d{4}$")
    items: list[PromotionItem]


class BulkResult(BaseModel):
    created: int
    errors: list[str]
