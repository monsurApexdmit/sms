"""Request and response models for app/api/v1/endpoints/years.py."""

from datetime import date

from pydantic import BaseModel, Field, model_validator


class DateRange(BaseModel):
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode="after")
    def check_order(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must not be before start_date")
        return self


class YearIn(DateRange):
    name: str = Field(min_length=9, max_length=9, description='e.g. "2025-2026"')


class YearOut(BaseModel):
    academic_year_id: int
    name: str
    start_date: date | None
    end_date: date | None
    is_current: bool
    terms: list[dict]


class TermIn(DateRange):
    academic_year_id: int
    name: str = Field(min_length=1, max_length=100)
