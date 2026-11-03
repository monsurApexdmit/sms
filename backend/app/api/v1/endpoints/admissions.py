"""Admissions: online applications from the public website, office review and
enrolment, and enquiries (leads) with follow-ups.

Only the three /public/admissions routes work without logging in. The status
lookup needs the reference code and the guardian's phone number and returns the
status only.
"""

import re
import secrets
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.crud import get_or_404
from app.api.deps import DB, CurrentUser, require_roles
from app.api.v1.endpoints.cms import verify_recaptcha, website_settings
from app.models import AdmissionApplication, AdmissionDocument, Enquiry, Enroll, Parent, SchoolClass, Section
from app.schemas.admissions import (
    AdmissionSettings,
    ApplicationIn,
    ApplicationOut,
    ConvertIn,
    DocumentOut,
    EnquiryIn,
    EnquiryOut,
    EnquiryStatus,
    EnrollIn,
    LookupIn,
    OfficeApplicationIn,
    StatusIn,
)
from app.schemas.common import Page
from app.services.accounts import email_taken, insert_account, insert_student
from app.services.files import delete_file, media_url, save_document
from app.services.jobs import enqueue
from app.services.notifications import Recipient, notify
from app.services.notify import send_email
from app.services.ratelimit import throttle
from app.services.settings import get_setting, running_year, set_setting
from app.services.years import valid_year_name

public = APIRouter(prefix="/public/admissions", tags=["admissions"])
router = APIRouter(prefix="/admissions", tags=["admissions"])
enquiries = APIRouter(prefix="/enquiries", tags=["admissions"])

READ = [Depends(require_roles("admin", "accountant"))]
admin_only = [Depends(require_roles("admin"))]
Admin = Depends(require_roles("admin"))

Status = Literal["new", "reviewing", "accepted", "rejected", "enrolled", "withdrawn"]
STATUS_LABELS = {
    "new": "Received", "reviewing": "Under review", "accepted": "Accepted", "rejected": "Not accepted",
    "enrolled": "Enrolled", "withdrawn": "Withdrawn",
}  # fmt: skip

DOCUMENT_TYPES = {"pdf", "jpg", "jpeg", "png", "webp", "doc", "docx"}
MAX_DOCUMENTS = 5
SUBMIT_LIMIT, SUBMIT_WINDOW = 5, 3600
LOOKUP_LIMIT, LOOKUP_WINDOW = 20, 600


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _ip(request: Request) -> str:
    return request.client.host if request.client else "?"


def _digits(phone: str | None) -> str:
    return re.sub(r"\D", "", phone or "")


# --- settings -------------------------------------------------------------------------


def _settings(db: Session) -> AdmissionSettings:
    return AdmissionSettings(
        open=get_setting(db, "admissions_open", "0") == "1",
        year=get_setting(db, "admission_year") or running_year(db),
    )


# --- helpers --------------------------------------------------------------------------


def _class_names(db: Session) -> dict[int, str]:
    return dict(db.execute(select(SchoolClass.class_id, SchoolClass.name)).all())


def _check_class(db: Session, class_id: int) -> None:
    if db.get(SchoolClass, class_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown class")


def _new_reference(db: Session, year: str) -> str:
    while True:
        ref = f"A{year[2:4]}-{secrets.token_hex(3).upper()}"
        if not db.scalar(select(AdmissionApplication.application_id).where(AdmissionApplication.reference == ref)):
            return ref


def _documents(db: Session, application_id: int) -> list[DocumentOut]:
    rows = db.scalars(
        select(AdmissionDocument).where(AdmissionDocument.application_id == application_id).order_by(AdmissionDocument.document_id)
    )
    return [
        DocumentOut(document_id=d.document_id, label=d.label, file_name=d.file_name, url=media_url("admission", d.file_name), uploaded_at=d.uploaded_at)
        for d in rows
    ]


def _out(db: Session, rows: list[AdmissionApplication], *, with_documents: bool = False) -> list[ApplicationOut]:
    names = _class_names(db)
    ids = [r.application_id for r in rows]
    counts = (
        dict(
            db.execute(
                select(AdmissionDocument.application_id, func.count())
                .where(AdmissionDocument.application_id.in_(ids))
                .group_by(AdmissionDocument.application_id)
            ).all()
        )
        if ids
        else {}
    )
    out = []
    for r in rows:
        item = ApplicationOut(
            **{c.name: getattr(r, c.name) for c in AdmissionApplication.__table__.columns},
            class_name=names.get(r.class_id),
            document_count=counts.get(r.application_id, 0),
        )
        if with_documents:
            item.documents = _documents(db, r.application_id)
        out.append(item)
    return out


def _create_application(db: Session, body: ApplicationIn, *, year: str, source: str) -> AdmissionApplication:
    _check_class(db, body.class_id)
    now = _now()
    row = AdmissionApplication(
        **body.model_dump(exclude={"year"}),
        reference=_new_reference(db, year),
        year=year,
        source=source,
        status="new",
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.flush()
    return row


async def _save_documents(db: Session, application_id: int, files: list[UploadFile], labels: list[str]) -> list[str]:
    """Store uploads; returns the stored names so the caller can remove them if the request fails."""
    saved: list[str] = []
    try:
        for i, upload in enumerate(files):
            name = await save_document(upload, "admission", DOCUMENT_TYPES)
            saved.append(name)
            label = (labels[i] if i < len(labels) else "").strip()[:100] or "Document"
            db.add(AdmissionDocument(application_id=application_id, label=label, file_name=name, uploaded_at=_now()))
    except Exception:
        for name in saved:
            delete_file("admission", name)
        raise
    return saved


def _notify_guardian(tasks: BackgroundTasks, db: Session, row: AdmissionApplication) -> None:
    if not row.guardian_email:
        return
    school = get_setting(db, "system_name", "School")
    lines = {
        "accepted": f"We are pleased to tell you that the application for {row.student_name} has been accepted. "
        "The school office will contact you about enrolment.",
        "rejected": f"We are sorry to tell you that we cannot offer a place to {row.student_name} at this time.",
    }
    text = f"Dear {row.guardian_name},\n\n{lines[row.status]}"
    if row.status_note:
        text += f"\n\n{row.status_note}"
    text += f"\n\nApplication reference: {row.reference}\n\n{school}"
    # the guardian has no account yet: email only
    notify(
        db, tasks, [Recipient(email=row.guardian_email)], "admissions", f"{school}: admission application {row.reference}",
        text, defaults={"email"},
    )  # fmt: skip


# --- public ---------------------------------------------------------------------------


@public.get("/options")
def public_options(db: DB):
    """Whether online applications are open, for which year, and the classes to apply for."""
    s = _settings(db)
    classes = db.execute(select(SchoolClass.class_id, SchoolClass.name).order_by(SchoolClass.name_numeric, SchoolClass.name)).all()
    return {"open": s.open, "year": s.year, "classes": [{"class_id": c, "name": n} for c, n in classes] if s.open else []}


@public.post("", status_code=201)
async def apply_online(
    request: Request,
    tasks: BackgroundTasks,
    db: DB,
    class_id: int = Form(),
    student_name: str = Form(),
    guardian_name: str = Form(),
    guardian_phone: str = Form(),
    date_of_birth: str | None = Form(None),
    gender: str | None = Form(None),
    previous_school: str | None = Form(None),
    guardian_relation: str | None = Form(None),
    guardian_email: str | None = Form(None),
    address: str | None = Form(None),
    notes: str | None = Form(None),
    recaptcha_token: str | None = Form(None),
    files: list[UploadFile] = File(default=[]),
    labels: list[str] = Form(default=[]),
):
    ip = _ip(request)
    throttle(f"admission:{ip}", SUBMIT_LIMIT, SUBMIT_WINDOW, "Too many applications from this connection. Please try again later.")
    settings = _settings(db)
    if not settings.open:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Online applications are closed")
    verify_recaptcha(website_settings(db), recaptcha_token, ip)
    try:
        body = ApplicationIn(
            class_id=class_id, student_name=student_name, guardian_name=guardian_name, guardian_phone=guardian_phone,
            date_of_birth=date_of_birth or None, gender=gender or None, previous_school=previous_school or None,
            guardian_relation=guardian_relation or None, guardian_email=guardian_email or None,
            address=address or None, notes=notes or None,
        )  # fmt: skip
    except ValidationError as e:
        raise RequestValidationError(e.errors()) from None
    if len(files) > MAX_DOCUMENTS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Attach at most {MAX_DOCUMENTS} documents")

    row = _create_application(db, body, year=settings.year, source="online")
    saved = await _save_documents(db, row.application_id, files, labels)
    try:
        db.commit()
    except Exception:
        for name in saved:
            delete_file("admission", name)
        raise
    if row.guardian_email:
        school = get_setting(db, "system_name", "School")
        enqueue(
            tasks, send_email, row.guardian_email, f"{school}: application received",
            f"Dear {row.guardian_name},\n\nWe have received the admission application for {row.student_name}.\n"
            f"Your reference is {row.reference}. Use it with your phone number on our website to check its status.\n\n{school}",
        )  # fmt: skip
    return {"reference": row.reference, "status": row.status, "status_label": STATUS_LABELS[row.status]}


@public.post("/status")
def public_status(body: LookupIn, request: Request, db: DB):
    """Status of an application; the reference and the guardian's phone number must both match."""
    throttle(f"admission-lookup:{_ip(request)}", LOOKUP_LIMIT, LOOKUP_WINDOW, "Too many attempts. Please try again later.")
    row = db.scalars(select(AdmissionApplication).where(AdmissionApplication.reference == body.reference.strip().upper())).first()
    if row is None or not _digits(body.phone) or _digits(row.guardian_phone) != _digits(body.phone):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No application matches that reference and phone number")
    return {"reference": row.reference, "status": row.status, "status_label": STATUS_LABELS[row.status], "updated_at": row.updated_at}


# --- applications (office) ------------------------------------------------------------


@router.get("/settings", response_model=AdmissionSettings, dependencies=READ)
def admission_settings(db: DB):
    return _settings(db)


@router.put("/settings", response_model=AdmissionSettings, dependencies=admin_only)
def update_settings(body: AdmissionSettings, db: DB):
    if not valid_year_name(body.year):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Year must look like 2025-2026")
    set_setting(db, "admissions_open", "1" if body.open else "0")
    set_setting(db, "admission_year", body.year)
    db.commit()
    return _settings(db)


@router.get("", response_model=Page, dependencies=READ)
def list_applications(
    db: DB,
    status_: Status | None = Query(None, alias="status"),
    class_id: int | None = None,
    year: str | None = None,
    q: str | None = Query(None, max_length=100, description="Reference, student, guardian name or phone"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    stmt = select(AdmissionApplication)
    if status_:
        stmt = stmt.where(AdmissionApplication.status == status_)
    if class_id:
        stmt = stmt.where(AdmissionApplication.class_id == class_id)
    if year:
        stmt = stmt.where(AdmissionApplication.year == year)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                AdmissionApplication.reference.like(like), AdmissionApplication.student_name.like(like),
                AdmissionApplication.guardian_name.like(like), AdmissionApplication.guardian_phone.like(like),
            )  # fmt: skip
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(db.scalars(stmt.order_by(AdmissionApplication.application_id.desc()).limit(limit).offset(offset)))
    return Page(items=_out(db, rows), total=total)


@router.get("/summary", dependencies=READ)
def summary(db: DB, year: str | None = None):
    """Number of applications per status for a year (default: the admission year)."""
    year = year or _settings(db).year
    counts = dict(
        db.execute(
            select(AdmissionApplication.status, func.count()).where(AdmissionApplication.year == year).group_by(AdmissionApplication.status)
        ).all()
    )
    return {"year": year, "counts": {s: counts.get(s, 0) for s in STATUS_LABELS}}


@router.get("/{application_id}", response_model=ApplicationOut, dependencies=READ)
def get_application(application_id: int, db: DB):
    return _out(db, [get_or_404(db, AdmissionApplication, application_id, "Application")], with_documents=True)[0]


@router.post("", response_model=ApplicationOut, status_code=201, dependencies=admin_only)
def create_application(body: OfficeApplicationIn, db: DB):
    """Application entered at the office (paper form, walk-in)."""
    year = body.year or _settings(db).year
    if not valid_year_name(year):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Year must look like 2025-2026")
    row = _create_application(db, body, year=year, source="office")
    db.commit()
    return _out(db, [row], with_documents=True)[0]


def _editable(db: Session, application_id: int) -> AdmissionApplication:
    row = get_or_404(db, AdmissionApplication, application_id, "Application")
    if row.status == "enrolled":
        raise HTTPException(status.HTTP_409_CONFLICT, "This application has already been enrolled")
    return row


@router.put("/{application_id}", response_model=ApplicationOut, dependencies=admin_only)
def update_application(application_id: int, body: OfficeApplicationIn, db: DB):
    row = _editable(db, application_id)
    _check_class(db, body.class_id)
    data = body.model_dump(exclude={"year"})
    if body.year:
        if not valid_year_name(body.year):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Year must look like 2025-2026")
        data["year"] = body.year
    for key, value in data.items():
        setattr(row, key, value)
    row.updated_at = _now()
    db.commit()
    return _out(db, [row], with_documents=True)[0]


@router.post("/{application_id}/documents", response_model=ApplicationOut, dependencies=admin_only)
async def add_document(application_id: int, db: DB, file: UploadFile = File(...), label: str = Form("Document")):
    row = _editable(db, application_id)
    saved = await _save_documents(db, row.application_id, [file], [label])
    try:
        db.commit()
    except Exception:
        for name in saved:
            delete_file("admission", name)
        raise
    return _out(db, [row], with_documents=True)[0]


@router.delete("/{application_id}/documents/{document_id}", status_code=204, dependencies=admin_only)
def delete_document(application_id: int, document_id: int, db: DB):
    doc = get_or_404(db, AdmissionDocument, document_id, "Document")
    if doc.application_id != application_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    name = doc.file_name
    db.delete(doc)
    db.commit()
    delete_file("admission", name)


@router.post("/{application_id}/status", response_model=ApplicationOut)
def change_status(application_id: int, body: StatusIn, tasks: BackgroundTasks, db: DB, user: CurrentUser = Admin):
    row = _editable(db, application_id)
    changed = row.status != body.status
    row.status = body.status
    row.status_note = body.note
    row.reviewed_by = user.ref
    row.updated_at = _now()
    db.commit()
    if changed and body.notify and row.status in ("accepted", "rejected"):
        _notify_guardian(tasks, db, row)
    return _out(db, [row], with_documents=True)[0]


@router.post("/{application_id}/enroll", response_model=ApplicationOut)
def enroll(application_id: int, body: EnrollIn, tasks: BackgroundTasks, db: DB, user: CurrentUser = Admin):
    """Create the student (and parent) accounts and enrol the student for the application's year."""
    row = _editable(db, application_id)
    if row.status != "accepted":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only accepted applications can be enrolled")
    section = db.get(Section, body.section_id)
    if section is None or section.class_id != row.class_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a section of the class applied for")
    if email_taken(db, body.student_email):
        raise HTTPException(status.HTTP_409_CONFLICT, "The student email is already used by another account")

    parent_id = None
    if body.parent_email:
        parent = db.scalars(select(Parent).where(func.lower(Parent.email) == body.parent_email.lower())).first()
        if parent is None:
            if email_taken(db, body.parent_email):
                raise HTTPException(status.HTTP_409_CONFLICT, "The parent email is used by a non-parent account")
            if not body.parent_password:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Set a password for the new parent account")
            parent = insert_account(
                db, Parent,
                {"name": row.guardian_name, "email": body.parent_email, "password": body.parent_password,
                 "phone": row.guardian_phone, "address": row.address},
            )  # fmt: skip
        parent_id = parent.parent_id

    roll = body.roll
    if roll is None:
        top = db.scalar(
            select(func.max(Enroll.roll)).where(
                Enroll.class_id == row.class_id, Enroll.section_id == body.section_id, Enroll.year == row.year
            )
        )
        roll = (top or 0) + 1
    student = insert_student(
        db,
        {"name": row.student_name, "email": body.student_email, "password": body.student_password,
         "birthday": row.date_of_birth.isoformat() if row.date_of_birth else None, "sex": row.gender,
         "address": row.address, "phone": row.guardian_phone, "parent_id": parent_id},
        class_id=row.class_id, section_id=body.section_id, roll=roll, year=row.year,
    )  # fmt: skip
    row.status = "enrolled"
    row.student_id = student.student_id
    row.parent_id = parent_id
    row.reviewed_by = user.ref
    row.updated_at = _now()
    db.commit()

    school = get_setting(db, "system_name", "School")
    enqueue(
        tasks, send_email, body.student_email, f"Your {school} account",
        f"Hello {row.student_name},\n\nA student account has been created for you. Log in with this email address.",
    )  # fmt: skip
    if body.parent_email and body.parent_password:
        enqueue(
            tasks, send_email, body.parent_email, f"Your {school} account",
            f"Hello {row.guardian_name},\n\nA parent account has been created for you. Log in with this email address.",
        )  # fmt: skip
    return _out(db, [row], with_documents=True)[0]


# --- enquiries ------------------------------------------------------------------------


def _enquiry_out(db: Session, rows: list[Enquiry]) -> list[EnquiryOut]:
    names = _class_names(db)
    return [
        EnquiryOut(
            **{c.name: getattr(r, c.name) for c in Enquiry.__table__.columns}, class_name=names.get(r.class_id or 0)
        )
        for r in rows
    ]


@enquiries.get("", response_model=Page, dependencies=READ)
def list_enquiries(
    db: DB,
    status_: EnquiryStatus | None = Query(None, alias="status"),
    due: bool = Query(False, description="Open enquiries with a follow-up due today or earlier"),
    q: str | None = Query(None, max_length=100),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    stmt = select(Enquiry)
    if status_:
        stmt = stmt.where(Enquiry.status == status_)
    if due:
        stmt = stmt.where(Enquiry.status == "open", Enquiry.follow_up_on.is_not(None), Enquiry.follow_up_on <= date.today())
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Enquiry.name.like(like), Enquiry.phone.like(like), Enquiry.email.like(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = (Enquiry.follow_up_on, Enquiry.enquiry_id) if due else (Enquiry.enquiry_id.desc(),)
    rows = list(db.scalars(stmt.order_by(*order).limit(limit).offset(offset)))
    return Page(items=_enquiry_out(db, rows), total=total)


@enquiries.post("", response_model=EnquiryOut, status_code=201, dependencies=admin_only)
def create_enquiry(body: EnquiryIn, db: DB):
    if body.class_id is not None:
        _check_class(db, body.class_id)
    row = Enquiry(**body.model_dump(), created_at=_now())
    db.add(row)
    db.commit()
    return _enquiry_out(db, [row])[0]


@enquiries.put("/{enquiry_id}", response_model=EnquiryOut, dependencies=admin_only)
def update_enquiry(enquiry_id: int, body: EnquiryIn, db: DB):
    row = get_or_404(db, Enquiry, enquiry_id, "Enquiry")
    if body.class_id is not None:
        _check_class(db, body.class_id)
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    db.commit()
    return _enquiry_out(db, [row])[0]


@enquiries.delete("/{enquiry_id}", status_code=204, dependencies=admin_only)
def delete_enquiry(enquiry_id: int, db: DB):
    db.delete(get_or_404(db, Enquiry, enquiry_id, "Enquiry"))
    db.commit()


@enquiries.post("/{enquiry_id}/convert", response_model=ApplicationOut, status_code=201, dependencies=admin_only)
def convert_enquiry(enquiry_id: int, body: ConvertIn, db: DB):
    """Start an application from an enquiry; the person who enquired becomes the guardian."""
    row = get_or_404(db, Enquiry, enquiry_id, "Enquiry")
    if row.application_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "This enquiry already has an application")
    class_id = body.class_id or row.class_id
    if not class_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose the class applied for")
    if not row.phone:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Add the enquirer's phone number first")
    try:
        data = ApplicationIn(
            class_id=class_id, student_name=body.student_name, guardian_name=row.name, guardian_phone=row.phone,
            guardian_email=row.email, notes=row.notes,
        )  # fmt: skip
    except ValidationError as e:
        raise RequestValidationError(e.errors()) from None
    application = _create_application(db, data, year=_settings(db).year, source="enquiry")
    row.status = "converted"
    row.application_id = application.application_id
    db.commit()
    return _out(db, [application], with_documents=True)[0]
