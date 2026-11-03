import secrets
import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.crud import Page, crud_router, get_or_404, out_schema
from app.api.deps import DB, CurrentUser, Me, forbid, require_roles
from app.models import AcademicSyllabus, AcademicYear, ClassRoutine, Document, Enroll, SchoolClass, Section, Subject
from app.services.access import STAFF, children_ids, current_enroll, ensure_can_view_student
from app.services.files import delete_file, media_url, save_document
from app.services.settings import running_year

ALL = (*STAFF, "student", "parent")
router = APIRouter(tags=["academic"])


# --- classes / sections / subjects --------------------------------------------


class ClassIn(BaseModel):
    name: str = Field(min_length=1, max_length=11)
    name_numeric: str | None = Field(default=None, max_length=3)
    teacher_id: int | None = None


class SectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    nick_name: str | None = None
    class_id: int
    teacher_id: int | None = None


class SubjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    class_id: int
    teacher_id: int | None = None
    year: str | None = None


class RoutineIn(BaseModel):
    class_id: int
    section_id: int
    subject_id: int
    day: str = Field(pattern=r"^(saturday|sunday|monday|tuesday|wednesday|thursday|friday)$")
    time_start: int = Field(ge=0, le=23)
    time_start_min: int = Field(ge=0, le=59)
    time_end: int = Field(ge=0, le=23)
    time_end_min: int = Field(ge=0, le=59)
    year: str | None = None


def _year_default(db: Session) -> dict:
    return {"year": running_year(db)}


for sub in (
    crud_router(
        path="/classes", model=SchoolClass, schema_in=ClassIn, read_roles=ALL, write_roles=("admin",),
        order_by=SchoolClass.name_numeric, label="Class",
    ),
    crud_router(
        path="/sections", model=Section, schema_in=SectionIn, read_roles=ALL, write_roles=("admin",),
        filters=("class_id",), order_by=Section.name, label="Section",
    ),
    crud_router(
        path="/subjects", model=Subject, schema_in=SubjectIn, read_roles=ALL, write_roles=("admin",),
        filters=("class_id", "teacher_id", "year"), order_by=Subject.name, defaults=_year_default, label="Subject",
    ),
    crud_router(
        path="/class-routines", model=ClassRoutine, schema_in=RoutineIn, read_roles=STAFF, write_roles=("admin",),
        filters=("class_id", "section_id", "year"), order_by=(ClassRoutine.time_start, ClassRoutine.time_start_min),
        defaults=_year_default, label="Routine",
    ),
):  # fmt: skip
    router.include_router(sub)


@router.get("/academic-years")
def academic_years(db: DB, _: Me):
    """Running year plus every year present in enrolments or set up as a school year, and the next two for promotion."""
    current = running_year(db)
    years = {y for y in db.scalars(select(Enroll.year).distinct()) if y}
    years.update(db.scalars(select(AcademicYear.name)))
    years.add(current)
    if current[:4].isdigit():
        start = int(current[:4])
        years.update(f"{y}-{y + 1}" for y in range(start - 2, start + 3))
    return {"running_year": current, "years": sorted(years)}


@router.get("/my/routine")
def my_routine(user: Me, db: DB, student_id: int | None = None):
    """Timetable for the logged-in student, a parent's child, or a teacher's own subjects."""
    year = running_year(db)
    stmt = select(ClassRoutine).where(ClassRoutine.year == year)
    if user.role == "teacher":
        subject_ids = select(Subject.subject_id).where(Subject.teacher_id == user.id)
        stmt = stmt.where(ClassRoutine.subject_id.in_(subject_ids))
    else:
        sid = _resolve_student(db, user, student_id)
        enroll = current_enroll(db, sid, year)
        if enroll is None:
            return []
        stmt = stmt.where(ClassRoutine.class_id == enroll.class_id, ClassRoutine.section_id == enroll.section_id)
    out = out_schema(ClassRoutine)
    return [out.model_validate(r) for r in db.scalars(stmt.order_by(ClassRoutine.time_start, ClassRoutine.time_start_min))]


def _resolve_student(db: Session, user: CurrentUser, student_id: int | None) -> int:
    if user.role == "student":
        return user.id
    if user.role == "parent":
        kids = children_ids(db, user.id)
        if student_id is None and kids:
            return kids[0]
        if student_id in kids:
            return student_id
        raise forbid()
    if student_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "student_id is required")
    ensure_can_view_student(db, user, student_id)
    return student_id


# --- syllabus -----------------------------------------------------------------

SyllabusBase = out_schema(AcademicSyllabus)


class SyllabusOut(SyllabusBase):  # type: ignore[misc,valid-type]
    download_url: str | None = None


def _syllabus_out(row: AcademicSyllabus) -> SyllabusOut:
    return SyllabusOut(**SyllabusBase.model_validate(row).model_dump(), download_url=media_url("syllabus", row.file_name))


def _student_class_filter(db: Session, user: CurrentUser, student_id: int | None) -> int | None:
    """Class the caller is limited to (students/parents), or None for staff."""
    if user.role in STAFF:
        return None
    enroll = current_enroll(db, _resolve_student(db, user, student_id))
    if enroll is None:
        raise forbid()
    return enroll.class_id


@router.get("/syllabus", response_model=Page)
def list_syllabus(user: Me, db: DB, class_id: int | None = None, student_id: int | None = None):
    forced = _student_class_filter(db, user, student_id)
    class_id = forced or class_id
    stmt = select(AcademicSyllabus).where(AcademicSyllabus.year == running_year(db))
    if class_id:
        stmt = stmt.where(AcademicSyllabus.class_id == class_id)
    rows = db.scalars(stmt.order_by(AcademicSyllabus.academic_syllabus_id.desc())).all()
    return Page(items=[_syllabus_out(r) for r in rows], total=len(rows))


@router.post("/syllabus", response_model=SyllabusOut, status_code=201)
async def upload_syllabus(
    db: DB,
    user: CurrentUser = Depends(require_roles("admin", "teacher")),
    title: str = Form(..., min_length=1),
    description: str | None = Form(None),
    class_id: int = Form(...),
    subject_id: int | None = Form(None),
    file: UploadFile = File(...),
):
    name = await save_document(file, "syllabus")
    row = AcademicSyllabus(
        academic_syllabus_code=secrets.token_hex(4)[:7],
        title=title,
        description=description,
        class_id=class_id,
        subject_id=subject_id,
        uploader_type=user.role,
        uploader_id=user.id,
        year=running_year(db),
        timestamp=str(int(time.time())),
        file_name=name,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _syllabus_out(row)


@router.delete("/syllabus/{syllabus_id}", status_code=204)
def delete_syllabus(syllabus_id: int, db: DB, user: CurrentUser = Depends(require_roles("admin", "teacher"))):
    row = get_or_404(db, AcademicSyllabus, syllabus_id, "Syllabus")
    if user.role == "teacher" and not (row.uploader_type == "teacher" and row.uploader_id == user.id):
        raise forbid()
    delete_file("syllabus", row.file_name)
    db.delete(row)
    db.commit()


# --- study material -----------------------------------------------------------

DocumentBase = out_schema(Document)


class DocumentOut(DocumentBase):  # type: ignore[misc,valid-type]
    download_url: str | None = None


def _document_out(row: Document) -> DocumentOut:
    return DocumentOut(**DocumentBase.model_validate(row).model_dump(), download_url=media_url("document", row.file_name))


@router.get("/study-materials", response_model=Page)
def list_materials(user: Me, db: DB, class_id: int | None = None, student_id: int | None = None):
    forced = _student_class_filter(db, user, student_id)
    class_id = forced or class_id
    stmt = select(Document)
    if class_id:
        stmt = stmt.where(Document.class_id == str(class_id))
    if user.role == "teacher":
        stmt = stmt.where(or_(Document.teacher_id == user.id, Document.teacher_id.is_(None)))
    rows = db.scalars(stmt.order_by(Document.document_id.desc())).all()
    return Page(items=[_document_out(r) for r in rows], total=len(rows))


@router.post("/study-materials", response_model=DocumentOut, status_code=201)
async def upload_material(
    db: DB,
    user: CurrentUser = Depends(require_roles("admin", "teacher")),
    title: str = Form(..., min_length=1),
    description: str | None = Form(None),
    class_id: int = Form(...),
    subject_id: int | None = Form(None),
    file: UploadFile = File(...),
):
    name = await save_document(file, "document")
    row = Document(
        title=title,
        description=description,
        class_id=str(class_id),
        subject_id=subject_id,
        teacher_id=user.id if user.role == "teacher" else None,
        file_name=name,
        file_type=name.rsplit(".", 1)[-1].lower(),
        timestamp=str(int(time.time())),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _document_out(row)


@router.delete("/study-materials/{document_id}", status_code=204)
def delete_material(document_id: int, db: DB, user: CurrentUser = Depends(require_roles("admin", "teacher"))):
    row = get_or_404(db, Document, document_id, "Study material")
    if user.role == "teacher" and row.teacher_id != user.id:
        raise forbid()
    delete_file("document", row.file_name)
    db.delete(row)
    db.commit()
