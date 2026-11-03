"""student_health, student_record, certificate_template and certificate_issue tables

Adds the default transfer, bonafide and character certificate templates (a copy of
DEFAULT_TEMPLATES in app/services/certificates.py when this was written; later
changes there do not change this migration).

Revision ID: 0011
Revises: 0003
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_TEMPLATES = [
    {'kind': 'transfer', 'name': 'Transfer certificate', 'body': 'This is to certify that {student_name}, son/daughter of {father_name}, was a bona fide student of {school_name} from {admission_date}. At the time of leaving, {student_name} was studying in class {class}, section {section} (roll {roll}) in the academic year {year}. Date of birth according to the school records: {date_of_birth}.\n\nReason for leaving: {reason}\nConduct and character: {conduct}\n\nAll dues to the school have been cleared. We wish {student_name} every success.'},
    {'kind': 'bonafide', 'name': 'Bonafide certificate', 'body': 'This is to certify that {student_name}, son/daughter of {father_name}, is a bona fide student of {school_name}, studying in class {class}, section {section} (roll {roll}) in the academic year {year}. Date of birth according to the school records: {date_of_birth}.\n\nThis certificate is issued on request for the purpose of {reason}.'},
    {'kind': 'character', 'name': 'Character certificate', 'body': 'This is to certify that {student_name}, son/daughter of {father_name}, has been a student of {school_name} since {admission_date} and is studying in class {class} in the academic year {year}.\n\nTo the best of our knowledge, {student_name} bears a {conduct} moral character and has not taken part in any activity against the school or the state.'},
]


def upgrade() -> None:
    op.create_table(
        "student_health",
        sa.Column("health_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("student_id", sa.Integer(), nullable=False, unique=True),
        sa.Column("blood_group", sa.String(10), nullable=True),
        sa.Column("height_cm", sa.Float(), nullable=True),
        sa.Column("weight_kg", sa.Float(), nullable=True),
        sa.Column("allergies", sa.Text(), nullable=True),
        sa.Column("conditions", sa.Text(), nullable=True),
        sa.Column("medications", sa.Text(), nullable=True),
        sa.Column("emergency_contact_name", sa.String(200), nullable=True),
        sa.Column("emergency_contact_phone", sa.String(50), nullable=True),
        sa.Column("doctor", sa.String(200), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("updated_by", sa.String(64), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "student_record",
        sa.Column("record_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("student_id", sa.Integer(), nullable=False, index=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("action_taken", sa.Text(), nullable=True),
        sa.Column("confidential", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("recorded_by", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    template = op.create_table(
        "certificate_template",
        sa.Column("template_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "certificate_issue",
        sa.Column("certificate_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("serial_no", sa.String(32), nullable=False, unique=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("template_id", sa.Integer(), nullable=True),
        sa.Column("student_id", sa.Integer(), nullable=False, index=True),
        sa.Column("issued_on", sa.Date(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("conduct", sa.String(200), nullable=True),
        sa.Column("rendered_body", sa.Text(), nullable=False),
        sa.Column("issued_by", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("cancelled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    # the table was just created, so it is empty
    op.bulk_insert(template, [{**t, "active": True} for t in DEFAULT_TEMPLATES])


def downgrade() -> None:
    op.drop_table("certificate_issue")
    op.drop_table("certificate_template")
    op.drop_table("student_record")
    op.drop_table("student_health")
