import csv
import io
from collections import defaultdict

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.crud import crud_router, get_or_404
from app.api.deps import DB, CurrentUser, Me, require_roles
from app.models import Enroll, Exam, Grade, Mark, Parent, QuestionPaper, SchoolClass, Section, Student, Subject
from app.schemas.exams import ExamIn, GradeIn, ImportResult, MarkRow, MarksSave, MarksSmsIn, MarkUpdate, QuestionPaperIn
from app.services.access import STAFF, ensure_can_view_student, ensure_teaches_subject
from app.services.jobs import enqueue
from app.services.notify import send_sms, sms_enabled
from app.services.results import grade_for, grade_point
from app.services.settings import running_year

router = APIRouter(tags=["exams"])
ALL = (*STAFF, "student", "parent")


for sub in (
    crud_router(
        path="/exams", model=Exam, schema_in=ExamIn, read_roles=ALL, write_roles=("admin",),
        filters=("year",), defaults=lambda db: {"year": running_year(db)}, label="Exam",
    ),
    crud_router(
        path="/grades", model=Grade, schema_in=GradeIn, read_roles=ALL, write_roles=("admin",),
        order_by=Grade.mark_from.desc(), label="Grade",
    ),
    crud_router(
        path="/question-papers", model=QuestionPaper, schema_in=QuestionPaperIn,
        read_roles=("admin", "teacher"), write_roles=("admin", "teacher"),
        filters=("class_id", "exam_id", "teacher_id"), label="Question paper",
    ),
):  # fmt: skip
    router.include_router(sub)


# --- marks entry --------------------------------------------------------------


def _mark_sheet(db: Session, exam_id: int, class_id: int, section_id: int, subject_id: int) -> list[MarkRow]:
    """Mirror of legacy marks_selector: make sure each enrolled student has a mark row."""
    year = running_year(db)
    enrolled = db.execute(
        select(Enroll.student_id, Enroll.roll, Student.name)
        .join(Student, Student.student_id == Enroll.student_id)
        .where(Enroll.class_id == class_id, Enroll.section_id == section_id, Enroll.year == year)
        .order_by(Enroll.roll, Student.name)
    ).all()
    match = (Mark.exam_id == exam_id, Mark.class_id == class_id, Mark.subject_id == subject_id, Mark.year == year)
    existing = {m.student_id: m for m in db.scalars(select(Mark).where(*match))}
    for sid, _, _ in enrolled:
        if sid not in existing:
            mark = Mark(
                student_id=sid, exam_id=exam_id, class_id=class_id, section_id=section_id,
                subject_id=subject_id, year=year,
            )  # fmt: skip
            db.add(mark)
            existing[sid] = mark
    db.commit()
    return [
        MarkRow(
            mark_id=existing[sid].mark_id, student_id=sid, student_name=name, roll=roll,
            mark_obtained=existing[sid].mark_obtained, comment=existing[sid].comment,
        )  # fmt: skip
        for sid, roll, name in enrolled
    ]


@router.get("/marks", response_model=list[MarkRow])
def get_marks(
    exam_id: int, class_id: int, section_id: int, subject_id: int, db: DB,
    user: CurrentUser = Depends(require_roles("admin", "teacher")),
):  # fmt: skip
    ensure_teaches_subject(db, user, subject_id)
    return _mark_sheet(db, exam_id, class_id, section_id, subject_id)


@router.put("/marks", response_model=list[MarkRow])
def save_marks(body: MarksSave, db: DB, user: CurrentUser = Depends(require_roles("admin", "teacher"))):
    ensure_teaches_subject(db, user, body.subject_id)
    ids = [i.mark_id for i in body.items]
    marks = {
        m.mark_id: m
        for m in db.scalars(
            select(Mark).where(
                Mark.mark_id.in_(ids), Mark.exam_id == body.exam_id,
                Mark.class_id == body.class_id, Mark.subject_id == body.subject_id,
            )  # fmt: skip
        )
    }
    for item in body.items:
        mark = marks.get(item.mark_id)
        if mark is not None:  # ignore ids that do not belong to this sheet
            mark.mark_obtained = item.mark_obtained
            mark.comment = item.comment
    db.commit()
    return _mark_sheet(db, body.exam_id, body.class_id, body.section_id, body.subject_id)


# --- marks import (CSV) ---------------------------------------------------------

IMPORT_COLUMNS = ("student_id", "roll", "name", "mark_obtained", "comment")


@router.get("/marks/import-template")
def marks_import_template(
    exam_id: int, class_id: int, section_id: int, subject_id: int, db: DB,
    user: CurrentUser = Depends(require_roles("admin", "teacher")),
):  # fmt: skip
    """CSV of the section's students with their current marks, ready to fill in and import."""
    ensure_teaches_subject(db, user, subject_id)
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(IMPORT_COLUMNS)
    for m in _mark_sheet(db, exam_id, class_id, section_id, subject_id):
        mark = "" if m.mark_obtained is None else m.mark_obtained
        writer.writerow([m.student_id, m.roll or "", m.student_name or "", mark, m.comment or ""])
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="marks.csv"'},
    )


def _import_error(errors: list[str]) -> HTTPException:
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        {"message": "Nothing was imported. Fix these rows and try again.", "errors": errors},
    )


@router.post("/marks/import", response_model=ImportResult)
async def import_marks(
    db: DB,
    exam_id: int = Form(...),
    class_id: int = Form(...),
    section_id: int = Form(...),
    subject_id: int = Form(...),
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_roles("admin", "teacher")),
):
    """Columns student_id and mark_obtained are required, comment is optional; others are ignored.
    A blank mark clears it. Every row is checked first, and nothing is saved if any row is wrong."""
    ensure_teaches_subject(db, user, subject_id)
    raw = (await file.read(2 * 1024 * 1024)).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    columns = {(c or "").strip() for c in reader.fieldnames or []}
    if not {"student_id", "mark_obtained"} <= columns:
        raise _import_error(["The file needs the columns student_id and mark_obtained (download the template)"])
    has_comment = "comment" in columns
    sheet = {m.student_id: m for m in _mark_sheet(db, exam_id, class_id, section_id, subject_id)}
    items: dict[int, MarkUpdate] = {}
    errors: list[str] = []
    for line, row in enumerate(reader, start=2):
        row = {(k or "").strip(): (v or "").strip() for k, v in row.items() if k is not None and isinstance(v, str)}
        if not any(row.values()):
            continue
        sid_raw, mark_raw = row.get("student_id", ""), row.get("mark_obtained", "")
        current = sheet.get(int(sid_raw)) if sid_raw.isdigit() else None
        if not sid_raw.isdigit():
            errors.append(f"Line {line}: student_id {sid_raw!r} is not a number")
        elif current is None:
            errors.append(f"Line {line}: student {sid_raw} is not enrolled in this class section")
        elif current.student_id in items:
            errors.append(f"Line {line}: student {sid_raw} appears more than once")
        if current is None or current.student_id in items:
            continue
        try:
            mark = None if mark_raw == "" else float(mark_raw)
        except ValueError:
            errors.append(f"Line {line}: mark {mark_raw!r} is not a number")
            continue
        if mark is not None and not mark.is_integer():
            errors.append(f"Line {line}: mark {mark_raw} must be a whole number")
            continue
        try:
            items[current.student_id] = MarkUpdate(
                mark_id=current.mark_id,
                mark_obtained=None if mark is None else int(mark),
                comment=(row.get("comment") or None) if has_comment else current.comment,
            )
        except ValidationError as exc:
            first = exc.errors()[0]
            errors.append(f"Line {line}: {first['loc'][0]} {first['msg'].lower()}")
    if errors:
        raise _import_error(errors)
    if not items:
        raise _import_error(["The file has no rows"])
    body = MarksSave(exam_id=exam_id, class_id=class_id, section_id=section_id, subject_id=subject_id, items=list(items.values()))
    save_marks(body, db, user)
    return ImportResult(updated=len(items))


@router.post("/exams/{exam_id}/marks-sms", dependencies=[Depends(require_roles("admin"))])
def marks_sms(exam_id: int, body: MarksSmsIn, tasks: BackgroundTasks, db: DB):
    """Legacy exam_marks_sms: text each student's (or parent's) marks for one exam."""
    exam = get_or_404(db, Exam, exam_id, "Exam")
    if not sms_enabled(db):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No SMS service is enabled. Choose one in Settings.")
    year = running_year(db)
    stmt = (
        select(Student)
        .join(Enroll, Enroll.student_id == Student.student_id)
        .where(Enroll.class_id == body.class_id, Enroll.year == year)
    )
    if body.section_id:
        stmt = stmt.where(Enroll.section_id == body.section_id)
    students = list(db.scalars(stmt.order_by(Enroll.roll, Student.name)))
    subjects = dict(db.execute(select(Subject.subject_id, Subject.name)).all())
    parent_phones = dict(db.execute(select(Parent.parent_id, Parent.phone)).all()) if body.receiver == "parent" else {}
    marks: dict[int, list[Mark]] = defaultdict(list)
    for m in db.scalars(
        select(Mark).where(Mark.exam_id == exam_id, Mark.class_id == body.class_id, Mark.year == year).order_by(Mark.subject_id)
    ):
        if m.mark_obtained is not None:
            marks[m.student_id].append(m)
    queued = 0
    for student in students:
        phone = student.phone if body.receiver == "student" else parent_phones.get(student.parent_id)
        rows = marks.get(student.student_id)
        if not (phone and phone.strip() and rows):
            continue
        scores = ", ".join(f"{subjects.get(m.subject_id, 'Subject')} {m.mark_obtained}" for m in rows)
        enqueue(tasks, send_sms, phone.strip(), f"{student.name}: {exam.name} results – {scores}")
        queued += 1
    return {"queued": queued}


# --- results ------------------------------------------------------------------

_grade_for, _gp = grade_for, grade_point  # shared with report cards (app/services/results.py)


@router.get("/marksheet/{student_id}")
def marksheet(student_id: int, user: Me, db: DB, year: str | None = None):
    ensure_can_view_student(db, user, student_id)
    year = year or running_year(db)
    student = get_or_404(db, Student, student_id, "Student")
    enroll = db.scalars(select(Enroll).where(Enroll.student_id == student_id, Enroll.year == year)).first()
    if enroll is None:
        return {"student": {"student_id": student_id, "name": student.name}, "year": year, "exams": []}
    grades = list(db.scalars(select(Grade)))
    subjects = list(db.scalars(select(Subject).where(Subject.class_id == enroll.class_id).order_by(Subject.name)))
    exams = list(db.scalars(select(Exam).where(Exam.year == year).order_by(Exam.exam_id)))
    marks = {
        (m.exam_id, m.subject_id): m
        for m in db.scalars(select(Mark).where(Mark.student_id == student_id, Mark.year == year))
    }
    highest = {
        (e, s): h
        for e, s, h in db.execute(
            select(Mark.exam_id, Mark.subject_id, func.max(Mark.mark_obtained))
            .where(Mark.class_id == enroll.class_id, Mark.year == year)
            .group_by(Mark.exam_id, Mark.subject_id)
        )
    }
    exam_out = []
    for exam in exams:
        rows, total, gp_sum = [], 0, 0.0
        for subj in subjects:
            mark = marks.get((exam.exam_id, subj.subject_id))
            obtained = mark.mark_obtained if mark else None
            grade = _grade_for(grades, obtained)
            total += obtained or 0
            gp_sum += _gp(grade)
            rows.append(
                {
                    "subject_id": subj.subject_id,
                    "subject": subj.name,
                    "mark_obtained": obtained,
                    "highest": highest.get((exam.exam_id, subj.subject_id)),
                    "grade": grade.name if grade else None,
                    "grade_point": grade.grade_point if grade else None,
                    "comment": mark.comment if mark else None,
                }
            )
        exam_out.append(
            {
                "exam_id": exam.exam_id,
                "name": exam.name,
                "subjects": rows,
                "total": total,
                "average_grade_point": round(gp_sum / len(subjects), 2) if subjects else 0,
            }
        )
    cls = db.get(SchoolClass, enroll.class_id)
    sec = db.get(Section, enroll.section_id) if enroll.section_id else None
    return {
        "student": {
            "student_id": student_id,
            "name": student.name,
            "student_code": student.student_code,
            "class_name": cls.name if cls else None,
            "section_name": sec.name if sec else None,
            "roll": enroll.roll,
        },
        "year": year,
        "exams": exam_out,
    }


@router.get("/tabulation", dependencies=[Depends(require_roles("admin", "teacher"))])
def tabulation(class_id: int, exam_id: int, db: DB, section_id: int | None = None):
    year = running_year(db)
    grades = list(db.scalars(select(Grade)))
    subjects = list(db.scalars(select(Subject).where(Subject.class_id == class_id).order_by(Subject.name)))
    stmt = (
        select(Enroll.student_id, Enroll.roll, Student.name)
        .join(Student, Student.student_id == Enroll.student_id)
        .where(Enroll.class_id == class_id, Enroll.year == year)
    )
    if section_id:
        stmt = stmt.where(Enroll.section_id == section_id)
    students = db.execute(stmt.order_by(Enroll.roll, Student.name)).all()
    marks: dict[int, dict[int, int | None]] = defaultdict(dict)
    for m in db.scalars(select(Mark).where(Mark.class_id == class_id, Mark.exam_id == exam_id, Mark.year == year)):
        marks[m.student_id][m.subject_id] = m.mark_obtained
    rows = []
    for sid, roll, name in students:
        student_marks = {s.subject_id: marks[sid].get(s.subject_id) for s in subjects}
        gp = [_gp(_grade_for(grades, v)) for v in student_marks.values()]
        rows.append(
            {
                "student_id": sid,
                "name": name,
                "roll": roll,
                "marks": student_marks,
                "total": sum(v or 0 for v in student_marks.values()),
                "average_grade_point": round(sum(gp) / len(gp), 2) if gp else 0,
            }
        )
    return {"subjects": [{"subject_id": s.subject_id, "name": s.name} for s in subjects], "rows": rows}
