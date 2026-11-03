"""admission_application, admission_document and enquiry tables

Revision ID: 0008
Revises: 0011
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "admission_application",
        sa.Column("application_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("reference", sa.String(20), nullable=False, unique=True),
        sa.Column("year", sa.String(9), nullable=False),
        sa.Column("class_id", sa.Integer(), nullable=False),
        sa.Column("student_name", sa.String(200), nullable=False),
        sa.Column("date_of_birth", sa.Date(), nullable=True),
        sa.Column("gender", sa.String(20), nullable=True),
        sa.Column("previous_school", sa.String(200), nullable=True),
        sa.Column("guardian_name", sa.String(200), nullable=False),
        sa.Column("guardian_relation", sa.String(50), nullable=True),
        sa.Column("guardian_phone", sa.String(50), nullable=False),
        sa.Column("guardian_email", sa.String(254), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("source", sa.String(20), nullable=False, server_default="online"),
        sa.Column("status", sa.String(20), nullable=False, server_default="new"),
        sa.Column("status_note", sa.Text(), nullable=True),
        sa.Column("reviewed_by", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=True),
        sa.Column("parent_id", sa.Integer(), nullable=True),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_admission_application_status", "admission_application", ["status", "year"])
    op.create_table(
        "admission_document",
        sa.Column("document_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "application_id", sa.Integer(),
            sa.ForeignKey("admission_application.application_id", ondelete="CASCADE"), nullable=False, index=True,
        ),  # fmt: skip
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("file_name", sa.String(200), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(), nullable=False),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "enquiry",
        sa.Column("enquiry_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column("email", sa.String(254), nullable=True),
        sa.Column("class_id", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(20), nullable=False, server_default="walk-in"),
        sa.Column("follow_up_on", sa.Date(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("assigned_to", sa.String(64), nullable=True),
        sa.Column("application_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_enquiry_follow_up", "enquiry", ["status", "follow_up_on"])


def downgrade() -> None:
    op.drop_table("enquiry")
    op.drop_table("admission_document")
    op.drop_table("admission_application")
