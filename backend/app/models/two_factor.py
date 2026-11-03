"""Two-factor authentication."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Txt, pk, txt


class UserTotp(Base):
    """Authenticator-app (TOTP) second factor for one account. The secret is encrypted
    with a key derived from SECRET_KEY; recovery codes are stored as salted hashes."""

    __tablename__ = "user_totp"
    __table_args__ = (UniqueConstraint("role", "user_id", name="uq_user_totp_account"),)
    totp_id: Mapped[int] = pk()
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    # NULL until the user proves the authenticator works; only confirmed rows are enforced at login
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # highest 30-second step accepted so far, so a code can't be used twice
    last_used_step: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # JSON list of "salt$sha256"; a used code is removed from the list
    recovery_codes: Txt = txt()
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
