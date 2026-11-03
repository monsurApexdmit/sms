"""AI assistant usage log."""

from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import pk


class AiRequest(Base):
    """One call to the Claude API, for usage caps and the admin usage view. Prompts and
    answers are not stored (they can hold student data); only who, what and token counts.
    status = ok | refused | invalid | error."""

    __tablename__ = "ai_request"
    __table_args__ = (
        Index("ix_ai_request_created_at", "created_at"),
        Index("ix_ai_request_user", "user_role", "user_id", "created_at"),
    )
    ai_request_id: Mapped[int] = pk()
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    user_role: Mapped[str] = mapped_column(String(20), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    feature: Mapped[str] = mapped_column(String(30), nullable=False)
    model: Mapped[str] = mapped_column(String(60), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
