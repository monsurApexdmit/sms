"""meeting_session, meeting_slot and meeting_booking tables (parent-teacher meetings)

Revision ID: 0012
Revises: 0007
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "meeting_session",
        sa.Column("session_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("date", sa.Date(), nullable=False, index=True),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("slot_minutes", sa.Integer(), nullable=False),
        sa.Column("location", sa.String(300), nullable=True),
        sa.Column("class_id", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.String(64), nullable=True),
        sa.Column(
            "calendar_event_id", sa.Integer(),
            sa.ForeignKey("calendar_event.event_id", ondelete="SET NULL"), nullable=True,
        ),  # fmt: skip
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "meeting_slot",
        sa.Column("slot_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "session_id", sa.Integer(),
            sa.ForeignKey("meeting_session.session_id", ondelete="CASCADE"), nullable=False,
        ),  # fmt: skip
        sa.Column("teacher_id", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_meeting_slot_session_teacher", "meeting_slot", ["session_id", "teacher_id"])
    op.create_table(
        "meeting_booking",
        sa.Column("booking_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "slot_id", sa.Integer(),
            sa.ForeignKey("meeting_slot.slot_id", ondelete="CASCADE"), nullable=False, index=True,
        ),  # fmt: skip
        sa.Column("parent_id", sa.Integer(), nullable=False, index=True),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("teacher_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("active_slot_id", sa.Integer(), nullable=True, unique=True),
        sa.Column("active_key", sa.String(64), nullable=True, unique=True),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )


def downgrade() -> None:
    op.drop_table("meeting_booking")
    op.drop_table("meeting_slot")
    op.drop_table("meeting_session")
