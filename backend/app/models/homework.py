"""Homework and submissions."""

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Int, Txt, num, pk, txt


class Homework(Base):
    """Homework for a class (section_id NULL = every section) and subject. `year` matches
    the legacy year columns; `teacher_id` is the author (NULL when an admin set it)."""

    __tablename__ = "homework"
    __table_args__ = (Index("ix_homework_class", "year", "class_id", "section_id"),)
    homework_id: Mapped[int] = pk()
    class_id: Mapped[int] = mapped_column(Integer, nullable=False)
    section_id: Int = num()
    subject_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    teacher_id: Int = num()
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Txt = txt()
    file: Mapped[str | None] = mapped_column(String(200), nullable=True)
    assigned_on: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    max_marks: Mapped[float | None] = mapped_column(Float, nullable=True)
    year: Mapped[str] = mapped_column(String(9), nullable=False)
    allow_late: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class HomeworkSubmission(Base):
    """A student's answer. Resubmitting before it is graded replaces it."""

    __tablename__ = "homework_submission"
    __table_args__ = (UniqueConstraint("homework_id", "student_id", name="uq_homework_submission_student"),)
    submission_id: Mapped[int] = pk()
    homework_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("homework.homework_id", ondelete="CASCADE"), nullable=False, index=True
    )
    student_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    text: Txt = txt()
    file: Mapped[str | None] = mapped_column(String(200), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    is_late: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    marks: Mapped[float | None] = mapped_column(Float, nullable=True)
    feedback: Txt = txt()
    # "role-id" of the grader
    graded_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
