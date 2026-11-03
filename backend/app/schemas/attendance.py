"""Request and response models for app/api/v1/endpoints/attendance.py."""

from datetime import date

from pydantic import BaseModel, Field


class SheetRow(BaseModel):
    attendance_id: int
    student_id: int
    name: str | None
    roll: int | None
    status: int | None
    on_leave: bool = False


class SheetItem(BaseModel):
    attendance_id: int
    status: int = Field(ge=0, le=2)


class SheetSave(BaseModel):
    class_id: int
    section_id: int
    date: date
    items: list[SheetItem]
