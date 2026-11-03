"""Admission applications, their documents and enquiries."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Txt, pk, txt


class AdmissionApplication(Base):
    """Online or office admission application. `status` = new | reviewing | accepted |
    rejected | enrolled | withdrawn; enrolling sets student_id and parent_id."""

    __tablename__ = "admission_application"
    __table_args__ = (Index("ix_admission_application_status", "status", "year"),)
    application_id: Mapped[int] = pk()
    reference: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    year: Mapped[str] = mapped_column(String(9), nullable=False)
    class_id: Mapped[int] = mapped_column(Integer, nullable=False)
    student_name: Mapped[str] = mapped_column(String(200), nullable=False)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    previous_school: Mapped[str | None] = mapped_column(String(200), nullable=True)
    guardian_name: Mapped[str] = mapped_column(String(200), nullable=False)
    guardian_relation: Mapped[str | None] = mapped_column(String(50), nullable=True)
    guardian_phone: Mapped[str] = mapped_column(String(50), nullable=False)
    guardian_email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    address: Txt = txt()
    notes: Txt = txt()
    # online (public form) | office (entered by staff) | enquiry (converted lead)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="online")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="new")
    status_note: Txt = txt()
    reviewed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    student_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parent_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class AdmissionDocument(Base):
    __tablename__ = "admission_document"
    document_id: Mapped[int] = pk()
    application_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("admission_application.application_id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    file_name: Mapped[str] = mapped_column(String(200), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class Enquiry(Base):
    """Admission lead. `source` = walk-in | phone | website | other; `status` = open | converted | closed."""

    __tablename__ = "enquiry"
    __table_args__ = (Index("ix_enquiry_follow_up", "status", "follow_up_on"),)
    enquiry_id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    class_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="walk-in")
    follow_up_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    notes: Txt = txt()
    assigned_to: Mapped[str | None] = mapped_column(String(64), nullable=True)
    application_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
