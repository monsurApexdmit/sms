"""leave_request table

Revision ID: 0006
Revises: 0003
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "leave_request",
        sa.Column("leave_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("applicant_role", sa.String(20), nullable=False),
        sa.Column("applicant_id", sa.Integer(), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=True),
        sa.Column("staff_role", sa.String(20), nullable=True),
        sa.Column("staff_id", sa.Integer(), nullable=True),
        sa.Column("kind", sa.String(20), nullable=False, server_default="other"),
        sa.Column("from_date", sa.Date(), nullable=False),
        sa.Column("to_date", sa.Date(), nullable=False),
        sa.Column("days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="pending"),
        sa.Column("decided_by", sa.String(64), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("year", sa.String(9), nullable=True),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_leave_request_student", "leave_request", ["student_id", "from_date"])
    op.create_index("ix_leave_request_staff", "leave_request", ["staff_role", "staff_id"])


def downgrade() -> None:
    op.drop_table("leave_request")
