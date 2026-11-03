"""Student health, records and certificates."""

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Txt, pk, txt


class StudentHealth(Base):
    """One health profile per student (the legacy `student.blood_group` is used until one is saved)."""

    __tablename__ = "student_health"
    health_id: Mapped[int] = pk()
    student_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    blood_group: Mapped[str | None] = mapped_column(String(10), nullable=True)
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    allergies: Txt = txt()
    conditions: Txt = txt()
    medications: Txt = txt()
    emergency_contact_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    emergency_contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    doctor: Mapped[str | None] = mapped_column(String(200), nullable=True)
    notes: Txt = txt()
    updated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class StudentRecord(Base):
    """Health, discipline, counselling and achievement notes. Counselling notes are always confidential."""

    __tablename__ = "student_record"
    record_id: Mapped[int] = pk()
    student_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    details: Txt = txt()
    action_taken: Txt = txt()
    confidential: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # "role-id" of the author
    recorded_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class CertificateTemplate(Base):
    """`kind` = transfer | bonafide | character | custom; `body` uses {placeholders} (app/services/certificates.py)."""

    __tablename__ = "certificate_template"
    template_id: Mapped[int] = pk()
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class CertificateIssue(Base):
    """An issued certificate. `rendered_body` is a snapshot, so later template edits don't change it."""

    __tablename__ = "certificate_issue"
    certificate_id: Mapped[int] = pk()
    # e.g. TC-2026-0001, numbered per kind and calendar year of issue
    serial_no: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    template_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    student_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    issued_on: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Txt = txt()
    conduct: Mapped[str | None] = mapped_column(String(200), nullable=True)
    rendered_body: Mapped[str] = mapped_column(Text, nullable=False)
    issued_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    cancelled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cancel_reason: Txt = txt()
