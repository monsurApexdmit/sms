"""Request and response models for app/api/v1/endpoints/leave.py."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

MAX_SPAN_DAYS = 60


Kind = Literal["sick", "casual", "family", "other"]


class LeaveIn(BaseModel):
    # students apply for themselves and staff for themselves; parents name a child;
    # admins name a student or a member of staff
    student_id: int | None = None
    staff_role: Literal["teacher", "accountant", "librarian"] | None = None
    staff_id: int | None = None
    kind: Kind = "other"
    from_date: date
    to_date: date
    reason: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def check_dates(self):
        if self.to_date < self.from_date:
            raise ValueError("to_date must not be before from_date")
        if (self.to_date - self.from_date).days >= MAX_SPAN_DAYS:
            raise ValueError(f"Leave can cover at most {MAX_SPAN_DAYS} days; split longer leave into several requests")
        return self


class DecisionIn(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=2000)


class LeaveOut(BaseModel):
    leave_id: int
    kind: str
    from_date: date
    to_date: date
    days: int
    reason: str | None
    status: str
    person_role: str
    person_name: str
    student_id: int | None
    class_name: str | None
    applicant_role: str
    applicant_name: str
    decided_by_name: str | None
    decided_at: datetime | None
    decision_note: str | None
    created_at: datetime
    can_cancel: bool
    can_decide: bool
