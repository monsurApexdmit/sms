"""Helpers for the six legacy account tables (admin, teacher, student, parent,
librarian, accountant). Each role keeps its own table and `<role>_id` column."""

import secrets
import time
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models import Accountant, Admin, Enroll, Librarian, Parent, Student, Teacher

ROLE_MODELS: dict[str, Any] = {
    "admin": Admin,
    "teacher": Teacher,
    "student": Student,
    "parent": Parent,
    "librarian": Librarian,
    "accountant": Accountant,
}
ROLES = tuple(ROLE_MODELS)


def id_column(role: str):
    model = ROLE_MODELS[role]
    return getattr(model, f"{role}_id")


def get_account(db: Session, role: str, user_id: int):
    if role not in ROLE_MODELS:
        return None
    return db.get(ROLE_MODELS[role], user_id)


def find_by_email(db: Session, email: str) -> tuple[str, Any] | None:
    """Login lookup. Same table order as the legacy login controller."""
    email = email.strip().lower()
    for role, model in ROLE_MODELS.items():
        row = db.scalars(select(model).where(func.lower(model.email) == email)).first()
        if row is not None:
            return role, row
    return None


def email_taken(db: Session, email: str, *, exclude: tuple[str, int] | None = None) -> bool:
    """Emails must be unique across all six tables, or login becomes ambiguous."""
    email = email.strip().lower()
    for role, model in ROLE_MODELS.items():
        stmt = select(id_column(role)).where(func.lower(model.email) == email)
        if exclude and exclude[0] == role:
            stmt = stmt.where(id_column(role) != exclude[1])
        if db.execute(stmt).first() is not None:
            return True
    return False


def parse_ref(ref: str | None, sep: str = "-") -> tuple[str, int] | None:
    """Parse legacy "role-id" (messages) or "role_id" (group members) references."""
    if not ref or sep not in ref:
        return None
    role, _, raw_id = ref.partition(sep)
    if role not in ROLE_MODELS or not raw_id.isdigit():
        return None
    return role, int(raw_id)


def ref_name(db: Session, ref: str | None, sep: str = "-") -> str:
    parsed = parse_ref(ref, sep)
    if not parsed:
        return "Unknown"
    row = get_account(db, *parsed)
    return row.name if row is not None and row.name else "Deleted user"


def new_code() -> str:
    """Short random code used for student IDs and enrolment codes (legacy format)."""
    return secrets.token_hex(4)[:7]


def insert_account(db: Session, model: Any, data: dict[str, Any]) -> Any:
    """Insert an account row with the password hashed. The caller checks the email and commits."""
    row = model(**{**data, "password": hash_password(data["password"])})
    db.add(row)
    db.flush()
    return row


def insert_student(
    db: Session, data: dict[str, Any], *, class_id: int, section_id: int | None, roll: int | None, year: str
) -> Student:
    """Student account plus its enrolment for `year`. The caller checks email/student code and commits."""
    student = insert_account(db, Student, {**data, "student_code": data.get("student_code") or new_code()})
    db.add(
        Enroll(
            student_id=student.student_id,
            enroll_code=new_code(),
            class_id=class_id,
            section_id=section_id,
            roll=roll,
            date_added=str(int(time.time())),
            year=year,
        )
    )
    db.flush()
    return student
