import csv
import io
import time

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.api.crud import get_or_404
from app.api.deps import DB, Me, require_roles
from app.core.security import hash_password
from app.models import (
    Attendance,
    BookRequest,
    Enroll,
    Invoice,
    Mark,
    Message,
    MessageThread,
    OnlineExamResult,
    Parent,
    Payment,
    SchoolClass,
    Section,
    Student,
)
from app.schemas.common import Page
from app.schemas.students import BulkResult, PromotionIn, StudentBase, StudentIn, StudentOut
from app.services.access import STAFF, children_ids, ensure_can_view_student
from app.services.accounts import email_taken, insert_student, new_code
from app.services.files import safe_path, save_image, user_image_url
from app.services.jobs import enqueue
from app.services.notify import send_email
from app.services.settings import get_setting, running_year

router = APIRouter(prefix="/students", tags=["students"])
admin_only = [Depends(require_roles("admin"))]


ENROLL_FIELDS = ("class_id", "section_id", "roll")


def _rows_to_out(db: Session, pairs: list[tuple[Student, Enroll | None]]) -> list[StudentOut]:
    class_names = dict(db.execute(select(SchoolClass.class_id, SchoolClass.name)).all())
    section_names = dict(db.execute(select(Section.section_id, Section.name)).all())
    parent_ids = {s.parent_id for s, _ in pairs if s.parent_id}
    parent_names = (
        dict(db.execute(select(Parent.parent_id, Parent.name).where(Parent.parent_id.in_(parent_ids))).all())
        if parent_ids
        else {}
    )
    out = []
    for student, enroll in pairs:
        data = StudentBase.model_validate(student).model_dump()
        if enroll is not None:
            data |= {
                "enroll_id": enroll.enroll_id,
                "class_id": enroll.class_id,
                "section_id": enroll.section_id,
                "roll": enroll.roll,
                "year": enroll.year,
                "class_name": class_names.get(enroll.class_id),
                "section_name": section_names.get(enroll.section_id),
            }
        data["parent_name"] = parent_names.get(student.parent_id)
        data["image_url"] = user_image_url("student", student.student_id)
        out.append(StudentOut(**data))
    return out


def _one(db: Session, student_id: int, year: str | None = None) -> StudentOut:
    student = get_or_404(db, Student, student_id, "Student")
    year = year or running_year(db)
    enroll = db.scalars(
        select(Enroll).where(Enroll.student_id == student_id, Enroll.year == year).order_by(Enroll.enroll_id.desc())
    ).first()
    return _rows_to_out(db, [(student, enroll)])[0]


def _check_code(db: Session, code: str | None, exclude_id: int | None = None) -> None:
    if not code:
        return
    stmt = select(Student.student_id).where(Student.student_code == code)
    if exclude_id:
        stmt = stmt.where(Student.student_id != exclude_id)
    if db.execute(stmt).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Student ID number is already used")


@router.get("", response_model=Page, dependencies=[Depends(require_roles(*STAFF))])
def list_students(
    db: DB,
    class_id: int | None = None,
    section_id: int | None = None,
    transport_id: int | None = None,
    dormitory_id: int | None = None,
    year: str | None = None,
    q: str | None = None,
    limit: int = Query(100, ge=1, le=2000),
    offset: int = Query(0, ge=0),
):
    year = year or running_year(db)
    on = (Enroll.student_id == Student.student_id) & (Enroll.year == year)
    stmt = select(Student, Enroll)
    stmt = stmt.join(Enroll, on) if class_id else stmt.outerjoin(Enroll, on)
    if class_id:
        stmt = stmt.where(Enroll.class_id == class_id)
    if section_id:
        stmt = stmt.where(Enroll.section_id == section_id)
    if transport_id:
        stmt = stmt.where(Student.transport_id == transport_id)
    if dormitory_id:
        stmt = stmt.where(Student.dormitory_id == dormitory_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Student.name.like(like), Student.email.like(like), Student.student_code.like(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(stmt.order_by(Enroll.roll, Student.name).limit(limit).offset(offset)).all()
    return Page(items=_rows_to_out(db, [(s, e) for s, e in rows]), total=total)


@router.get("/children", response_model=list[StudentOut], dependencies=[Depends(require_roles("parent"))])
def my_children(user: Me, db: DB):
    return [_one(db, sid) for sid in children_ids(db, user.id)]


@router.get("/{student_id}", response_model=StudentOut)
def get_student(student_id: int, user: Me, db: DB, year: str | None = None):
    ensure_can_view_student(db, user, student_id)
    return _one(db, student_id, year)


@router.post("", response_model=StudentOut, status_code=201, dependencies=admin_only)
def create_student(body: StudentIn, tasks: BackgroundTasks, db: DB):
    if not body.password:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Password is required")
    if email_taken(db, body.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email is already used by another account")
    _check_code(db, body.student_code)
    student = insert_student(
        db, body.model_dump(exclude=set(ENROLL_FIELDS)),
        class_id=body.class_id, section_id=body.section_id, roll=body.roll, year=running_year(db),
    )  # fmt: skip
    db.commit()
    school = get_setting(db, "system_name", "School")
    enqueue(
        tasks,
        send_email,
        body.email,
        f"Your {school} account",
        f"Hello {body.name},\n\nA student account has been created for you. Log in with this email address.",
    )
    return _one(db, student.student_id)


@router.put("/{student_id}", response_model=StudentOut, dependencies=admin_only)
def update_student(student_id: int, body: StudentIn, db: DB):
    student = get_or_404(db, Student, student_id, "Student")
    if email_taken(db, body.email, exclude=("student", student_id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email is already used by another account")
    _check_code(db, body.student_code, student_id)
    data = body.model_dump(exclude_unset=True)
    password = data.pop("password", None)
    enroll_data = {k: data.pop(k) for k in ENROLL_FIELDS if k in data}
    for key, value in data.items():
        setattr(student, key, value)
    if password:
        student.password = hash_password(password)
    year = running_year(db)
    enroll = db.scalars(select(Enroll).where(Enroll.student_id == student_id, Enroll.year == year)).first()
    if enroll is None:
        enroll = Enroll(student_id=student_id, enroll_code=new_code(), year=year, date_added=str(int(time.time())))
        db.add(enroll)
    for key, value in enroll_data.items():
        setattr(enroll, key, value)
    db.commit()
    return _one(db, student_id)


@router.delete("/{student_id}", status_code=204, dependencies=admin_only)
def delete_student(student_id: int, db: DB):
    """Same cascade as the legacy delete_student(), done in one transaction."""
    get_or_404(db, Student, student_id, "Student")
    for model in (Attendance, BookRequest, Enroll, Invoice, Mark, Payment, OnlineExamResult):
        db.execute(delete(model).where(model.student_id == student_id))
    ref = f"student-{student_id}"
    codes = list(
        db.scalars(
            select(MessageThread.message_thread_code).where(
                or_(MessageThread.sender == ref, MessageThread.reciever == ref)
            )
        )
    )
    if codes:
        db.execute(delete(Message).where(Message.message_thread_code.in_(codes)))
        db.execute(delete(MessageThread).where(MessageThread.message_thread_code.in_(codes)))
    db.execute(delete(Student).where(Student.student_id == student_id))
    db.commit()
    safe_path(f"student_image/{student_id}.jpg").unlink(missing_ok=True)


@router.post("/{student_id}/photo", response_model=StudentOut, dependencies=admin_only)
async def upload_photo(student_id: int, db: DB, file: UploadFile = File(...)):
    get_or_404(db, Student, student_id, "Student")
    await save_image(file, f"student_image/{student_id}.jpg", max_side=600)
    return _one(db, student_id)


# Columns read by bulk_csv (legacy template uploads/bulk_student.csv).
BULK_COLUMNS = ("StudentName", "Id", "Email", "Password", "Phone", "Address", "ParentID", "Gender")
BULK_EXAMPLE = ("Jane Doe", "", "jane.doe@example.com", "ChangeMe@123", "+15550100", "12 Main Street", "", "female")


@router.get("/bulk-csv/template", dependencies=[Depends(require_roles("admin", "teacher"))])
def bulk_csv_template():
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(BULK_COLUMNS)
    writer.writerow(BULK_EXAMPLE)
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="bulk_student.csv"'},
    )


@router.post("/bulk-csv", response_model=BulkResult, dependencies=admin_only)
async def bulk_csv(
    db: DB,
    class_id: int = Form(...),
    section_id: int | None = Form(None),
    file: UploadFile = File(...),
):
    """CSV columns: see BULK_COLUMNS. Id and ParentID may be empty."""
    raw = (await file.read(2 * 1024 * 1024)).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    year = running_year(db)
    created, errors = 0, []
    seen: set[str] = set()
    for line, row in enumerate(reader, start=2):
        name = (row.get("StudentName") or "").strip()
        email = (row.get("Email") or "").strip()
        password = (row.get("Password") or "").strip()
        if not (name and email and password):
            errors.append(f"Line {line}: name, email and password are required")
            continue
        if email.lower() in seen or email_taken(db, email):
            errors.append(f"Line {line}: email {email} already exists")
            continue
        code = (row.get("Id") or "").strip() or new_code()
        if db.execute(select(Student.student_id).where(Student.student_code == code)).first():
            errors.append(f"Line {line}: student ID {code} already exists")
            continue
        parent_raw = (row.get("ParentID") or "").strip()
        student = Student(
            name=name,
            email=email,
            password=hash_password(password),
            student_code=code,
            phone=(row.get("Phone") or "").strip() or None,
            address=(row.get("Address") or "").strip() or None,
            sex=(row.get("Gender") or "").strip().lower() or None,
            parent_id=int(parent_raw) if parent_raw.isdigit() else None,
        )
        db.add(student)
        db.flush()
        db.add(
            Enroll(
                student_id=student.student_id,
                enroll_code=new_code(),
                class_id=class_id,
                section_id=section_id,
                date_added=str(int(time.time())),
                year=year,
            )
        )
        seen.add(email.lower())
        created += 1
    db.commit()
    return BulkResult(created=created, errors=errors)


@router.post("/promotion", response_model=BulkResult, dependencies=admin_only)
def promote(body: PromotionIn, db: DB):
    """Enrol students into a class for the next academic year (legacy student_promotion)."""
    created, errors = 0, []
    for item in body.items:
        exists = db.execute(
            select(Enroll.enroll_id).where(Enroll.student_id == item.student_id, Enroll.year == body.to_year)
        ).first()
        if exists:
            errors.append(f"Student {item.student_id} is already enrolled in {body.to_year}")
            continue
        section_id = item.section_id or db.scalar(
            select(Section.section_id).where(Section.class_id == item.class_id).order_by(Section.section_id)
        )
        db.add(
            Enroll(
                student_id=item.student_id,
                class_id=item.class_id,
                section_id=section_id,
                enroll_code=new_code(),
                date_added=str(int(time.time())),
                year=body.to_year,
            )
        )
        created += 1
    db.commit()
    return BulkResult(created=created, errors=errors)
