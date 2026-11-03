"""Audit log (added by this system)."""

from datetime import datetime

from sqlalchemy import DateTime, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Txt, pk, txt


class AuditLog(Base):
    """One row per insert/update/delete of an audited table (see app/services/audit.py)."""

    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_record", "table_name", "row_id"),
        Index("ix_audit_log_created_at", "created_at"),
    )
    audit_id: Mapped[int] = pk()
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    # "role-id" of the signed-in user; NULL for changes without one (webhooks, password reset, scripts)
    actor: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str] = mapped_column(String(10), nullable=False)
    table_name: Mapped[str] = mapped_column(String(64), nullable=False)
    row_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # JSON: {column: value} for insert/delete, {column: [old, new]} for update
    changes: Txt = txt()
