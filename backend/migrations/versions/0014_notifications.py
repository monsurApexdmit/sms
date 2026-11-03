"""notification, notification_preference and push_subscription tables

Revision ID: 0014
Revises: 0008
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notification",
        sa.Column("notification_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("recipient_role", sa.String(20), nullable=False),
        sa.Column("recipient_id", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("link", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("read_at", sa.DateTime(), nullable=True),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_notification_recipient", "notification", ["recipient_role", "recipient_id", "read_at"])
    op.create_table(
        "notification_preference",
        sa.Column("preference_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_role", sa.String(20), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("in_app", sa.Boolean(), nullable=False),
        sa.Column("email", sa.Boolean(), nullable=False),
        sa.Column("sms", sa.Boolean(), nullable=False),
        sa.Column("push", sa.Boolean(), nullable=False),
        sa.Column("whatsapp", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("user_role", "user_id", "category", name="uq_notification_preference"),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "push_subscription",
        sa.Column("subscription_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_role", sa.String(20), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("endpoint", sa.String(500), nullable=False, unique=True),
        sa.Column("p256dh", sa.String(200), nullable=False),
        sa.Column("auth", sa.String(100), nullable=False),
        sa.Column("user_agent", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_success_at", sa.DateTime(), nullable=True),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_push_subscription_user", "push_subscription", ["user_role", "user_id"])


def downgrade() -> None:
    op.drop_table("push_subscription")
    op.drop_table("notification_preference")
    op.drop_table("notification")
