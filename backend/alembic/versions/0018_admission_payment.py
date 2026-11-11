"""Application fee payment reference on admission applications

Revision ID: 0018
Revises: 0016
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("admission_application", sa.Column("payment_method", sa.String(20), nullable=True))
    op.add_column("admission_application", sa.Column("payment_reference", sa.String(100), nullable=True))
    op.add_column("admission_application", sa.Column("payment_amount", sa.Numeric(12, 2), nullable=True))
    op.add_column("admission_application", sa.Column("payment_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("admission_application", sa.Column("payment_verified_by", sa.String(64), nullable=True))
    op.add_column("admission_application", sa.Column("payment_verified_at", sa.DateTime(), nullable=True))
    op.create_index("ix_admission_application_payment_reference", "admission_application", ["payment_reference"])


def downgrade() -> None:
    op.drop_index("ix_admission_application_payment_reference", table_name="admission_application")
    for column in ("payment_verified_at", "payment_verified_by", "payment_verified", "payment_amount", "payment_reference", "payment_method"):
        op.drop_column("admission_application", column)
