"""Roles & permissions: role and module-level tables, seeded with the built-in roles

The six account types become rows in access_role, each with one access_role_permission row
per module it could already use (level "full"), so nothing changes until an administrator
edits them. admin.access_role_id gives an administrator account a custom (restricted) role.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-11
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

from app.core.permissions import MODULES, ROLES

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NAMES = {"admin": "Administrator", "teacher": "Teacher", "accountant": "Accountant", "librarian": "Librarian", "student": "Student", "parent": "Parent"}


def upgrade() -> None:
    role = op.create_table(
        "access_role",
        sa.Column("access_role_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(40), nullable=False, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("base_role", sa.String(20), nullable=False),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    permission = op.create_table(
        "access_role_permission",
        sa.Column("access_role_id", sa.Integer(), sa.ForeignKey("access_role.access_role_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("module", sa.String(40), primary_key=True),
        sa.Column("level", sa.String(10), nullable=False),
    )
    if "access_role_id" not in {c["name"] for c in sa.inspect(op.get_bind()).get_columns("admin")}:
        op.add_column("admin", sa.Column("access_role_id", sa.Integer(), nullable=True))

    now = datetime.now().replace(microsecond=0)
    op.bulk_insert(
        role,
        [
            {"access_role_id": i, "key": r, "name": NAMES[r], "base_role": r, "is_system": True, "created_at": now, "updated_at": now}
            for i, r in enumerate(ROLES, start=1)
        ],
    )
    op.bulk_insert(
        permission,
        [{"access_role_id": i, "module": m.key, "level": "full"} for i, r in enumerate(ROLES, start=1) for m in MODULES if r in m.roles],
    )


def downgrade() -> None:
    op.drop_column("admin", "access_role_id")
    op.drop_table("access_role_permission")
    op.drop_table("access_role")
