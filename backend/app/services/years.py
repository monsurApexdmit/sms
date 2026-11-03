"""Academic years. The legacy app reads the current year from the `running_year`
setting and stores it as text ("2025-2026") on enrolments, exams, invoices etc.
`academic_year.is_current` mirrors that setting; change it only through set_current_year."""

import re

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import AcademicYear
from app.services.settings import running_year, set_setting

YEAR_NAME = re.compile(r"^\d{4}-\d{4}$")


def valid_year_name(name: str) -> bool:
    return bool(YEAR_NAME.match(name)) and int(name[5:]) == int(name[:4]) + 1


def ensure_year(db: Session, name: str) -> AcademicYear:
    row = db.scalars(select(AcademicYear).where(AcademicYear.name == name)).first()
    if row is None:
        row = AcademicYear(name=name, is_current=False)
        db.add(row)
        db.flush()
    return row


def set_current_year(db: Session, name: str) -> AcademicYear:
    """Make `name` the running year for both apps. The caller commits."""
    row = ensure_year(db, name)
    db.execute(update(AcademicYear).where(AcademicYear.academic_year_id != row.academic_year_id).values(is_current=False))
    row.is_current = True
    set_setting(db, "running_year", name)
    return row


def current_year(db: Session) -> AcademicYear | None:
    name = running_year(db)
    return db.scalars(select(AcademicYear).where(AcademicYear.name == name)).first() if name else None
