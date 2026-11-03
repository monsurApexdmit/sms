"""Request and response models for app/api/v1/endpoints/fees.py."""

import datetime as dt
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.services.years import valid_year_name


class FeeHeadIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)


class PlanItemIn(BaseModel):
    fee_head_id: int
    amount: int = Field(gt=0)


class InstalmentIn(BaseModel):
    fee_instalment_id: int | None = None  # set to keep an existing instalment
    name: str = Field(min_length=1, max_length=100)
    due_date: dt.date
    share_percent: Decimal = Field(gt=0, le=100, max_digits=5, decimal_places=2)


class PlanIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    class_id: int
    year: str
    late_fine_type: Literal["none", "flat", "per_day"] = "none"
    late_fine_amount: int = Field(default=0, ge=0)
    grace_days: int = Field(default=0, ge=0, le=365)
    items: list[PlanItemIn] = Field(min_length=1)
    instalments: list[InstalmentIn] = Field(min_length=1)

    @field_validator("year")
    @classmethod
    def check_year(cls, v: str) -> str:
        if not valid_year_name(v):
            raise ValueError("year must look like 2025-2026")
        return v

    @model_validator(mode="after")
    def check_plan(self):
        if sum(i.share_percent for i in self.instalments) != 100:
            raise ValueError("Instalment shares must add up to 100%")
        if len({i.fee_head_id for i in self.items}) != len(self.items):
            raise ValueError("Each fee head can appear only once in a plan")
        if self.late_fine_type != "none" and self.late_fine_amount <= 0:
            raise ValueError("Set a late fine amount, or choose no late fine")
        return self


class InstalmentOut(BaseModel):
    fee_instalment_id: int
    name: str
    due_date: dt.date
    share_percent: float
    amount: int
    invoices: int


class PlanOut(BaseModel):
    fee_plan_id: int
    name: str
    class_id: int
    class_name: str | None
    year: str
    late_fine_type: str
    late_fine_amount: int
    grace_days: int
    total: int
    items: list[dict]
    instalments: list[InstalmentOut]


class GenerateIn(BaseModel):
    fee_instalment_id: int


class DiscountIn(BaseModel):
    student_id: int
    fee_plan_id: int | None = None
    year: str
    kind: Literal["percent", "amount"]
    value: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    reason: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def check(self):
        if not valid_year_name(self.year):
            raise ValueError("year must look like 2025-2026")
        if self.kind == "percent" and self.value > 100:
            raise ValueError("A percent discount can be at most 100")
        return self


class DiscountOut(BaseModel):
    fee_discount_id: int
    student_id: int
    student_name: str | None
    fee_plan_id: int | None
    plan_name: str | None
    year: str
    kind: str
    value: float
    reason: str | None
