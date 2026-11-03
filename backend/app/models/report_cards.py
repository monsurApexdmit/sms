"""Exam timetable, exam weights and report-card remarks."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import pk


class ExamSchedule(Base):
    """Exam timetable: one paper of one exam for one class. Times are "HH:MM" in the school's time zone."""

    __tablename__ = "exam_schedule"
    __table_args__ = (Index("ix_exam_schedule_exam_class", "exam_id", "class_id"),)
    exam_schedule_id: Mapped[int] = pk()
    exam_id: Mapped[int] = mapped_column(Integer, nullable=False)
    class_id: Mapped[int] = mapped_column(Integer, nullable=False)
    subject_id: Mapped[int] = mapped_column(Integer, nullable=False)
    exam_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[str] = mapped_column(String(5), nullable=False)
    end_time: Mapped[str] = mapped_column(String(5), nullable=False)
    room: Mapped[str | None] = mapped_column(String(50), nullable=True)


class ExamWeight(Base):
    """Share (percent) of an exam in the annual result; a year's weights should add up to 100."""

    __tablename__ = "exam_weight"
    exam_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    weight: Mapped[float] = mapped_column(Float, nullable=False)


class ReportRemark(Base):
    """Teacher's remark on a report card. `exam_id` 0 = the annual report (0, not NULL, so the
    unique key also holds for annual remarks: MySQL allows repeated NULLs in unique keys)."""

    __tablename__ = "report_remark"
    __table_args__ = (UniqueConstraint("student_id", "exam_id", "year", name="uq_report_remark"),)
    report_remark_id: Mapped[int] = pk()
    student_id: Mapped[int] = mapped_column(Integer, nullable=False)
    exam_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    year: Mapped[str] = mapped_column(String(9), nullable=False)
    remark: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
