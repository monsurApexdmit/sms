"""Convert the legacy MyISAM tables to InnoDB

The original CodeIgniter schema left a few tables on MyISAM. On a MySQL server with
enforce_gtid_consistency=ON (the default for replicated and managed MySQL), a transaction
that writes more than one row to a MyISAM table fails with error 1785, so saving several
settings at once or running the demo seeder broke. InnoDB also gives these tables
transactions and crash safety like the rest of the schema.

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _tables(engine: str) -> list[str]:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        return []
    rows = bind.execute(
        sa.text("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND engine = :e"),
        {"e": engine},
    )
    return [r[0] for r in rows]


def upgrade() -> None:
    for table in _tables("MyISAM"):
        op.execute(f"ALTER TABLE `{table}` ENGINE=InnoDB")


def downgrade() -> None:
    # Not reversed: going back to MyISAM would only bring the GTID error back.
    pass
