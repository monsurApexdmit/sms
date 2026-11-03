"""academic_year, term and calendar_event tables

Fills academic_year with every year already used by the legacy data (enrolments,
exams, invoices, payments and the running_year setting) and marks running_year current.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-03
"""

import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

YEAR = re.compile(r"^\d{4}-\d{4}$")


def upgrade() -> None:
    year = op.create_table(
        "academic_year",
        sa.Column("academic_year_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(9), nullable=False, unique=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.false()),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "term",
        sa.Column("term_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "academic_year_id", sa.Integer(),
            sa.ForeignKey("academic_year.academic_year_id", ondelete="CASCADE"), nullable=False, index=True,
        ),  # fmt: skip
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "calendar_event",
        sa.Column("event_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False, server_default="event"),
        sa.Column("audience", sa.String(20), nullable=False, server_default="all"),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_calendar_event_dates", "calendar_event", ["start_date", "end_date"])

    conn = op.get_bind()
    names: set[str] = set()
    for table, column in (("enroll", "year"), ("exam", "year"), ("invoice", "year"), ("payment", "year")):
        names.update(r[0] for r in conn.execute(sa.text(f"SELECT DISTINCT {column} FROM {table}")) if r[0])
    current = conn.execute(sa.text("SELECT description FROM settings WHERE type = 'running_year'")).scalar()
    if current:
        names.add(current)
    rows = [{"name": n, "is_current": n == current} for n in sorted(names) if YEAR.match(n)]
    if rows:
        op.bulk_insert(year, rows)


def downgrade() -> None:
    op.drop_table("calendar_event")
    op.drop_table("term")
    op.drop_table("academic_year")
