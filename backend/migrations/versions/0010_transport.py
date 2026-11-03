"""driver, vehicle, route_stop and student_transport tables

Routes stay in the legacy `transport` table. It and `student` are MyISAM in sms.sql,
so route_id / student_id are indexed columns rather than foreign keys.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE_OPTS = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"}


def upgrade() -> None:
    op.create_table(
        "driver",
        sa.Column("driver_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column("licence_no", sa.String(50), nullable=True),
        sa.Column("licence_expiry", sa.Date(), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        **TABLE_OPTS,
    )
    op.create_table(
        "vehicle",
        sa.Column("vehicle_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("registration_no", sa.String(50), nullable=False, unique=True),
        sa.Column("model", sa.String(100), nullable=True),
        sa.Column("capacity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("route_id", sa.Integer(), nullable=True, index=True),
        sa.Column("driver_id", sa.Integer(), sa.ForeignKey("driver.driver_id", ondelete="SET NULL"), nullable=True),
        sa.Column("insurance_expiry", sa.Date(), nullable=True),
        sa.Column("fitness_expiry", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        **TABLE_OPTS,
    )
    op.create_table(
        "route_stop",
        sa.Column("stop_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("route_id", sa.Integer(), nullable=False, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pickup_time", sa.String(5), nullable=True),
        sa.Column("drop_time", sa.String(5), nullable=True),
        sa.Column("fare", sa.String(20), nullable=True),
        **TABLE_OPTS,
    )
    op.create_table(
        "student_transport",
        sa.Column("student_transport_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("student_id", sa.Integer(), nullable=False, unique=True),
        sa.Column("route_id", sa.Integer(), nullable=False, index=True),
        sa.Column("stop_id", sa.Integer(), sa.ForeignKey("route_stop.stop_id", ondelete="SET NULL"), nullable=True),
        sa.Column("pickup", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("drop", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("since", sa.Date(), nullable=True),
        **TABLE_OPTS,
    )


def downgrade() -> None:
    op.drop_table("student_transport")
    op.drop_table("route_stop")
    op.drop_table("vehicle")
    op.drop_table("driver")
