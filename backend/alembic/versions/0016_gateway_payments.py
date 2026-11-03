"""gateway_transaction table (bKash, Nagad and SSLCommerz payments)

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "gateway_transaction",
        sa.Column("gateway_transaction_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("gateway", sa.String(20), nullable=False),
        sa.Column("reference", sa.String(64), nullable=False),
        sa.Column("gateway_ref", sa.String(100), nullable=True),
        sa.Column("gateway_trx_id", sa.String(100), nullable=True),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("payment_id", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("gateway", "reference", name="uq_gateway_transaction_reference"),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_gateway_transaction_invoice_id", "gateway_transaction", ["invoice_id"])
    op.create_index("ix_gateway_transaction_gateway_ref", "gateway_transaction", ["gateway", "gateway_ref"])


def downgrade() -> None:
    op.drop_table("gateway_transaction")
