"""Fee structure: heads, plans, instalments, discounts and generated invoices."""

from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Txt, pk, txt

# Amounts are whole currency units because the legacy invoice.amount column is an integer.


class FeeHead(Base):
    """A kind of fee, e.g. Tuition, Bus, Lab."""

    __tablename__ = "fee_head"
    fee_head_id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Txt = txt()


class FeePlan(Base):
    """Fees for one class in one year. `late_fine_type` = none | flat | per_day."""

    __tablename__ = "fee_plan"
    __table_args__ = (Index("ix_fee_plan_class_year", "class_id", "year"),)
    fee_plan_id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    class_id: Mapped[int] = mapped_column(Integer, nullable=False)
    year: Mapped[str] = mapped_column(String(9), nullable=False)
    late_fine_type: Mapped[str] = mapped_column(String(10), nullable=False, default="none")
    late_fine_amount: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    grace_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class FeePlanItem(Base):
    __tablename__ = "fee_plan_item"
    fee_plan_item_id: Mapped[int] = pk()
    fee_plan_id: Mapped[int] = mapped_column(Integer, ForeignKey("fee_plan.fee_plan_id", ondelete="CASCADE"), nullable=False, index=True)
    fee_head_id: Mapped[int] = mapped_column(Integer, ForeignKey("fee_head.fee_head_id"), nullable=False, index=True)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)


class FeeInstalment(Base):
    """Part of a plan billed on one due date; the shares of a plan's instalments add up to 100."""

    __tablename__ = "fee_instalment"
    fee_instalment_id: Mapped[int] = pk()
    fee_plan_id: Mapped[int] = mapped_column(Integer, ForeignKey("fee_plan.fee_plan_id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    share_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)


class FeeDiscount(Base):
    """Scholarship or discount for one student in one year, on one plan (or every plan when
    fee_plan_id is NULL). `kind` = percent | amount; an amount is for the whole plan and is
    spread over its instalments by their shares."""

    __tablename__ = "fee_discount"
    fee_discount_id: Mapped[int] = pk()
    student_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    fee_plan_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("fee_plan.fee_plan_id", ondelete="CASCADE"), nullable=True)
    year: Mapped[str] = mapped_column(String(9), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    value: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(200), nullable=True)


class FeeInvoice(Base):
    """Links a legacy invoice to the plan instalment it bills. invoice.amount = base_amount + fine_amount."""

    __tablename__ = "fee_invoice"
    __table_args__ = (UniqueConstraint("fee_instalment_id", "student_id", name="uq_fee_invoice_instalment_student"),)
    fee_invoice_id: Mapped[int] = pk()
    invoice_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    fee_plan_id: Mapped[int] = mapped_column(Integer, ForeignKey("fee_plan.fee_plan_id"), nullable=False, index=True)
    fee_instalment_id: Mapped[int] = mapped_column(Integer, ForeignKey("fee_instalment.fee_instalment_id"), nullable=False)
    student_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    base_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    fine_amount: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_reminded_on: Mapped[date | None] = mapped_column(Date, nullable=True)
