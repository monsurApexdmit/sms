"""Request and response models for app/api/v1/endpoints/attendance_capture.py."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

PeriodStatus = Literal["present", "absent", "late", "excused"]


class PeriodOut(BaseModel):
    class_routine_id: int
    class_id: int | None
    class_name: str | None
    section_id: int | None
    section_name: str | None
    subject_id: int | None
    subject_name: str | None
    start: str
    end: str
    marked: int


class PeriodRow(BaseModel):
    student_id: int
    name: str | None
    roll: int | None
    status: str | None
    on_leave: bool


class PeriodSheet(BaseModel):
    period: PeriodOut
    date: date
    rows: list[PeriodRow]


class PeriodItem(BaseModel):
    student_id: int
    status: PeriodStatus


class PeriodSave(BaseModel):
    class_routine_id: int
    date: date
    items: list[PeriodItem] = Field(max_length=500)


class FillDaily(BaseModel):
    class_id: int
    section_id: int
    date: date
    overwrite: bool = False


HolderRole = Literal["student", "teacher", "librarian", "accountant"]


class CardIn(BaseModel):
    holder_role: HolderRole
    holder_id: int
    card_uid: str | None = Field(default=None, max_length=100, description="RFID UID or printed code; generated when empty")


class BulkCards(BaseModel):
    class_id: int
    section_id: int | None = None


class ScanIn(BaseModel):
    card_uid: str = Field(min_length=1, max_length=100)
    source: Literal["qr", "rfid", "manual"] = "qr"


class ScanOut(BaseModel):
    result: str
    message: str
    card_uid: str
    holder_role: str | None
    holder_id: int | None
    name: str | None
    image_url: str | None
    punched_at: datetime | None


class CaptureSettings(BaseModel):
    late_after: str | None = Field(default=None, description='"HH:MM" school time; empty = nobody is marked late')
    duplicate_minutes: int = Field(default=10, ge=0, le=240)


class DeviceIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    location: str | None = Field(default=None, max_length=200)
    active: bool = True


class PunchIn(BaseModel):
    card_uid: str = Field(min_length=1, max_length=100)
    timestamp: datetime | None = Field(default=None, description="When the card was read; naive = school time. Default: now")


class PunchBatch(BaseModel):
    punches: list[PunchIn] = Field(min_length=1, max_length=500)
