"""School years, terms and the academic calendar."""

from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Txt, pk, txt


class AcademicYear(Base):
    """School years. `name` matches the legacy `year` columns ("2025-2026"); the current
    one mirrors the legacy `running_year` setting (app/services/years.py keeps them in step)."""

    __tablename__ = "academic_year"
    academic_year_id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(9), unique=True, nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Term(Base):
    __tablename__ = "term"
    term_id: Mapped[int] = pk()
    academic_year_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("academic_year.academic_year_id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)


class CalendarEvent(Base):
    """Academic calendar. `kind` = holiday | exam | event | meeting | other; holidays are
    excluded from attendance working days. `audience` = all | staff | students | parents."""

    __tablename__ = "calendar_event"
    __table_args__ = (Index("ix_calendar_event_dates", "start_date", "end_date"),)
    event_id: Mapped[int] = pk()
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Txt = txt()
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="event")
    audience: Mapped[str] = mapped_column(String(20), nullable=False, default="all")
