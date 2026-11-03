"""Student health profiles, records (health, discipline, counselling, achievements) and certificates.

Who sees what:
- Health profile: admin and teachers of the student's current class read it, admin edits it;
  the student and their parent read it.
- Records: admin sees all. Teachers add records for students they teach and see the
  non-confidential ones plus confidential ones they wrote; they edit/delete only their own.
  Parents see non-confidential discipline and achievement records; students see only their
  non-confidential achievements. Counselling records are always confidential.
- Certificates: admin issues and cancels; students/parents see their non-cancelled ones.
  Anyone can check a serial at /api/public/certificates/verify (validity, kind, date, initials).
"""

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app.api.crud import get_or_404
from app.api.deps import DB, CurrentUser, Me, forbid, require_roles
from app.models import (
    CertificateIssue,
    CertificateTemplate,
    Parent,
    SchoolClass,
    Section,
    Student,
    StudentHealth,
    StudentRecord,
    Subject,
)
from app.schemas.common import Page
from app.schemas.records import (
    CancelIn,
    CertificateOut,
    CertKind,
    HealthIn,
    HealthOut,
    IssueIn,
    RecordIn,
    RecordOut,
    TemplateIn,
    TemplateOut,
    VerifyOut,
)
from app.services.access import children_ids, current_enroll
from app.services.certificates import (
    PLACEHOLDERS,
    ensure_default_templates,
    initials,
    next_serial,
    render,
    student_values,
    unknown_placeholders,
)
from app.services.files import user_image_url
from app.services.ratelimit import throttle

router = APIRouter(tags=["student records"])
public = APIRouter(prefix="/public/certificates", tags=["public website"])
admin_only = [Depends(require_roles("admin"))]
readers = [Depends(require_roles("admin", "teacher", "student", "parent"))]

PARENT_KINDS = ("discipline", "achievement")
STUDENT_KINDS = ("achievement",)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _student(db: DB, student_id: int) -> Student:
    return get_or_404(db, Student, student_id, "Student")


def teaches_student(db: DB, user: CurrentUser, student_id: int) -> bool:
    """True when the teacher has a subject in the student's class for the running year."""
    enroll = current_enroll(db, student_id)
    if user.role != "teacher" or enroll is None or enroll.class_id is None:
        return False
    return db.scalar(
        select(func.count()).select_from(Subject).where(Subject.class_id == enroll.class_id, Subject.teacher_id == user.id)
    ) > 0


def _ensure_can_read(db: DB, user: CurrentUser, student_id: int) -> None:
    if user.role == "admin":
        return
    if user.role == "teacher" and teaches_student(db, user, student_id):
        return
    if user.role == "student" and user.id == student_id:
        return
    if user.role == "parent" and student_id in children_ids(db, user.id):
        return
    raise forbid()


# --- health ---------------------------------------------------------------------------


def _health_out(db: DB, student: Student) -> HealthOut:
    row = db.scalars(select(StudentHealth).where(StudentHealth.student_id == student.student_id)).first()
    if row is None:
        return HealthOut(blood_group=student.blood_group or None)
    return HealthOut.model_validate(row, from_attributes=True)


@router.put("/student-profile/{student_id}/health", response_model=HealthOut, dependencies=admin_only)
def save_health(student_id: int, body: HealthIn, user: Me, db: DB):
    _student(db, student_id)
    row = db.scalars(select(StudentHealth).where(StudentHealth.student_id == student_id)).first()
    if row is None:
        row = StudentHealth(student_id=student_id)
        db.add(row)
    for key, value in body.model_dump().items():
        setattr(row, key, (value.strip() or None) if isinstance(value, str) else value)
    row.updated_by, row.updated_at = user.ref, _now()
    db.commit()
    return HealthOut.model_validate(row, from_attributes=True)


# --- records --------------------------------------------------------------------------


def _visible_records(db: DB, user: CurrentUser, student_id: int):
    stmt = select(StudentRecord).where(StudentRecord.student_id == student_id)
    if user.role == "admin":
        return stmt
    if user.role == "teacher":
        return stmt.where(or_(StudentRecord.confidential.is_(False), StudentRecord.recorded_by == user.ref))
    kinds = PARENT_KINDS if user.role == "parent" else STUDENT_KINDS
    return stmt.where(StudentRecord.confidential.is_(False), StudentRecord.kind.in_(kinds))


def _record_out(row: StudentRecord, user: CurrentUser) -> RecordOut:
    out = RecordOut.model_validate(row, from_attributes=True)
    out.can_edit = user.role == "admin" or row.recorded_by == user.ref
    return out


def _ensure_can_write_record(db: DB, user: CurrentUser, student_id: int) -> None:
    if user.role == "admin" or teaches_student(db, user, student_id):
        return
    raise forbid()


def _apply_record(row: StudentRecord, body: RecordIn) -> None:
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    if row.kind == "counselling":
        row.confidential = True


@router.post(
    "/student-profile/{student_id}/records", response_model=RecordOut, status_code=201,
    dependencies=[Depends(require_roles("admin", "teacher"))],
)  # fmt: skip
def add_record(student_id: int, body: RecordIn, user: Me, db: DB):
    _student(db, student_id)
    _ensure_can_write_record(db, user, student_id)
    row = StudentRecord(student_id=student_id, recorded_by=user.ref, created_at=_now())
    _apply_record(row, body)
    db.add(row)
    db.commit()
    return _record_out(row, user)


def _own_record(db: DB, user: CurrentUser, record_id: int) -> StudentRecord:
    row = get_or_404(db, StudentRecord, record_id, "Record")
    if user.role != "admin" and (row.recorded_by != user.ref or not teaches_student(db, user, row.student_id)):
        raise forbid()
    return row


@router.put("/student-records/{record_id}", response_model=RecordOut, dependencies=[Depends(require_roles("admin", "teacher"))])
def update_record(record_id: int, body: RecordIn, user: Me, db: DB):
    row = _own_record(db, user, record_id)
    _apply_record(row, body)
    db.commit()
    return _record_out(row, user)


@router.delete("/student-records/{record_id}", status_code=204, dependencies=[Depends(require_roles("admin", "teacher"))])
def delete_record(record_id: int, user: Me, db: DB):
    db.delete(_own_record(db, user, record_id))
    db.commit()


# --- certificates ---------------------------------------------------------------------


def _template_out(row: CertificateTemplate) -> TemplateOut:
    out = TemplateOut.model_validate(row, from_attributes=True)
    out.unknown_placeholders = unknown_placeholders(row.body)
    return out


def _cert_out(db: DB, rows: list[CertificateIssue]) -> list[CertificateOut]:
    ids = {r.student_id for r in rows}
    names = dict(db.execute(select(Student.student_id, Student.name).where(Student.student_id.in_(ids))).all()) if ids else {}
    return [
        CertificateOut.model_validate(r, from_attributes=True).model_copy(update={"student_name": names.get(r.student_id)})
        for r in rows
    ]


@router.get("/certificate-templates", response_model=list[TemplateOut], dependencies=admin_only)
def list_templates(db: DB):
    return [_template_out(r) for r in db.scalars(select(CertificateTemplate).order_by(CertificateTemplate.kind, CertificateTemplate.name))]


@router.get("/certificate-templates/placeholders", response_model=dict[str, str], dependencies=admin_only)
def list_placeholders():
    return PLACEHOLDERS


@router.post("/certificate-templates/defaults", dependencies=admin_only)
def add_default_templates(db: DB):
    """Adds the built-in transfer, bonafide and character templates when there are no templates."""
    added = ensure_default_templates(db)
    db.commit()
    return {"added": added}


@router.post("/certificate-templates", response_model=TemplateOut, status_code=201, dependencies=admin_only)
def create_template(body: TemplateIn, db: DB):
    row = CertificateTemplate(**body.model_dump())
    db.add(row)
    db.commit()
    return _template_out(row)


@router.put("/certificate-templates/{template_id}", response_model=TemplateOut, dependencies=admin_only)
def update_template(template_id: int, body: TemplateIn, db: DB):
    row = get_or_404(db, CertificateTemplate, template_id, "Template")
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    db.commit()
    return _template_out(row)


@router.delete("/certificate-templates/{template_id}", status_code=204, dependencies=admin_only)
def delete_template(template_id: int, db: DB):
    row = get_or_404(db, CertificateTemplate, template_id, "Template")
    if db.scalar(select(func.count()).select_from(CertificateIssue).where(CertificateIssue.template_id == template_id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Certificates were issued from this template; turn it off instead")
    db.delete(row)
    db.commit()


def _render_issue(db: DB, body: IssueIn, serial: str) -> tuple[CertificateTemplate, str]:
    template = get_or_404(db, CertificateTemplate, body.template_id, "Template")
    student = _student(db, body.student_id)
    values = student_values(
        db, student, issued_on=body.issued_on or date.today(), serial=serial, reason=body.reason, conduct=body.conduct
    )
    return template, render(template.body, values)


@router.post("/certificates/preview", dependencies=admin_only)
def preview_certificate(body: IssueIn, db: DB):
    template, text = _render_issue(db, body, serial="(assigned when issued)")
    return {"kind": template.kind, "rendered_body": text, "unknown_placeholders": unknown_placeholders(template.body)}


@router.post("/certificates", response_model=CertificateOut, status_code=201, dependencies=admin_only)
def issue_certificate(body: IssueIn, user: Me, db: DB):
    issued_on = body.issued_on or date.today()
    body = body.model_copy(update={"issued_on": issued_on})
    template = get_or_404(db, CertificateTemplate, body.template_id, "Template")
    if not template.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "This template is turned off")
    for _ in range(3):
        serial = next_serial(db, template.kind, issued_on)
        _, text = _render_issue(db, body, serial)
        row = CertificateIssue(
            serial_no=serial, kind=template.kind, template_id=template.template_id, student_id=body.student_id,
            issued_on=issued_on, reason=body.reason, conduct=body.conduct, rendered_body=text,
            issued_by=user.ref, created_at=_now(), cancelled=False,
        )  # fmt: skip
        db.add(row)
        try:
            db.commit()
        except IntegrityError:  # another admin took the same serial at the same moment
            db.rollback()
            continue
        return _cert_out(db, [row])[0]
    raise HTTPException(status.HTTP_409_CONFLICT, "Could not assign a serial number, please try again")


@router.get("/certificates", response_model=Page, dependencies=admin_only)
def list_certificates(
    db: DB,
    student_id: int | None = None,
    kind: CertKind | None = None,
    include_cancelled: bool = True,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    stmt = select(CertificateIssue)
    if student_id:
        stmt = stmt.where(CertificateIssue.student_id == student_id)
    if kind:
        stmt = stmt.where(CertificateIssue.kind == kind)
    if not include_cancelled:
        stmt = stmt.where(CertificateIssue.cancelled.is_(False))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(db.scalars(stmt.order_by(CertificateIssue.certificate_id.desc()).limit(limit).offset(offset)))
    return Page(items=_cert_out(db, rows), total=total)


@router.get("/certificates/mine", response_model=list[CertificateOut], dependencies=[Depends(require_roles("student", "parent"))])
def my_certificates(user: Me, db: DB):
    ids = [user.id] if user.role == "student" else children_ids(db, user.id)
    if not ids:
        return []
    rows = db.scalars(
        select(CertificateIssue)
        .where(CertificateIssue.student_id.in_(ids), CertificateIssue.cancelled.is_(False))
        .order_by(CertificateIssue.issued_on.desc(), CertificateIssue.certificate_id.desc())
    )
    return _cert_out(db, list(rows))


@router.get(
    "/certificates/{certificate_id}", response_model=CertificateOut,
    dependencies=[Depends(require_roles("admin", "student", "parent"))],
)  # fmt: skip
def get_certificate(certificate_id: int, user: Me, db: DB):
    """Printable certificate. Students and parents get only their own, and not once cancelled."""
    row = get_or_404(db, CertificateIssue, certificate_id, "Certificate")
    if user.role != "admin":
        own = row.student_id == user.id if user.role == "student" else row.student_id in children_ids(db, user.id)
        if not own or row.cancelled:
            raise forbid()
    return _cert_out(db, [row])[0]


@router.post("/certificates/{certificate_id}/cancel", response_model=CertificateOut, dependencies=admin_only)
def cancel_certificate(certificate_id: int, body: CancelIn, db: DB):
    row = get_or_404(db, CertificateIssue, certificate_id, "Certificate")
    row.cancelled, row.cancel_reason = True, body.reason
    db.commit()
    return _cert_out(db, [row])[0]


@public.get("/verify", response_model=VerifyOut)
def verify_certificate(request: Request, db: DB, serial: str = Query(min_length=1, max_length=32)):
    """Public check of a printed serial. Says nothing about cancelled or unknown serials beyond `valid: false`."""
    throttle(f"cert-verify:{request.client.host if request.client else '?'}", 30, 60, "Too many checks. Try again in a minute.")
    row = db.scalars(select(CertificateIssue).where(CertificateIssue.serial_no == serial.strip().upper())).first()
    if row is None or row.cancelled:
        return VerifyOut(valid=False)
    student = db.get(Student, row.student_id)
    return VerifyOut(valid=True, kind=row.kind, issued_on=row.issued_on, student_initials=initials(student.name if student else ""))


# --- profile --------------------------------------------------------------------------


@router.get("/student-profile/{student_id}", dependencies=readers)
def student_profile(student_id: int, user: Me, db: DB):
    """Header, health profile, the records the user may see and the student's certificates."""
    student = _student(db, student_id)
    _ensure_can_read(db, user, student_id)
    enroll = current_enroll(db, student_id)
    klass = db.get(SchoolClass, enroll.class_id) if enroll and enroll.class_id else None
    section = db.get(Section, enroll.section_id) if enroll and enroll.section_id else None
    parent = db.get(Parent, student.parent_id) if student.parent_id else None
    records = db.scalars(
        _visible_records(db, user, student_id).order_by(StudentRecord.date.desc(), StudentRecord.record_id.desc())
    )
    certs = select(CertificateIssue).where(CertificateIssue.student_id == student_id)
    if user.role != "admin":
        certs = certs.where(CertificateIssue.cancelled.is_(False))
    return {
        "student": {
            "student_id": student.student_id,
            "name": student.name,
            "class_name": klass.name if klass else None,
            "section_name": section.name if section else None,
            "roll": enroll.roll if enroll else None,
            "parent_name": parent.name if parent else None,
            "image_url": user_image_url("student", student.student_id),
        },
        "health": _health_out(db, student),
        "records": [_record_out(r, user) for r in records],
        "certificates": _cert_out(db, list(db.scalars(certs.order_by(CertificateIssue.certificate_id.desc())))),
        "can_edit_health": user.role == "admin",
        "can_add_records": user.role == "admin" or user.role == "teacher",
    }
