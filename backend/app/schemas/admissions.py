"""Request and response models for app/api/v1/endpoints/admissions.py."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

EnquirySource = Literal["walk-in", "phone", "website", "other"]
EnquiryStatus = Literal["open", "converted", "closed"]


class AdmissionSettings(BaseModel):
    open: bool
    year: str


class ApplicationIn(BaseModel):
    class_id: int
    student_name: str = Field(min_length=1, max_length=200)
    date_of_birth: date | None = None
    gender: str | None = Field(default=None, max_length=20)
    previous_school: str | None = Field(default=None, max_length=200)
    guardian_name: str = Field(min_length=1, max_length=200)
    guardian_relation: str | None = Field(default=None, max_length=50)
    guardian_phone: str = Field(min_length=5, max_length=50)
    guardian_email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=1000)
    notes: str | None = Field(default=None, max_length=5000)


class OfficeApplicationIn(ApplicationIn):
    year: str | None = None


class DocumentOut(BaseModel):
    document_id: int
    label: str
    file_name: str
    url: str | None
    uploaded_at: datetime


class ApplicationOut(BaseModel):
    application_id: int
    reference: str
    year: str
    class_id: int
    class_name: str | None
    student_name: str
    date_of_birth: date | None
    gender: str | None
    previous_school: str | None
    guardian_name: str
    guardian_relation: str | None
    guardian_phone: str
    guardian_email: str | None
    address: str | None
    notes: str | None
    source: str
    status: str
    status_note: str | None
    reviewed_by: str | None
    created_at: datetime
    updated_at: datetime
    student_id: int | None
    parent_id: int | None
    document_count: int = 0
    documents: list[DocumentOut] | None = None


class StatusIn(BaseModel):
    status: Literal["new", "reviewing", "accepted", "rejected", "withdrawn"]
    note: str | None = Field(default=None, max_length=2000)
    notify: bool = True


class EnrollIn(BaseModel):
    section_id: int
    roll: int | None = Field(default=None, ge=1)
    student_email: EmailStr
    student_password: str = Field(min_length=8, max_length=200)
    # Parent account: an existing parent with this email is linked; otherwise one is
    # created when parent_password is given. Leave parent_email empty for none.
    parent_email: EmailStr | None = None
    parent_password: str | None = Field(default=None, min_length=8, max_length=200)


class LookupIn(BaseModel):
    reference: str = Field(min_length=1, max_length=20)
    phone: str = Field(min_length=5, max_length=50)


class EnquiryIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    email: EmailStr | None = None
    class_id: int | None = None
    source: EnquirySource = "walk-in"
    follow_up_on: date | None = None
    status: EnquiryStatus = "open"
    notes: str | None = Field(default=None, max_length=5000)
    assigned_to: str | None = Field(default=None, max_length=64)


class EnquiryOut(EnquiryIn):
    enquiry_id: int
    email: str | None = None
    class_name: str | None = None
    application_id: int | None
    created_at: datetime


class ConvertIn(BaseModel):
    student_name: str = Field(min_length=1, max_length=200)
    class_id: int | None = None
