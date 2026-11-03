"""homework and homework_submission tables

Revision ID: 0005
Revises: 0003
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "homework",
        sa.Column("homework_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("class_id", sa.Integer(), nullable=False),
        sa.Column("section_id", sa.Integer(), nullable=True),
        sa.Column("subject_id", sa.Integer(), nullable=False, index=True),
        sa.Column("teacher_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("file", sa.String(200), nullable=True),
        sa.Column("assigned_on", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("max_marks", sa.Float(), nullable=True),
        sa.Column("year", sa.String(9), nullable=False),
        sa.Column("allow_late", sa.Boolean(), nullable=False, server_default=sa.false()),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_homework_class", "homework", ["year", "class_id", "section_id"])
    op.create_table(
        "homework_submission",
        sa.Column("submission_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "homework_id", sa.Integer(),
            sa.ForeignKey("homework.homework_id", ondelete="CASCADE"), nullable=False, index=True,
        ),  # fmt: skip
        sa.Column("student_id", sa.Integer(), nullable=False, index=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("file", sa.String(200), nullable=True),
        sa.Column("submitted_at", sa.DateTime(), nullable=False),
        sa.Column("is_late", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("marks", sa.Float(), nullable=True),
        sa.Column("feedback", sa.Text(), nullable=True),
        sa.Column("graded_by", sa.String(64), nullable=True),
        sa.Column("graded_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("homework_id", "student_id", name="uq_homework_submission_student"),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )


def downgrade() -> None:
    op.drop_table("homework_submission")
    op.drop_table("homework")
