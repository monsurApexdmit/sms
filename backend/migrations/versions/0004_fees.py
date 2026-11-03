"""fee structure: fee_head, fee_plan, fee_plan_item, fee_instalment, fee_discount, fee_invoice

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE_ARGS = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"}


def upgrade() -> None:
    op.create_table(
        "fee_head",
        sa.Column("fee_head_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=True),
        **TABLE_ARGS,
    )
    op.create_table(
        "fee_plan",
        sa.Column("fee_plan_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("class_id", sa.Integer(), nullable=False),
        sa.Column("year", sa.String(9), nullable=False),
        sa.Column("late_fine_type", sa.String(10), nullable=False, server_default="none"),
        sa.Column("late_fine_amount", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("grace_days", sa.Integer(), nullable=False, server_default="0"),
        **TABLE_ARGS,
    )
    op.create_index("ix_fee_plan_class_year", "fee_plan", ["class_id", "year"])
    op.create_table(
        "fee_plan_item",
        sa.Column("fee_plan_item_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("fee_plan_id", sa.Integer(), sa.ForeignKey("fee_plan.fee_plan_id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("fee_head_id", sa.Integer(), sa.ForeignKey("fee_head.fee_head_id"), nullable=False, index=True),
        sa.Column("amount", sa.Integer(), nullable=False),
        **TABLE_ARGS,
    )
    op.create_table(
        "fee_instalment",
        sa.Column("fee_instalment_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("fee_plan_id", sa.Integer(), sa.ForeignKey("fee_plan.fee_plan_id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("share_percent", sa.Numeric(5, 2), nullable=False),
        **TABLE_ARGS,
    )
    op.create_table(
        "fee_discount",
        sa.Column("fee_discount_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("student_id", sa.Integer(), nullable=False, index=True),
        sa.Column("fee_plan_id", sa.Integer(), sa.ForeignKey("fee_plan.fee_plan_id", ondelete="CASCADE"), nullable=True),
        sa.Column("year", sa.String(9), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("value", sa.Numeric(10, 2), nullable=False),
        sa.Column("reason", sa.String(200), nullable=True),
        **TABLE_ARGS,
    )
    op.create_table(
        "fee_invoice",
        sa.Column("fee_invoice_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("invoice_id", sa.Integer(), nullable=False, unique=True),
        sa.Column("fee_plan_id", sa.Integer(), sa.ForeignKey("fee_plan.fee_plan_id"), nullable=False, index=True),
        sa.Column("fee_instalment_id", sa.Integer(), sa.ForeignKey("fee_instalment.fee_instalment_id"), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False, index=True),
        sa.Column("base_amount", sa.Integer(), nullable=False),
        sa.Column("fine_amount", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_reminded_on", sa.Date(), nullable=True),
        sa.UniqueConstraint("fee_instalment_id", "student_id", name="uq_fee_invoice_instalment_student"),
        **TABLE_ARGS,
    )


def downgrade() -> None:
    for table in ("fee_invoice", "fee_discount", "fee_instalment", "fee_plan_item", "fee_plan", "fee_head"):
        op.drop_table(table)
