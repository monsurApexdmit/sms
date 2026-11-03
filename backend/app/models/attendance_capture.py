"""Period attendance, ID cards, attendance devices and punches."""

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import pk


class PeriodAttendance(Base):
    """Attendance for one timetable period (a legacy class_routine row) on one date.
    status = present | absent | late | excused. Daily attendance stays the official record."""

    __tablename__ = "period_attendance"
    __table_args__ = (
        UniqueConstraint("date", "class_routine_id", "student_id", name="uq_period_attendance"),
        Index("ix_period_attendance_section_day", "class_id", "section_id", "date"),
    )
    period_attendance_id: Mapped[int] = pk()
    date: Mapped[date] = mapped_column(Date, nullable=False)
    class_id: Mapped[int] = mapped_column(Integer, nullable=False)
    section_id: Mapped[int] = mapped_column(Integer, nullable=False)
    class_routine_id: Mapped[int] = mapped_column(Integer, nullable=False)
    subject_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    marked_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    marked_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class IdCard(Base):
    """A card a student or staff member scans to check in. `card_uid` is the RFID UID or
    the code printed on the card (barcode). One active card per holder."""

    __tablename__ = "id_card"
    __table_args__ = (Index("ix_id_card_holder", "holder_role", "holder_id"),)
    card_id: Mapped[int] = pk()
    holder_role: Mapped[str] = mapped_column(String(20), nullable=False)
    holder_id: Mapped[int] = mapped_column(Integer, nullable=False)
    card_uid: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    issued_on: Mapped[date] = mapped_column(Date, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class AttendanceDevice(Base):
    """RFID / biometric terminal (or middleware) that pushes punches with its own key.
    Only the SHA-256 of the key is stored."""

    __tablename__ = "attendance_device"
    device_id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    api_key_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class AttendancePunch(Base):
    """Every scan, from the kiosk or a device, and what it did. `punched_at` is school-local time.
    source = qr | rfid | device | manual; result = marked_present | marked_late | checked_out |
    already_marked | duplicate | unknown_card | not_enrolled | invalid_time."""

    __tablename__ = "attendance_punch"
    __table_args__ = (
        Index("ix_attendance_punch_holder", "holder_role", "holder_id", "punched_at"),
        Index("ix_attendance_punch_time", "punched_at"),
    )
    punch_id: Mapped[int] = pk()
    device_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    card_uid: Mapped[str] = mapped_column(String(100), nullable=False)
    holder_role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    holder_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    punched_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    source: Mapped[str] = mapped_column(String(10), nullable=False)
    result: Mapped[str] = mapped_column(String(20), nullable=False)
    recorded_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
