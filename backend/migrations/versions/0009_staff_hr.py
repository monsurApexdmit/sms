"""staff_attendance, salary_structure, payroll_run and payslip tables

Revision ID: 0009
Revises: 0003
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"}


def upgrade() -> None:
    op.create_table(
        "staff_attendance",
        sa.Column("staff_attendance_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("staff_role", sa.String(20), nullable=False),
        sa.Column("staff_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False, index=True),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("check_in", sa.String(5), nullable=True),
        sa.Column("check_out", sa.String(5), nullable=True),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("recorded_by", sa.String(64), nullable=True),
        sa.UniqueConstraint("staff_role", "staff_id", "date", name="uq_staff_attendance_day"),
        **TABLE,
    )
    op.create_table(
        "salary_structure",
        sa.Column("salary_structure_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("staff_role", sa.String(20), nullable=False),
        sa.Column("staff_id", sa.Integer(), nullable=False),
        sa.Column("basic", sa.Numeric(12, 2), nullable=False),
        sa.Column("allowances", sa.Text(), nullable=True),
        sa.Column("deductions", sa.Text(), nullable=True),
        sa.Column("effective_from", sa.Date(), nullable=False),
        **TABLE,
    )
    op.create_index("ix_salary_structure_staff", "salary_structure", ["staff_role", "staff_id"])
    op.create_table(
        "payroll_run",
        sa.Column("payroll_run_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("month", sa.String(7), nullable=False, unique=True),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("finalized_at", sa.DateTime(), nullable=True),
        sa.Column("paid_at", sa.DateTime(), nullable=True),
        **TABLE,
    )
    op.create_table(
        "payslip",
        sa.Column("payslip_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "payroll_run_id", sa.Integer(),
            sa.ForeignKey("payroll_run.payroll_run_id", ondelete="CASCADE"), nullable=False, index=True,
        ),  # fmt: skip
        sa.Column("staff_role", sa.String(20), nullable=False),
        sa.Column("staff_id", sa.Integer(), nullable=False),
        sa.Column("staff_name", sa.String(200), nullable=True),
        sa.Column("basic", sa.Numeric(12, 2), nullable=False),
        sa.Column("allowances", sa.Text(), nullable=True),
        sa.Column("deductions", sa.Text(), nullable=True),
        sa.Column("absence_deduction", sa.Numeric(12, 2), nullable=False),
        sa.Column("gross", sa.Numeric(12, 2), nullable=False),
        sa.Column("net", sa.Numeric(12, 2), nullable=False),
        sa.Column("working_days", sa.Integer(), nullable=False),
        sa.Column("present_days", sa.Numeric(5, 1), nullable=False),
        sa.Column("absent_days", sa.Numeric(5, 1), nullable=False),
        sa.Column("leave_days", sa.Integer(), nullable=False),
        sa.Column("paid_on", sa.Date(), nullable=True),
        sa.Column("payment_id", sa.Integer(), nullable=True),
        sa.UniqueConstraint("payroll_run_id", "staff_role", "staff_id", name="uq_payslip_staff"),
        **TABLE,
    )


def downgrade() -> None:
    op.drop_table("payslip")
    op.drop_table("payroll_run")
    op.drop_table("salary_structure")
    op.drop_table("staff_attendance")
