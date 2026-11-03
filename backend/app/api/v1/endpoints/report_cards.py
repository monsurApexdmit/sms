"""Exam timetable, admit cards, exam weights and report cards (per exam and annual)."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.crud import get_or_404
from app.api.deps import DB, CurrentUser, Me, forbid, not_found, require_roles
from app.models import Enroll, Exam, ExamSchedule, ExamWeight, ReportRemark, SchoolClass, Section, Student, Subject
from app.schemas.report_cards import RemarkIn, ScheduleIn, ScheduleOut, WeightsIn
from app.services.access import STAFF, current_enroll, ensure_can_view_student
from app.services.files import user_image_url
from app.services.results import (
    annual_results,
    attendance_period,
    attendance_summary,
    exam_results,
    teaches_class,
    weight_warnings,
    year_weights,
)
from app.services.settings import running_year

router = APIRouter(tags=["report cards"])
admin_only = [Depends(require_roles("admin"))]
staff = [Depends(require_roles(*STAFF))]
ALL = (*STAFF, "student", "parent")
ANNUAL = 0  # report_remark.exam_id of the annual report


# --- exam timetable -----------------------------------------------------------------


def _schedule(db: Session, exam_id: int, class_id: int) -> list[ScheduleOut]:
    """The class's papers in date/time order; `clashes` lists papers of the same class whose times overlap."""
    rows = list(
        db.scalars(
            select(ExamSchedule)
            .where(ExamSchedule.exam_id == exam_id, ExamSchedule.class_id == class_id)
            .order_by(ExamSchedule.exam_date, ExamSchedule.start_time)
        )
    )
    names = dict(db.execute(select(Subject.subject_id, Subject.name).where(Subject.class_id == class_id)).all())
    out = []
    for r in rows:
        clashes = [
            o.exam_schedule_id
            for o in rows
            if o is not r and o.exam_date == r.exam_date and o.start_time < r.end_time and r.start_time < o.end_time
        ]
        out.append(
            ScheduleOut(
                exam_schedule_id=r.exam_schedule_id, exam_id=r.exam_id, class_id=r.class_id, subject_id=r.subject_id,
                subject=names.get(r.subject_id), exam_date=r.exam_date, start_time=r.start_time, end_time=r.end_time,
                room=r.room, clashes=clashes,
            )  # fmt: skip
        )
    return out


def _check_schedule(db: Session, body: ScheduleIn) -> None:
    get_or_404(db, Exam, body.exam_id, "Exam")
    subject = db.get(Subject, body.subject_id)
    if subject is None or subject.class_id != body.class_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That subject is not taught in this class")


def _saved(db: Session, row: ExamSchedule) -> ScheduleOut:
    return next(s for s in _schedule(db, row.exam_id, row.class_id) if s.exam_schedule_id == row.exam_schedule_id)


@router.get("/exam-schedule", response_model=list[ScheduleOut], dependencies=staff)
def list_schedule(exam_id: int, class_id: int, db: DB):
    return _schedule(db, exam_id, class_id)


@router.get("/exam-schedule/student/{student_id}", response_model=list[ScheduleOut])
def student_schedule(student_id: int, exam_id: int, user: Me, db: DB):
    ensure_can_view_student(db, user, student_id)
    exam = get_or_404(db, Exam, exam_id, "Exam")
    enroll = current_enroll(db, student_id, exam.year or None)
    return _schedule(db, exam_id, enroll.class_id) if enroll and enroll.class_id else []


@router.post("/exam-schedule", response_model=ScheduleOut, status_code=201, dependencies=admin_only)
def create_schedule(body: ScheduleIn, db: DB):
    _check_schedule(db, body)
    row = ExamSchedule(**body.model_dump())
    db.add(row)
    db.commit()
    return _saved(db, row)


@router.put("/exam-schedule/{schedule_id}", response_model=ScheduleOut, dependencies=admin_only)
def update_schedule(schedule_id: int, body: ScheduleIn, db: DB):
    row = get_or_404(db, ExamSchedule, schedule_id, "Exam paper")
    _check_schedule(db, body)
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    db.commit()
    return _saved(db, row)


@router.delete("/exam-schedule/{schedule_id}", status_code=204, dependencies=admin_only)
def delete_schedule(schedule_id: int, db: DB):
    db.delete(get_or_404(db, ExamSchedule, schedule_id, "Exam paper"))
    db.commit()


# --- exam weights -------------------------------------------------------------------


def _weights_out(db: Session, year: str) -> dict:
    weighted = year_weights(db, year)
    return {
        "year": year,
        "exams": [{"exam_id": e.exam_id, "name": e.name, "weight": w} for e, w in weighted],
        "total": sum(w or 0 for _, w in weighted),
        "warnings": weight_warnings(weighted),
    }


@router.get("/exam-weights", dependencies=[Depends(require_roles(*ALL))])
def get_weights(db: DB, year: str | None = None):
    return _weights_out(db, year or running_year(db))


@router.put("/exam-weights", dependencies=admin_only)
def save_weights(body: WeightsIn, db: DB):
    exam_ids = set(db.scalars(select(Exam.exam_id).where(Exam.year == body.year)))
    for item in body.weights:
        if item.exam_id not in exam_ids:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Exam {item.exam_id} is not an exam of {body.year}")
        row = db.get(ExamWeight, item.exam_id)
        if item.weight is None or item.weight == 0:
            if row is not None:
                db.delete(row)
        elif row is None:
            db.add(ExamWeight(exam_id=item.exam_id, weight=item.weight))
        else:
            row.weight = item.weight
    db.commit()
    return _weights_out(db, body.year)


# --- people -------------------------------------------------------------------------


def _student_info(db: Session, student: Student, enroll: Enroll) -> dict:
    cls = db.get(SchoolClass, enroll.class_id) if enroll.class_id else None
    sec = db.get(Section, enroll.section_id) if enroll.section_id else None
    return {
        "student_id": student.student_id,
        "name": student.name,
        "student_code": student.student_code,
        "class_id": enroll.class_id,
        "class_name": cls.name if cls else None,
        "section_id": enroll.section_id,
        "section_name": sec.name if sec else None,
        "roll": enroll.roll,
        "image_url": user_image_url("student", student.student_id),
    }


def _enrolled(db: Session, class_id: int, year: str, section_id: int | None) -> list[tuple[Student, Enroll]]:
    stmt = (
        select(Student, Enroll)
        .join(Enroll, Enroll.student_id == Student.student_id)
        .where(Enroll.class_id == class_id, Enroll.year == year)
    )
    if section_id:
        stmt = stmt.where(Enroll.section_id == section_id)
    seen, out = set(), []
    for student, enroll in db.execute(stmt.order_by(Enroll.roll, Student.name)).all():
        if student.student_id not in seen:
            seen.add(student.student_id)
            out.append((student, enroll))
    return out


# --- admit cards --------------------------------------------------------------------


def _admit_card(db: Session, exam: Exam, student: Student, enroll: Enroll, schedule: list[ScheduleOut]) -> dict:
    return {"exam": {"exam_id": exam.exam_id, "name": exam.name, "year": exam.year}, "student": _student_info(db, student, enroll), "schedule": schedule}


@router.get("/admit-cards", dependencies=staff)
def admit_cards(exam_id: int, class_id: int, db: DB, section_id: int | None = None):
    exam = get_or_404(db, Exam, exam_id, "Exam")
    schedule = _schedule(db, exam_id, class_id)
    year = exam.year or running_year(db)
    return [_admit_card(db, exam, s, e, schedule) for s, e in _enrolled(db, class_id, year, section_id)]


@router.get("/admit-cards/student/{student_id}")
def student_admit_card(student_id: int, exam_id: int, user: Me, db: DB):
    ensure_can_view_student(db, user, student_id)
    exam = get_or_404(db, Exam, exam_id, "Exam")
    student = get_or_404(db, Student, student_id, "Student")
    enroll = current_enroll(db, student_id, exam.year or None)
    if enroll is None or not enroll.class_id:
        raise not_found("Enrolment for this exam's year")
    return _admit_card(db, exam, student, enroll, _schedule(db, exam_id, enroll.class_id))


# --- report cards -------------------------------------------------------------------


def _remark(db: Session, student_id: int, exam_id: int, year: str) -> str | None:
    row = db.scalars(
        select(ReportRemark).where(ReportRemark.student_id == student_id, ReportRemark.exam_id == exam_id, ReportRemark.year == year)
    ).first()
    return row.remark if row else None


def _cards(db: Session, class_id: int, year: str, exam: Exam | None, people: list[tuple[Student, Enroll]]) -> list[dict]:
    """Report cards for `people` (all enrolled in `class_id`), positions taken over the whole class."""
    results = exam_results(db, exam.exam_id, class_id, year) if exam else annual_results(db, class_id, year)
    class_size = len(results)
    section_sizes: dict[int | None, int] = {}
    for r in results.values():
        section_sizes[r.section_id] = section_sizes.get(r.section_id, 0) + 1
    start, end = attendance_period(db, year, exam.exam_id if exam else None, class_id)
    cards = []
    for student, enroll in people:
        r = results.get(student.student_id)
        if r is None:
            continue
        body = r.as_dict()
        body.pop("student_id")
        body.pop("section_id")
        if not exam:
            body["gpa"] = body.pop("cgpa")
        body.setdefault("exams", [])
        body.setdefault("warnings", [])
        cards.append(
            {
                "kind": "exam" if exam else "annual",
                "year": year,
                "exam": {"exam_id": exam.exam_id, "name": exam.name} if exam else None,
                "student": _student_info(db, student, enroll),
                **body,
                "class_size": class_size,
                "section_size": section_sizes.get(enroll.section_id, 0),
                "attendance": attendance_summary(db, student.student_id, year, start, end),
                "remark": _remark(db, student.student_id, exam.exam_id if exam else ANNUAL, year),
            }
        )
    return cards


def _exam_and_year(db: Session, exam_id: int | None, year: str | None) -> tuple[Exam | None, str]:
    if exam_id:
        exam = get_or_404(db, Exam, exam_id, "Exam")
        return exam, exam.year or year or running_year(db)
    return None, year or running_year(db)


@router.get("/report-cards", dependencies=staff)
def section_report_cards(class_id: int, db: DB, section_id: int | None = None, exam_id: int | None = None, year: str | None = None):
    """Every student's report card in a class (or one section) for an exam, or the annual one without `exam_id`."""
    exam, year = _exam_and_year(db, exam_id, year)
    return _cards(db, class_id, year, exam, _enrolled(db, class_id, year, section_id))


@router.get("/report-cards/student/{student_id}")
def student_report_card(student_id: int, user: Me, db: DB, exam_id: int | None = None, year: str | None = None):
    ensure_can_view_student(db, user, student_id)
    exam, year = _exam_and_year(db, exam_id, year)
    student = get_or_404(db, Student, student_id, "Student")
    enroll = current_enroll(db, student_id, year)
    if enroll is None or not enroll.class_id:
        raise not_found(f"Enrolment in {year}")
    cards = _cards(db, enroll.class_id, year, exam, [(student, enroll)])
    if not cards:
        raise not_found("Report card")
    return cards[0]


@router.put("/report-cards/student/{student_id}/remark")
def save_remark(student_id: int, body: RemarkIn, db: DB, user: CurrentUser = Depends(require_roles("admin", "teacher"))):
    """Admins, and teachers of the student's class, write the remark; an empty remark removes it."""
    exam, year = _exam_and_year(db, body.exam_id, body.year)
    enroll = current_enroll(db, student_id, year)
    if enroll is None or not enroll.class_id:
        raise not_found(f"Enrolment in {year}")
    if not teaches_class(db, user, enroll.class_id, enroll.section_id):
        raise forbid()
    exam_key = exam.exam_id if exam else ANNUAL
    row = db.scalars(
        select(ReportRemark).where(ReportRemark.student_id == student_id, ReportRemark.exam_id == exam_key, ReportRemark.year == year)
    ).first()
    text = body.remark.strip()
    if not text:
        if row is not None:
            db.delete(row)
        db.commit()
        return {"remark": None}
    if row is None:
        row = ReportRemark(student_id=student_id, exam_id=exam_key, year=year)
        db.add(row)
    row.remark = text
    row.updated_by = user.ref
    row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    return {"remark": row.remark}
