"""Homework: teachers set it per class (or section) and subject, students hand it in,
teachers grade it. Parents see their children's homework, submissions and grades."""

from datetime import date, datetime, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.crud import Page, get_or_404
from app.core.config import get_settings
from app.core.deps import DB, CurrentUser, Me, forbid, require_roles
from app.models import Enroll, Homework, HomeworkSubmission, Parent, SchoolClass, Section, Student, Subject, Teacher
from app.services.access import children_ids, current_enroll, ensure_teaches_subject
from app.services.files import delete_file, media_url, save_document
from app.services.jobs import enqueue
from app.services.notify import send_email
from app.services.settings import running_year

router = APIRouter(prefix="/homework", tags=["homework"])
staff_dep = require_roles("admin", "teacher")
ALL_ROLES = require_roles("admin", "teacher", "student", "parent")


class SubmissionOut(BaseModel):
    submission_id: int
    student_id: int
    text: str | None
    file_url: str | None
    submitted_at: datetime
    is_late: bool
    marks: float | None
    feedback: str | None
    graded_at: datetime | None


class HomeworkOut(BaseModel):
    homework_id: int
    class_id: int
    class_name: str | None
    section_id: int | None
    section_name: str | None
    subject_id: int
    subject_name: str | None
    teacher_id: int | None
    teacher_name: str | None
    title: str
    description: str | None
    file_url: str | None
    assigned_on: date
    due_date: date
    max_marks: float | None
    allow_late: bool
    year: str
    # staff view
    students: int | None = None
    submitted: int | None = None
    graded: int | None = None
    # student / parent view
    submission: SubmissionOut | None = None


class HomeworkPage(Page):
    items: list[HomeworkOut]


class RosterRow(BaseModel):
    student_id: int
    name: str | None
    roll: int | None
    submission: SubmissionOut | None


class GradeIn(BaseModel):
    marks: float | None = Field(default=None, ge=0)
    feedback: str | None = Field(default=None, max_length=5000)


def school_today() -> date:
    return datetime.now(ZoneInfo(get_settings().school_timezone)).date()


def _utc(value: datetime | None) -> datetime | None:
    # stored as naive UTC
    return value.replace(tzinfo=timezone.utc) if value else None


def _submission_out(row: HomeworkSubmission | None) -> SubmissionOut | None:
    if row is None:
        return None
    return SubmissionOut(
        submission_id=row.submission_id, student_id=row.student_id, text=row.text,
        file_url=media_url("homework_submission", row.file), submitted_at=_utc(row.submitted_at), is_late=row.is_late,
        marks=row.marks, feedback=row.feedback, graded_at=_utc(row.graded_at),
    )  # fmt: skip


def _names(db: Session, model, key, ids: set[int]) -> dict[int, str | None]:
    ids = {i for i in ids if i}
    return dict(db.execute(select(key, model.name).where(key.in_(ids))).all()) if ids else {}


def _homework_out(db: Session, rows: list[Homework], counts: bool = False, student_id: int | None = None) -> list[HomeworkOut]:
    classes = _names(db, SchoolClass, SchoolClass.class_id, {r.class_id for r in rows})
    sections = _names(db, Section, Section.section_id, {r.section_id for r in rows if r.section_id})
    subjects = _names(db, Subject, Subject.subject_id, {r.subject_id for r in rows})
    teachers = _names(db, Teacher, Teacher.teacher_id, {r.teacher_id for r in rows if r.teacher_id})
    ids = [r.homework_id for r in rows]
    mine: dict[int, HomeworkSubmission] = {}
    if student_id is not None and ids:
        mine = {
            s.homework_id: s
            for s in db.scalars(
                select(HomeworkSubmission).where(HomeworkSubmission.homework_id.in_(ids), HomeworkSubmission.student_id == student_id)
            )
        }
    stats: dict[int, tuple[int, int]] = {}
    if counts and ids:
        stats = {
            hid: (n, g)
            for hid, n, g in db.execute(
                select(HomeworkSubmission.homework_id, func.count(), func.count(HomeworkSubmission.graded_at))
                .where(HomeworkSubmission.homework_id.in_(ids))
                .group_by(HomeworkSubmission.homework_id)
            )
        }
    out = []
    for r in rows:
        item = HomeworkOut(
            homework_id=r.homework_id, class_id=r.class_id, class_name=classes.get(r.class_id), section_id=r.section_id,
            section_name=sections.get(r.section_id) if r.section_id else None, subject_id=r.subject_id,
            subject_name=subjects.get(r.subject_id), teacher_id=r.teacher_id,
            teacher_name=teachers.get(r.teacher_id) if r.teacher_id else None, title=r.title, description=r.description,
            file_url=media_url("homework", r.file), assigned_on=r.assigned_on, due_date=r.due_date, max_marks=r.max_marks,
            allow_late=r.allow_late, year=r.year,
        )  # fmt: skip
        if counts:
            item.students = len(_roster(db, r))
            item.submitted, item.graded = stats.get(r.homework_id, (0, 0))
        if student_id is not None:
            item.submission = _submission_out(mine.get(r.homework_id))
        out.append(item)
    return out


def _roster(db: Session, hw: Homework) -> list[tuple[int, int | None, str | None]]:
    """(student_id, roll, name) of everyone the homework was set for."""
    stmt = (
        select(Enroll.student_id, Enroll.roll, Student.name)
        .join(Student, Student.student_id == Enroll.student_id)
        .where(Enroll.class_id == hw.class_id, Enroll.year == hw.year)
    )
    if hw.section_id:
        stmt = stmt.where(Enroll.section_id == hw.section_id)
    return list(db.execute(stmt.order_by(Enroll.roll, Student.name)).all())


def _student_for(db: Session, user: CurrentUser, student_id: int | None) -> int:
    """The student whose homework a student or parent is looking at."""
    if user.role == "student":
        return user.id
    if student_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "student_id is required")
    if student_id not in children_ids(db, user.id):
        raise forbid()
    return student_id


def _set_for(db: Session, hw: Homework, student_id: int) -> bool:
    enroll = current_enroll(db, student_id, hw.year)
    return enroll is not None and enroll.class_id == hw.class_id and (not hw.section_id or enroll.section_id == hw.section_id)


def _ensure_can_view(db: Session, user: CurrentUser, hw: Homework, student_id: int | None = None) -> int | None:
    """Raises 403 unless `user` may see `hw`. Returns the student id for student/parent views."""
    if user.role in ("admin", "teacher"):
        ensure_teaches_subject(db, user, hw.subject_id)
        return None
    sid = _student_for(db, user, student_id)
    if not _set_for(db, hw, sid):
        raise forbid()
    return sid


def _check_target(db: Session, user: CurrentUser, class_id: int, section_id: int | None, subject_id: int) -> None:
    ensure_teaches_subject(db, user, subject_id)
    subject = db.get(Subject, subject_id)
    if subject is None or subject.class_id != class_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The subject does not belong to that class")
    if section_id:
        section = db.get(Section, section_id)
        if section is None or section.class_id != class_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The section does not belong to that class")


# --- homework -----------------------------------------------------------------------


@router.get("", response_model=HomeworkPage)
def list_homework(
    db: DB,
    user: CurrentUser = Depends(ALL_ROLES),
    class_id: int | None = None,
    section_id: int | None = None,
    subject_id: int | None = None,
    student_id: int | None = Query(None, description="Parents: which child"),
    state: Literal["open", "closed"] | None = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Staff: homework they set (admins: all), filterable. Students and parents: homework set for
    the student's class and section this year, with the student's submission."""
    stmt = select(Homework).where(Homework.year == running_year(db))
    sid: int | None = None
    if user.role in ("student", "parent"):
        sid = _student_for(db, user, student_id)
        enroll = current_enroll(db, sid)
        if enroll is None:
            return HomeworkPage(items=[], total=0)
        stmt = stmt.where(
            Homework.class_id == enroll.class_id, or_(Homework.section_id.is_(None), Homework.section_id == enroll.section_id)
        )
    else:
        if user.role == "teacher":
            stmt = stmt.where(Homework.subject_id.in_(select(Subject.subject_id).where(Subject.teacher_id == user.id)))
        if class_id:
            stmt = stmt.where(Homework.class_id == class_id)
        if section_id:
            stmt = stmt.where(or_(Homework.section_id.is_(None), Homework.section_id == section_id))
    if subject_id:
        stmt = stmt.where(Homework.subject_id == subject_id)
    if state == "open":
        stmt = stmt.where(Homework.due_date >= school_today())
    elif state == "closed":
        stmt = stmt.where(Homework.due_date < school_today())
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(db.scalars(stmt.order_by(Homework.due_date.desc(), Homework.homework_id.desc()).limit(limit).offset(offset)))
    return HomeworkPage(items=_homework_out(db, rows, counts=sid is None, student_id=sid), total=total)


@router.get("/{homework_id}", response_model=HomeworkOut)
def get_homework(homework_id: int, db: DB, user: CurrentUser = Depends(ALL_ROLES), student_id: int | None = None):
    hw = get_or_404(db, Homework, homework_id, "Homework")
    sid = _ensure_can_view(db, user, hw, student_id)
    return _homework_out(db, [hw], counts=sid is None, student_id=sid)[0]


@router.post("", response_model=HomeworkOut, status_code=201)
async def create_homework(
    db: DB,
    user: CurrentUser = Depends(staff_dep),
    title: str = Form(..., min_length=1, max_length=200),
    description: str | None = Form(None, max_length=10000),
    class_id: int = Form(...),
    section_id: int | None = Form(None),
    subject_id: int = Form(...),
    due_date: date = Form(...),
    max_marks: float | None = Form(None, gt=0),
    allow_late: bool = Form(False),
    file: UploadFile | None = File(None),
):
    _check_target(db, user, class_id, section_id, subject_id)
    today = school_today()
    if due_date < today:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The due date is in the past")
    name = await save_document(file, "homework") if file is not None and file.filename else None
    hw = Homework(
        class_id=class_id, section_id=section_id or None, subject_id=subject_id,
        teacher_id=user.id if user.role == "teacher" else None, title=title, description=description, file=name,
        assigned_on=today, due_date=due_date, max_marks=max_marks, year=running_year(db), allow_late=allow_late,
    )  # fmt: skip
    db.add(hw)
    db.commit()
    return _homework_out(db, [hw], counts=True)[0]


@router.put("/{homework_id}", response_model=HomeworkOut)
async def update_homework(
    homework_id: int,
    db: DB,
    user: CurrentUser = Depends(staff_dep),
    title: str = Form(..., min_length=1, max_length=200),
    description: str | None = Form(None, max_length=10000),
    section_id: int | None = Form(None),
    due_date: date = Form(...),
    max_marks: float | None = Form(None, gt=0),
    allow_late: bool = Form(False),
    remove_file: bool = Form(False),
    file: UploadFile | None = File(None),
):
    """Class and subject stay fixed once set; the section may change."""
    hw = get_or_404(db, Homework, homework_id, "Homework")
    _check_target(db, user, hw.class_id, section_id, hw.subject_id)
    if max_marks is not None:
        top = db.scalar(select(func.max(HomeworkSubmission.marks)).where(HomeworkSubmission.homework_id == hw.homework_id))
        if top is not None and top > max_marks:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"A submission already has {top:g} marks")
    if file is not None and file.filename:
        new_name = await save_document(file, "homework")
        delete_file("homework", hw.file)
        hw.file = new_name
    elif remove_file:
        delete_file("homework", hw.file)
        hw.file = None
    hw.title, hw.description, hw.section_id = title, description, section_id or None
    hw.due_date, hw.max_marks, hw.allow_late = due_date, max_marks, allow_late
    db.commit()
    return _homework_out(db, [hw], counts=True)[0]


@router.delete("/{homework_id}", status_code=204)
def delete_homework(homework_id: int, db: DB, user: CurrentUser = Depends(staff_dep)):
    hw = get_or_404(db, Homework, homework_id, "Homework")
    ensure_teaches_subject(db, user, hw.subject_id)
    for sub in db.scalars(select(HomeworkSubmission).where(HomeworkSubmission.homework_id == hw.homework_id)):
        delete_file("homework_submission", sub.file)
        db.delete(sub)
    delete_file("homework", hw.file)
    db.delete(hw)
    db.commit()


# --- submissions ----------------------------------------------------------------------


@router.post("/{homework_id}/submission", response_model=SubmissionOut)
async def submit(
    homework_id: int,
    db: DB,
    user: CurrentUser = Depends(require_roles("student")),
    text: str | None = Form(None, max_length=20000),
    file: UploadFile | None = File(None),
):
    """Hand in (or replace, until graded) the student's answer."""
    hw = get_or_404(db, Homework, homework_id, "Homework")
    if not _set_for(db, hw, user.id):
        raise forbid()
    has_file = file is not None and bool(file.filename)
    if not (text and text.strip()) and not has_file:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Write an answer or attach a file")
    late = school_today() > hw.due_date
    if late and not hw.allow_late:
        raise HTTPException(status.HTTP_409_CONFLICT, "The due date has passed")
    row = db.scalars(
        select(HomeworkSubmission).where(HomeworkSubmission.homework_id == hw.homework_id, HomeworkSubmission.student_id == user.id)
    ).first()
    if row is not None and row.graded_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This homework has already been graded")
    name = await save_document(file, "homework_submission") if has_file else None
    if row is None:
        row = HomeworkSubmission(homework_id=hw.homework_id, student_id=user.id)
        db.add(row)
    else:
        # a new submission replaces the old one, file included
        delete_file("homework_submission", row.file)
    row.text = text.strip() if text and text.strip() else None
    row.file = name
    row.submitted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    row.is_late = late
    db.commit()
    return _submission_out(row)


@router.get("/{homework_id}/submissions", response_model=list[RosterRow])
def list_submissions(homework_id: int, db: DB, user: CurrentUser = Depends(staff_dep)):
    """Every student the homework was set for, with their submission (null if not handed in)."""
    hw = get_or_404(db, Homework, homework_id, "Homework")
    ensure_teaches_subject(db, user, hw.subject_id)
    subs = {s.student_id: s for s in db.scalars(select(HomeworkSubmission).where(HomeworkSubmission.homework_id == hw.homework_id))}
    return [
        RosterRow(student_id=sid, name=name, roll=roll, submission=_submission_out(subs.get(sid)))
        for sid, roll, name in _roster(db, hw)
    ]


@router.put("/submissions/{submission_id}/grade", response_model=SubmissionOut)
def grade(submission_id: int, body: GradeIn, tasks: BackgroundTasks, db: DB, user: CurrentUser = Depends(staff_dep)):
    row = get_or_404(db, HomeworkSubmission, submission_id, "Submission")
    hw = get_or_404(db, Homework, row.homework_id, "Homework")
    ensure_teaches_subject(db, user, hw.subject_id)
    if body.marks is not None and hw.max_marks is not None and body.marks > hw.max_marks:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Marks cannot be more than {hw.max_marks:g}")
    first_grade = row.graded_at is None
    row.marks, row.feedback = body.marks, body.feedback
    row.graded_by = user.ref
    row.graded_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()

    if first_grade:
        found = db.execute(
            select(Student.name, Parent.email).join(Parent, Parent.parent_id == Student.parent_id).where(Student.student_id == row.student_id)
        ).first()
        if found and found[1]:
            score = f"{row.marks:g}" + (f" / {hw.max_marks:g}" if hw.max_marks else "") if row.marks is not None else "no marks"
            enqueue(
                tasks, send_email, found[1], f"Homework graded: {hw.title}",
                f"{found[0]}'s homework \"{hw.title}\" has been graded: {score}."
                + (f"\n\nFeedback:\n{row.feedback}" if row.feedback else ""),
            )  # fmt: skip
    return _submission_out(row)
