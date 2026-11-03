"""Request and response models for app/api/v1/endpoints/report_cards.py."""

import re
from datetime import date

from pydantic import BaseModel, Field, field_validator, model_validator

TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class ScheduleIn(BaseModel):
    exam_id: int
    class_id: int
    subject_id: int
    exam_date: date
    start_time: str
    end_time: str
    room: str | None = Field(default=None, max_length=50)

    @field_validator("start_time", "end_time")
    @classmethod
    def check_time(cls, v: str) -> str:
        if not TIME.match(v):
            raise ValueError("Use 24-hour HH:MM")
        return v

    @model_validator(mode="after")
    def check_order(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class ScheduleOut(BaseModel):
    exam_schedule_id: int
    exam_id: int
    class_id: int
    subject_id: int
    subject: str | None
    exam_date: date
    start_time: str
    end_time: str
    room: str | None
    clashes: list[int] = []


class WeightItem(BaseModel):
    exam_id: int
    weight: float | None = Field(default=None, ge=0, le=100)


class WeightsIn(BaseModel):
    year: str
    weights: list[WeightItem]


class RemarkIn(BaseModel):
    exam_id: int | None = None
    year: str | None = None
    remark: str = Field(max_length=2000)
