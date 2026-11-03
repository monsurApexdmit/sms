"""In-app notifications, preferences and web-push subscriptions."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Txt, pk, txt


class Notification(Base):
    """In-app notification for one user ("role" + id, like the legacy messaging tables).
    `category` = attendance | homework | leave | fees | exams | meetings | notices | admissions | system."""

    __tablename__ = "notification"
    __table_args__ = (Index("ix_notification_recipient", "recipient_role", "recipient_id", "read_at"),)
    notification_id: Mapped[int] = pk()
    recipient_role: Mapped[str] = mapped_column(String(20), nullable=False)
    recipient_id: Mapped[int] = mapped_column(Integer, nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Txt = txt()
    # in-app path to open, e.g. "/app/leave"
    link: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class NotificationPreference(Base):
    """A user's channels for one category. Without a row the category's defaults apply
    (app/services/notifications.py DEFAULTS)."""

    __tablename__ = "notification_preference"
    __table_args__ = (UniqueConstraint("user_role", "user_id", "category", name="uq_notification_preference"),)
    preference_id: Mapped[int] = pk()
    user_role: Mapped[str] = mapped_column(String(20), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    in_app: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    email: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sms: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    push: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    whatsapp: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class PushSubscription(Base):
    """A browser's Web Push subscription. `p256dh` and `auth` are the browser's keys for
    encrypting messages to it; the API never returns them."""

    __tablename__ = "push_subscription"
    __table_args__ = (Index("ix_push_subscription_user", "user_role", "user_id"),)
    subscription_id: Mapped[int] = pk()
    user_role: Mapped[str] = mapped_column(String(20), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    endpoint: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    p256dh: Mapped[str] = mapped_column(String(200), nullable=False)
    auth: Mapped[str] = mapped_column(String(100), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
