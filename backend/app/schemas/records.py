"""Request and response models for app/api/v1/endpoints/records.py."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

RecordKind = Literal["health", "discipline", "counselling", "achievement", "other"]
CertKind = Literal["transfer", "bonafide", "character", "custom"]


class HealthIn(BaseModel):
    blood_group: str | None = Field(default=None, max_length=10)
    height_cm: float | None = Field(default=None, gt=0, lt=300)
    weight_kg: float | None = Field(default=None, gt=0, lt=500)
    allergies: str | None = Field(default=None, max_length=5000)
    conditions: str | None = Field(default=None, max_length=5000)
    medications: str | None = Field(default=None, max_length=5000)
    emergency_contact_name: str | None = Field(default=None, max_length=200)
    emergency_contact_phone: str | None = Field(default=None, max_length=50)
    doctor: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=5000)


class HealthOut(HealthIn):
    updated_by: str | None = None
    updated_at: datetime | None = None


class RecordIn(BaseModel):
    kind: RecordKind
    date: date
    title: str = Field(min_length=1, max_length=200)
    details: str | None = Field(default=None, max_length=10000)
    action_taken: str | None = Field(default=None, max_length=5000)
    confidential: bool = False


class RecordOut(BaseModel):
    record_id: int
    student_id: int
    kind: str
    date: date
    title: str
    details: str | None
    action_taken: str | None
    confidential: bool
    recorded_by: str
    created_at: datetime
    can_edit: bool = False


class TemplateIn(BaseModel):
    kind: CertKind
    name: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=20000)
    active: bool = True


class TemplateOut(TemplateIn):
    template_id: int
    unknown_placeholders: list[str] = []


class IssueIn(BaseModel):
    template_id: int
    student_id: int
    issued_on: date | None = None
    reason: str | None = Field(default=None, max_length=1000)
    conduct: str | None = Field(default=None, max_length=200)


class CancelIn(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class CertificateOut(BaseModel):
    certificate_id: int
    serial_no: str
    kind: str
    template_id: int | None
    student_id: int
    student_name: str | None = None
    issued_on: date
    reason: str | None
    conduct: str | None
    rendered_body: str
    issued_by: str
    created_at: datetime
    cancelled: bool
    cancel_reason: str | None


class VerifyOut(BaseModel):
    valid: bool
    kind: str | None = None
    issued_on: date | None = None
    student_initials: str | None = None
