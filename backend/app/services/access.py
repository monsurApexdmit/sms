"""Record-level access rules (who may see which student's data)."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, forbid
from app.models import Enroll, Student, Subject
from app.services.settings import running_year

STAFF = ("admin", "teacher", "accountant", "librarian")


def children_ids(db: Session, parent_id: int) -> list[int]:
    return list(db.scalars(select(Student.student_id).where(Student.parent_id == parent_id)))


def ensure_can_view_student(db: Session, user: CurrentUser, student_id: int) -> None:
    if user.role in STAFF:
        return
    if user.role == "student" and user.id == student_id:
        return
    if user.role == "parent" and student_id in children_ids(db, user.id):
        return
    raise forbid()


def current_enroll(db: Session, student_id: int, year: str | None = None) -> Enroll | None:
    year = year or running_year(db)
    return db.scalars(
        select(Enroll).where(Enroll.student_id == student_id, Enroll.year == year).order_by(Enroll.enroll_id.desc())
    ).first()


def ensure_teaches_subject(db: Session, user: CurrentUser, subject_id: int) -> None:
    """Teachers may only grade subjects assigned to them. Admins may grade anything."""
    if user.role == "admin":
        return
    subject = db.get(Subject, subject_id)
    if user.role == "teacher" and subject is not None and subject.teacher_id == user.id:
        return
    raise forbid()
