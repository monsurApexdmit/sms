"""Request and response models for app/api/v1/endpoints/calendar.py."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator

Kind = Literal["holiday", "exam", "event", "meeting", "other"]
Audience = Literal["all", "staff", "students", "parents"]


class EventIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    start_date: date
    end_date: date | None = None
    kind: Kind = "event"
    audience: Audience = "all"

    @model_validator(mode="after")
    def check_dates(self):
        if self.end_date is None:
            self.end_date = self.start_date
        if self.end_date < self.start_date:
            raise ValueError("end_date must not be before start_date")
        if (self.end_date - self.start_date).days > 366:
            raise ValueError("An event can last at most a year")
        return self


class EventOut(BaseModel):
    event_id: int
    title: str
    description: str | None
    start_date: date
    end_date: date
    kind: str
    audience: str
