"""exam_schedule, exam_weight and report_remark tables

Revision ID: 0007
Revises: 0003
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "exam_schedule",
        sa.Column("exam_schedule_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("exam_id", sa.Integer(), nullable=False),
        sa.Column("class_id", sa.Integer(), nullable=False),
        sa.Column("subject_id", sa.Integer(), nullable=False),
        sa.Column("exam_date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.String(5), nullable=False),
        sa.Column("end_time", sa.String(5), nullable=False),
        sa.Column("room", sa.String(50), nullable=True),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_exam_schedule_exam_class", "exam_schedule", ["exam_id", "class_id"])
    op.create_table(
        "exam_weight",
        sa.Column("exam_id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("weight", sa.Float(), nullable=False),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "report_remark",
        sa.Column("report_remark_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("exam_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("year", sa.String(9), nullable=False),
        sa.Column("remark", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.String(64), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("student_id", "exam_id", "year", name="uq_report_remark"),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )


def downgrade() -> None:
    op.drop_table("report_remark")
    op.drop_table("exam_weight")
    op.drop_table("exam_schedule")
