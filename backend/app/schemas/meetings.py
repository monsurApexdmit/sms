"""Request and response models for app/api/v1/endpoints/meetings.py."""

from datetime import date, datetime, time, timedelta
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class SessionIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    date: date
    start_time: time
    end_time: time
    slot_minutes: int = Field(ge=5, le=120)
    location: str | None = Field(default=None, max_length=300)
    class_id: int | None = None
    # empty: every teacher of class_id
    teacher_ids: list[int] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def check(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        if not self.teacher_ids and self.class_id is None:
            raise ValueError("Choose the teachers, or a class to invite all its teachers")
        if not _slot_times(self.start_time, self.end_time, self.slot_minutes):
            raise ValueError("The time window is shorter than one slot")
        return self


class SessionOut(BaseModel):
    session_id: int
    title: str
    date: date
    start_time: time
    end_time: time
    slot_minutes: int
    location: str | None
    class_id: int | None
    class_name: str | None
    teacher_ids: list[int]
    slots: int
    booked: int


class BookingIn(BaseModel):
    slot_id: int
    student_id: int
    note: str | None = Field(default=None, max_length=1000)


class OutcomeIn(BaseModel):
    status: Literal["booked", "done", "no_show"]
    teacher_note: str | None = Field(default=None, max_length=2000)


class BlockIn(BaseModel):
    blocked: bool


def _slot_times(start: time, end: time, minutes: int) -> list[tuple[time, time]]:
    day = date(2000, 1, 1)
    at, stop, step = datetime.combine(day, start), datetime.combine(day, end), timedelta(minutes=minutes)
    out = []
    while at + step <= stop:
        out.append((at.time(), (at + step).time()))
        at += step
    return out
