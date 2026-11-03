"""Request and response models for app/api/v1/endpoints/hr.py."""

import datetime as dt
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

StaffRole = Literal["teacher", "librarian", "accountant"]
Status = Literal["present", "absent", "late", "half_day", "leave"]
TIME = r"^([01]\d|2[0-3]):[0-5]\d$"
MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"


class SheetItem(BaseModel):
    staff_role: StaffRole
    staff_id: int
    status: Status | None = None  # None removes the day's record
    check_in: str | None = Field(default=None, pattern=TIME)
    check_out: str | None = Field(default=None, pattern=TIME)
    note: str | None = Field(default=None, max_length=500)


class SheetSave(BaseModel):
    date: dt.date
    items: list[SheetItem]


class PayrollSettings(BaseModel):
    deduct_absence: bool


class PayItem(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    amount: float = Field(ge=0, le=10_000_000)


class StructureIn(BaseModel):
    staff_role: StaffRole
    staff_id: int
    basic: float = Field(ge=0, le=10_000_000)
    allowances: list[PayItem] = Field(default_factory=list, max_length=30)
    deductions: list[PayItem] = Field(default_factory=list, max_length=30)
    effective_from: date


class RunIn(BaseModel):
    month: str = Field(pattern=MONTH)


class PayIn(BaseModel):
    method: str = Field(default="bank", max_length=50)
    date: dt.date | None = None
