"""Staff HR: staff attendance, salary structures and payroll."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Txt, pk, txt

# Staff are teachers, librarians and accountants, identified by (staff_role, staff_id)
# like the legacy "role-id" references. Money columns of these new tables are decimals.


class StaffAttendance(Base):
    """One row per staff member per day. status = present | absent | late | half_day | leave;
    no row means attendance was not taken that day."""

    __tablename__ = "staff_attendance"
    __table_args__ = (UniqueConstraint("staff_role", "staff_id", "date", name="uq_staff_attendance_day"),)
    staff_attendance_id: Mapped[int] = pk()
    staff_role: Mapped[str] = mapped_column(String(20), nullable=False)
    staff_id: Mapped[int] = mapped_column(Integer, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    check_in: Mapped[str | None] = mapped_column(String(5), nullable=True)
    check_out: Mapped[str | None] = mapped_column(String(5), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    recorded_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


class SalaryStructure(Base):
    """Pay of one staff member from `effective_from`; the latest row in effect for a month applies.
    allowances / deductions: JSON lists of {"name": str, "amount": number}."""

    __tablename__ = "salary_structure"
    __table_args__ = (Index("ix_salary_structure_staff", "staff_role", "staff_id"),)
    salary_structure_id: Mapped[int] = pk()
    staff_role: Mapped[str] = mapped_column(String(20), nullable=False)
    staff_id: Mapped[int] = mapped_column(Integer, nullable=False)
    basic: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    allowances: Txt = txt()
    deductions: Txt = txt()
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)


class PayrollRun(Base):
    """Payroll for one month. status = draft (payslips can be recalculated) | finalized | paid."""

    __tablename__ = "payroll_run"
    payroll_run_id: Mapped[int] = pk()
    month: Mapped[str] = mapped_column(String(7), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="draft")
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Payslip(Base):
    __tablename__ = "payslip"
    __table_args__ = (UniqueConstraint("payroll_run_id", "staff_role", "staff_id", name="uq_payslip_staff"),)
    payslip_id: Mapped[int] = pk()
    payroll_run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("payroll_run.payroll_run_id", ondelete="CASCADE"), nullable=False, index=True
    )
    staff_role: Mapped[str] = mapped_column(String(20), nullable=False)
    staff_id: Mapped[int] = mapped_column(Integer, nullable=False)
    staff_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    basic: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    allowances: Txt = txt()
    deductions: Txt = txt()
    absence_deduction: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    gross: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    net: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    working_days: Mapped[int] = mapped_column(Integer, nullable=False)
    present_days: Mapped[float] = mapped_column(Numeric(5, 1), nullable=False)
    absent_days: Mapped[float] = mapped_column(Numeric(5, 1), nullable=False, default=0)
    leave_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    paid_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # legacy `payment` row (payment_type "expense") recorded when the payslip was paid
    payment_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
