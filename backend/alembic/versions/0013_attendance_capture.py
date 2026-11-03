"""period_attendance, id_card, attendance_device and attendance_punch tables

Revision ID: 0013
Revises: 0008
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MYSQL = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"}


def upgrade() -> None:
    op.create_table(
        "period_attendance",
        sa.Column("period_attendance_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("class_id", sa.Integer(), nullable=False),
        sa.Column("section_id", sa.Integer(), nullable=False),
        sa.Column("class_routine_id", sa.Integer(), nullable=False),
        sa.Column("subject_id", sa.Integer(), nullable=False, index=True),
        sa.Column("student_id", sa.Integer(), nullable=False, index=True),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("marked_by", sa.String(64), nullable=True),
        sa.Column("marked_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("date", "class_routine_id", "student_id", name="uq_period_attendance"),
        **MYSQL,
    )
    op.create_index("ix_period_attendance_section_day", "period_attendance", ["class_id", "section_id", "date"])
    op.create_table(
        "id_card",
        sa.Column("card_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("holder_role", sa.String(20), nullable=False),
        sa.Column("holder_id", sa.Integer(), nullable=False),
        sa.Column("card_uid", sa.String(100), nullable=False, unique=True),
        sa.Column("issued_on", sa.Date(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        **MYSQL,
    )
    op.create_index("ix_id_card_holder", "id_card", ["holder_role", "holder_id"])
    op.create_table(
        "attendance_device",
        sa.Column("device_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("location", sa.String(200), nullable=True),
        sa.Column("api_key_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("last_seen_at", sa.DateTime(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        **MYSQL,
    )
    op.create_table(
        "attendance_punch",
        sa.Column("punch_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("device_id", sa.Integer(), nullable=True),
        sa.Column("card_uid", sa.String(100), nullable=False),
        sa.Column("holder_role", sa.String(20), nullable=True),
        sa.Column("holder_id", sa.Integer(), nullable=True),
        sa.Column("punched_at", sa.DateTime(), nullable=False),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column("result", sa.String(20), nullable=False),
        sa.Column("recorded_by", sa.String(64), nullable=True),
        **MYSQL,
    )
    op.create_index("ix_attendance_punch_holder", "attendance_punch", ["holder_role", "holder_id", "punched_at"])
    op.create_index("ix_attendance_punch_time", "attendance_punch", ["punched_at"])


def downgrade() -> None:
    op.drop_table("attendance_punch")
    op.drop_table("attendance_device")
    op.drop_table("id_card")
    op.drop_table("period_attendance")
