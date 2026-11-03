"""Baseline: the legacy CodeIgniter schema from sqldatabase/sms.sql.

Creates nothing. The legacy tables already exist in every database this system runs
on (imported from sms.sql), so upgrading an existing database just records this
revision and continues with the ones after it.

Revision ID: 0001
Revises:
Create Date: 2026-11-03
"""

from collections.abc import Sequence

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
