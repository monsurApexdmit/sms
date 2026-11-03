"""Request and response models for app/api/v1/endpoints/finance.py."""

import datetime as dt

from pydantic import BaseModel, Field

from app.models import Invoice, Payment
from app.schemas.common import Page, out_schema


class ExpenseCategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


InvoiceBase = out_schema(Invoice)
PaymentBase = out_schema(Payment)


class InvoiceOut(InvoiceBase):  # type: ignore[misc,valid-type]
    student_name: str | None = None


class InvoiceDetail(InvoiceOut):
    payments: list[PaymentBase] = []  # type: ignore[valid-type]


class InvoiceIn(BaseModel):
    student_id: int
    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    amount: int = Field(gt=0)
    amount_paid: float = Field(default=0, ge=0)
    method: str | None = Field(default="cash", max_length=50)
    date: dt.date | None = None


class MassInvoiceIn(InvoiceIn):
    student_id: int | None = None  # type: ignore[assignment]
    student_ids: list[int] = Field(min_length=1)


class InvoiceUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    amount: int = Field(gt=0)


class PaymentIn(BaseModel):
    amount: float = Field(gt=0)
    method: str = Field(default="cash", max_length=50)
    date: dt.date | None = None
    description: str | None = None


class InvoiceSummary(BaseModel):
    billed: float
    collected: float
    outstanding: float
    open: int
    partial: int


class InvoicePage(Page):
    summary: InvoiceSummary


class PaymentOut(PaymentBase):  # type: ignore[misc,valid-type]
    student_name: str | None = None
    category_name: str | None = None


class ExpenseIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    expense_category_id: int | None = None
    amount: float = Field(gt=0)
    method: str = Field(default="cash", max_length=50)
    date: dt.date | None = None
    description: str | None = None


class PaymentPage(Page):
    amount_total: float


class PayPalCaptureIn(BaseModel):
    order_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9-]+$")
