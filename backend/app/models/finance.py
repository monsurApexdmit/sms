"""Invoices, payments and expense categories (legacy)."""

from sqlalchemy.orm import Mapped

from app.db.base import Base
from app.models.columns import Int, Txt, num, pk, txt


class Invoice(Base):
    __tablename__ = "invoice"
    invoice_id: Mapped[int] = pk()
    student_id: Int = num()
    title: Txt = txt()
    description: Txt = txt()
    amount: Int = num()
    amount_paid: Txt = txt()
    due: Txt = txt()
    creation_timestamp: Int = num()
    payment_timestamp: Txt = txt()
    payment_method: Txt = txt()
    payment_details: Txt = txt()
    status: Txt = txt()  # "paid" | "unpaid"
    year: Txt = txt()


class Payment(Base):
    __tablename__ = "payment"
    payment_id: Mapped[int] = pk()
    expense_category_id: Int = num()
    title: Txt = txt()
    payment_type: Txt = txt()  # "income" | "expense"
    invoice_id: Int = num()
    student_id: Int = num()
    method: Txt = txt()
    description: Txt = txt()
    amount: Txt = txt()
    timestamp: Txt = txt()
    year: Txt = txt()


class ExpenseCategory(Base):
    __tablename__ = "expense_category"
    expense_category_id: Mapped[int] = pk()
    name: Txt = txt()
