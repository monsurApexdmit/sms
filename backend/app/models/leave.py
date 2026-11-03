"""Leave requests for students and staff."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Txt, pk, txt


class LeaveRequest(Base):
    """Leave for a student (student_id set; applied by the student, a parent or an admin) or
    for a member of staff (student_id NULL; staff_role/staff_id is the person on leave).
    status = pending | approved | rejected | cancelled."""

    __tablename__ = "leave_request"
    __table_args__ = (
        Index("ix_leave_request_student", "student_id", "from_date"),
        Index("ix_leave_request_staff", "staff_role", "staff_id"),
    )
    leave_id: Mapped[int] = pk()
    applicant_role: Mapped[str] = mapped_column(String(20), nullable=False)
    applicant_id: Mapped[int] = mapped_column(Integer, nullable=False)
    student_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    staff_role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    staff_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="other")
    from_date: Mapped[date] = mapped_column(Date, nullable=False)
    to_date: Mapped[date] = mapped_column(Date, nullable=False)
    # school days in the range (holidays and weekly days off excluded), fixed when applied
    days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reason: Txt = txt()
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending")
    decided_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decision_note: Txt = txt()
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    year: Mapped[str | None] = mapped_column(String(9), nullable=True)
