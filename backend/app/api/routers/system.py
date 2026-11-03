"""System settings, dashboard, and signed media delivery."""

import calendar
import json
import mimetypes
import re
import time
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.core.deps import DB, Me, require_roles
from app.core.security import verify_media_signature
from app.models import (
    Attendance,
    Book,
    BookRequest,
    Enroll,
    FrontendEvent,
    Invoice,
    Noticeboard,
    OnlineExam,
    Parent,
    Payment,
    Student,
    Subject,
    Teacher,
)
from app.services.access import children_ids, current_enroll
from app.services.accounts import ROLES
from app.services.files import media_url, safe_path, save_site_image
from app.services.settings import (
    MASK,
    PAYPAL_FIELDS,
    PUBLIC_KEYS,
    all_settings,
    get_paypal_config,
    get_setting,
    get_stripe_config,
    paypal_enabled,
    running_year,
    set_setting,
)
from app.services.years import set_current_year, valid_year_name

router = APIRouter(tags=["system"])
admin_only = [Depends(require_roles("admin"))]

# Keys the settings screen may change. Anything else is rejected.
EDITABLE = {
    "system_name", "system_title", "address", "phone", "currency", "system_email", "language",
    "text_align", "running_year", "skin_colour", "disable_frontend", "active_sms_service",
    "clickatell_user", "clickatell_password", "clickatell_api_id",
    "twilio_account_sid", "twilio_auth_token", "twilio_sender_phone_number",
    "msg91_authentication_key", "msg91_sender_ID", "msg91_route", "msg91_country_code",
    "payumoney_merchant_key", "payumoney_salt_id", "paypal", "stripe_keys",
    "protocol", "smtp_host", "smtp_port", "smtp_user", "smtp_pass", "weekly_off_days", "mfa_required_roles",
}  # fmt: skip
SMS_SERVICES = {"", "disabled", "clickatell", "twilio", "msg91"}


@router.get("/settings/public")
def public_settings(db: DB):
    data = {k: get_setting(db, k) for k in PUBLIC_KEYS}
    stripe_cfg = get_stripe_config(db)
    data["stripe_enabled"] = stripe_cfg.get("active") == "1"
    data["paypal_enabled"] = paypal_enabled(db)
    data["logo_url"] = media_url("site", get_setting(db, "system_logo") or None, 86400)
    return data


@router.get("/settings", dependencies=admin_only)
def get_settings_all(db: DB):
    return all_settings(db)


@router.put("/settings", dependencies=admin_only)
def update_settings(body: dict[str, Any], db: DB):
    unknown = set(body) - EDITABLE
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown settings: {', '.join(sorted(unknown))}")
    for key, value in body.items():
        if key == "paypal":
            set_setting(db, key, _merge_paypal(db, value))
            continue
        if value is not None and not isinstance(value, str):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{key} must be a string")
        if value == MASK:
            continue  # unchanged secret
        if key == "stripe_keys":
            value = _merge_stripe(db, value)
        if key == "active_sms_service" and (value or "") not in SMS_SERVICES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown SMS service")
        if key == "running_year":
            if not value or not valid_year_name(value):
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "running_year must look like 2024-2025")
            set_current_year(db, value)
            continue
        if key == "weekly_off_days" and value and not re.fullmatch(r"[0-6](,[0-6])*", value.replace(" ", "")):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "weekly_off_days must be weekday numbers 0-6 (Monday = 0)")
        if key == "mfa_required_roles" and value:
            roles = [r.strip() for r in value.split(",") if r.strip()]
            if not set(roles) <= set(ROLES):
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"mfa_required_roles may only list: {', '.join(ROLES)}")
            value = ",".join(sorted(set(roles)))
        set_setting(db, key, value)
    db.commit()
    return all_settings(db)


def _merge_stripe(db: DB, raw: str | None) -> str:
    try:
        incoming = json.loads(raw or "[]")[0]
    except (ValueError, IndexError, KeyError, TypeError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "stripe_keys must be a JSON list with one object") from None
    current = get_stripe_config(db)
    merged = {**current, **{k: v for k, v in incoming.items() if v != MASK}}
    return json.dumps([merged])


def _merge_paypal(db: DB, raw: Any) -> str:
    """Accepts the settings object (or the legacy JSON list as a string); "********" keeps a stored secret."""
    bad = HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "paypal must be an object with the PayPal settings")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw or "{}")
        except ValueError:
            raise bad from None
    if isinstance(raw, list):
        raw = raw[0] if raw else {}
    if not isinstance(raw, dict) or set(raw) - set(PAYPAL_FIELDS):
        raise bad
    incoming = {k: "" if v is None else str(v).strip() for k, v in raw.items() if v != MASK}
    if incoming.get("active", "0") not in ("0", "1"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "paypal.active must be \"0\" or \"1\"")
    if incoming.get("mode", "sandbox") not in ("sandbox", "production"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "paypal.mode must be sandbox or production")
    merged = {**get_paypal_config(db), **incoming}
    return json.dumps([merged])


@router.post("/settings/logo", dependencies=admin_only)
async def upload_logo(db: DB, file: UploadFile = File(...)):
    set_setting(db, "system_logo", await save_site_image(file, "site"))
    db.commit()
    return public_settings(db)


# --- media --------------------------------------------------------------------


@router.get("/media/{path:path}", include_in_schema=False)
def media(path: str, exp: int = Query(...), sig: str = Query(...)):
    if not verify_media_signature(path, exp, sig):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Link expired or invalid")
    target = safe_path(path)
    if not target.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    inline = mime.startswith("image/") or mime == "application/pdf"
    name = target.name.split("_", 1)[1] if "_" in target.name else target.name
    return FileResponse(
        target,
        media_type=mime,
        filename=name,
        content_disposition_type="inline" if inline else "attachment",
        # Only whitelisted, non-HTML types are ever stored, and nosniff stops the
        # browser from guessing a scriptable type.
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"},
    )


# --- dashboard ----------------------------------------------------------------


def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _today_ts() -> str:
    return str(calendar.timegm(date.today().timetuple()))


def _recent_notices(db: DB, limit: int = 5) -> list[dict]:
    rows = db.scalars(select(Noticeboard).where(Noticeboard.status == 1).order_by(Noticeboard.notice_id.desc()).limit(limit))
    return [{"notice_id": n.notice_id, "notice_title": n.notice_title, "create_timestamp": n.create_timestamp} for n in rows]


def _upcoming_events(db: DB) -> list[dict]:
    now = int(time.time()) - 86400
    rows = db.scalars(
        select(FrontendEvent).where(FrontendEvent.timestamp >= now).order_by(FrontendEvent.timestamp).limit(5)
    )
    return [{"title": e.title, "timestamp": e.timestamp} for e in rows]


def _attendance_month(db: DB, student_id: int) -> dict:
    today = date.today()
    start = calendar.timegm(date(today.year, today.month, 1).timetuple())
    present = absent = 0
    for a in db.scalars(select(Attendance).where(Attendance.student_id == student_id)):
        if a.timestamp and a.timestamp.isdigit() and int(a.timestamp) >= start:
            present += a.status == 1
            absent += a.status == 2
    return {"present": present, "absent": absent}


def _student_summary(db: DB, student_id: int) -> dict:
    student = db.get(Student, student_id)
    enroll = current_enroll(db, student_id)
    unpaid = db.scalars(select(Invoice).where(Invoice.student_id == student_id, Invoice.status != "paid")).all()
    upcoming = 0
    if enroll is not None:
        upcoming = db.scalar(
            select(func.count()).select_from(OnlineExam).where(
                OnlineExam.class_id == enroll.class_id,
                OnlineExam.section_id == enroll.section_id,
                OnlineExam.status == "published",
                OnlineExam.exam_date >= int(time.time()) - 86400,
            )
        )
    return {
        "student_id": student_id,
        "name": student.name if student else None,
        "class_id": enroll.class_id if enroll else None,
        "section_id": enroll.section_id if enroll else None,
        "roll": enroll.roll if enroll else None,
        "attendance_this_month": _attendance_month(db, student_id),
        "unpaid_invoices": len(unpaid),
        "due": round(sum(_num(i.due) for i in unpaid), 2),
        "upcoming_online_exams": upcoming or 0,
    }


@router.get("/dashboard")
def dashboard(user: Me, db: DB):
    year = running_year(db)
    base = {"role": user.role, "running_year": year, "notices": _recent_notices(db), "events": _upcoming_events(db)}
    count = lambda model, *where: db.scalar(select(func.count()).select_from(model).where(*where)) or 0  # noqa: E731

    if user.role in ("admin", "accountant"):
        income = sum(_num(p.amount) for p in db.scalars(select(Payment).where(Payment.year == year, Payment.payment_type == "income")))
        expense = sum(_num(p.amount) for p in db.scalars(select(Payment).where(Payment.year == year, Payment.payment_type == "expense")))
        base["finance"] = {
            "income": round(income, 2),
            "expense": round(expense, 2),
            "unpaid_invoices": count(Invoice, Invoice.year == year, Invoice.status != "paid"),
            "currency": get_setting(db, "currency", "usd"),
        }
    if user.role == "admin":
        today = _today_ts()
        base["counts"] = {
            "students": count(Enroll, Enroll.year == year),
            "teachers": count(Teacher),
            "parents": count(Parent),
            "present_today": count(Attendance, Attendance.timestamp == today, Attendance.status == 1),
            "absent_today": count(Attendance, Attendance.timestamp == today, Attendance.status == 2),
        }
    elif user.role == "teacher":
        subject_ids = list(db.scalars(select(Subject.subject_id).where(Subject.teacher_id == user.id)))
        class_ids = {c for c in db.scalars(select(Subject.class_id).where(Subject.teacher_id == user.id)) if c}
        base["counts"] = {
            "subjects": len(subject_ids),
            "students": count(Enroll, Enroll.year == year, Enroll.class_id.in_(class_ids)) if class_ids else 0,
            "online_exams": count(OnlineExam, OnlineExam.subject_id.in_(subject_ids)) if subject_ids else 0,
        }
    elif user.role == "student":
        base["student"] = _student_summary(db, user.id)
    elif user.role == "parent":
        base["children"] = [_student_summary(db, sid) for sid in children_ids(db, user.id)]
    elif user.role == "librarian":
        base["counts"] = {
            "books": count(Book),
            "copies_issued": db.scalar(select(func.coalesce(func.sum(Book.issued_copies), 0))) or 0,
            "pending_requests": count(BookRequest, BookRequest.status == 0),
        }
    return base
