"""Parent-teacher meetings."""

from datetime import date, datetime, time

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, String, Time
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Int, Txt, num, pk, txt


class MeetingSession(Base):
    """A parent-teacher meeting day. Slots are generated per teacher between start_time and
    end_time; a calendar_event (kind "meeting", audience "parents") mirrors the session."""

    __tablename__ = "meeting_session"
    session_id: Mapped[int] = pk()
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    slot_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    location: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # NULL: open to parents of every class
    class_id: Int = num()
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    calendar_event_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("calendar_event.event_id", ondelete="SET NULL"), nullable=True
    )


class MeetingSlot(Base):
    __tablename__ = "meeting_slot"
    __table_args__ = (Index("ix_meeting_slot_session_teacher", "session_id", "teacher_id"),)
    slot_id: Mapped[int] = pk()
    session_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("meeting_session.session_id", ondelete="CASCADE"), nullable=False
    )
    teacher_id: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    # open | booked | blocked
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open")


class MeetingBooking(Base):
    """`active_slot_id` and `active_key` are set only while the booking is active (status
    booked, done or no_show) and are unique, so the database itself refuses a second booking
    of a slot, or a second booking of the same child with the same teacher in one session."""

    __tablename__ = "meeting_booking"
    booking_id: Mapped[int] = pk()
    slot_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("meeting_slot.slot_id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Txt = txt()
    # booked | cancelled | done | no_show
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="booked")
    teacher_note: Txt = txt()
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    active_slot_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True)
    # "<session_id>:<teacher_id>:<student_id>"
    active_key: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
