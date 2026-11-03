"""Faster attendance: per-period attendance, the card check-in kiosk, ID cards and
devices that push punches. Daily attendance (attendance.py) stays the official record;
periods only change it through the explicit "fill daily attendance" action."""

import hmac
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.crud import get_or_404
from app.api.deps import DB, CurrentUser, forbid, not_found, require_roles
from app.api.v1.endpoints.attendance import _sheet as daily_sheet
from app.core.config import get_settings
from app.models import (
    Attendance,
    AttendanceDevice,
    AttendancePunch,
    ClassRoutine,
    Enroll,
    IdCard,
    PeriodAttendance,
    SchoolClass,
    Section,
    Student,
    Subject,
)
from app.schemas.attendance_capture import (
    BulkCards,
    CaptureSettings,
    CardIn,
    DeviceIn,
    FillDaily,
    HolderRole,
    PeriodOut,
    PeriodRow,
    PeriodSave,
    PeriodSheet,
    PunchBatch,
    PunchIn,
    ScanIn,
    ScanOut,
)
from app.schemas.common import Page
from app.services.accounts import get_account
from app.services.attendance_capture import (
    HHMM,
    daily_status_from_periods,
    duplicate_minutes,
    hash_key,
    late_after,
    new_card_uid,
    new_device_key,
    record_scan,
    school_now,
    weekday_name,
)
from app.services.leave import students_on_leave
from app.services.ratelimit import throttle
from app.services.settings import running_year, set_setting

router = APIRouter(tags=["attendance capture"])
staff = [Depends(require_roles("admin", "teacher"))]
admin_only = [Depends(require_roles("admin"))]
KIOSK_ROLES = ("admin", "teacher", "librarian", "accountant")


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


# --- per-period attendance ------------------------------------------------------------


def _clock(hour: int | None, minute: int | None) -> str:
    return f"{hour or 0:02d}:{minute or 0:02d}"


def _periods_out(db: Session, routines: list[ClassRoutine], d: date) -> list[PeriodOut]:
    classes = dict(db.execute(select(SchoolClass.class_id, SchoolClass.name)).all())
    sections = dict(db.execute(select(Section.section_id, Section.name)).all())
    subjects = dict(db.execute(select(Subject.subject_id, Subject.name)).all())
    ids = [r.class_routine_id for r in routines]
    marked = dict(
        db.execute(
            select(PeriodAttendance.class_routine_id, func.count())
            .where(PeriodAttendance.date == d, PeriodAttendance.class_routine_id.in_(ids))
            .group_by(PeriodAttendance.class_routine_id)
        ).all()
    ) if ids else {}  # fmt: skip
    return [
        PeriodOut(
            class_routine_id=r.class_routine_id, class_id=r.class_id, class_name=classes.get(r.class_id),
            section_id=r.section_id, section_name=sections.get(r.section_id), subject_id=r.subject_id,
            subject_name=subjects.get(r.subject_id), start=_clock(r.time_start, r.time_start_min),
            end=_clock(r.time_end, r.time_end_min), marked=marked.get(r.class_routine_id, 0),
        )  # fmt: skip
        for r in routines
    ]


def _teaches(db: Session, user: CurrentUser, subject_id: int | None) -> bool:
    if user.role == "admin":
        return True
    subject = db.get(Subject, subject_id) if subject_id else None
    return subject is not None and subject.teacher_id == user.id


def _teaches_class(db: Session, user: CurrentUser, class_id: int) -> bool:
    if user.role == "admin":
        return True
    return db.scalars(select(Subject.subject_id).where(Subject.class_id == class_id, Subject.teacher_id == user.id)).first() is not None


def _routine_for(db: Session, user: CurrentUser, routine_id: int, d: date) -> ClassRoutine:
    routine = get_or_404(db, ClassRoutine, routine_id, "Period")
    if not _teaches(db, user, routine.subject_id):
        raise forbid()
    if (routine.day or "").lower() != weekday_name(d):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"This period is on {routine.day}, not on that date")
    if d > school_now().date():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Attendance can't be taken for a future date")
    return routine


def _enrolled(db: Session, class_id: int | None, section_id: int | None) -> list[tuple[int, int | None, str | None]]:
    return list(
        db.execute(
            select(Enroll.student_id, Enroll.roll, Student.name)
            .join(Student, Student.student_id == Enroll.student_id)
            .where(Enroll.class_id == class_id, Enroll.section_id == section_id, Enroll.year == running_year(db))
            .order_by(Enroll.roll, Student.name)
        ).all()
    )


def _period_sheet(db: Session, routine: ClassRoutine, d: date) -> PeriodSheet:
    students = _enrolled(db, routine.class_id, routine.section_id)
    marked = {
        p.student_id: p.status
        for p in db.scalars(
            select(PeriodAttendance).where(PeriodAttendance.class_routine_id == routine.class_routine_id, PeriodAttendance.date == d)
        )
    }
    on_leave = students_on_leave(db, [sid for sid, _, _ in students], d)
    rows = [
        PeriodRow(
            student_id=sid, name=name, roll=roll, on_leave=sid in on_leave,
            status=marked.get(sid) or ("excused" if sid in on_leave else None),
        )  # fmt: skip
        for sid, roll, name in students
    ]
    return PeriodSheet(period=_periods_out(db, [routine], d)[0], date=d, rows=rows)


@router.get("/period-attendance/periods", response_model=list[PeriodOut])
def list_periods(
    db: DB,
    d: date = Query(alias="date"),
    class_id: int | None = None,
    section_id: int | None = None,
    user: CurrentUser = Depends(require_roles("admin", "teacher")),
):
    """Periods on `date`'s weekday in the running year's timetable; teachers get their own subjects."""
    stmt = select(ClassRoutine).where(ClassRoutine.year == running_year(db), ClassRoutine.day == weekday_name(d))
    if user.role == "teacher":
        stmt = stmt.where(ClassRoutine.subject_id.in_(select(Subject.subject_id).where(Subject.teacher_id == user.id)))
    if class_id:
        stmt = stmt.where(ClassRoutine.class_id == class_id)
    if section_id:
        stmt = stmt.where(ClassRoutine.section_id == section_id)
    routines = list(db.scalars(stmt.order_by(ClassRoutine.time_start, ClassRoutine.time_start_min, ClassRoutine.class_id)))
    return _periods_out(db, routines, d)


@router.get("/period-attendance/sheet", response_model=PeriodSheet)
def get_period_sheet(
    class_routine_id: int, db: DB, d: date = Query(alias="date"), user: CurrentUser = Depends(require_roles("admin", "teacher"))
):
    return _period_sheet(db, _routine_for(db, user, class_routine_id, d), d)


@router.put("/period-attendance/sheet", response_model=PeriodSheet)
def save_period_sheet(body: PeriodSave, db: DB, user: CurrentUser = Depends(require_roles("admin", "teacher"))):
    routine = _routine_for(db, user, body.class_routine_id, body.date)
    enrolled = {sid for sid, _, _ in _enrolled(db, routine.class_id, routine.section_id)}
    stray = [i.student_id for i in body.items if i.student_id not in enrolled]
    if stray:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Not enrolled in this section: {', '.join(map(str, stray))}")
    existing = {
        p.student_id: p
        for p in db.scalars(
            select(PeriodAttendance).where(
                PeriodAttendance.class_routine_id == routine.class_routine_id, PeriodAttendance.date == body.date
            )
        )
    }
    now = _now()
    for item in body.items:
        row = existing.get(item.student_id)
        if row is None:
            row = PeriodAttendance(
                date=body.date, class_id=routine.class_id, section_id=routine.section_id,
                class_routine_id=routine.class_routine_id, subject_id=routine.subject_id, student_id=item.student_id,
            )  # fmt: skip
            db.add(row)
        if row.status != item.status or row.marked_by is None:
            row.status, row.marked_by, row.marked_at = item.status, user.ref, now
    db.commit()
    return _period_sheet(db, routine, body.date)


@router.get("/period-attendance/day")
def day_grid(class_id: int, section_id: int, db: DB, d: date = Query(alias="date"), user: CurrentUser = Depends(require_roles("admin", "teacher"))):
    """Section × period grid for one day."""
    if not _teaches_class(db, user, class_id):
        raise forbid()
    routines = list(
        db.scalars(
            select(ClassRoutine)
            .where(
                ClassRoutine.year == running_year(db), ClassRoutine.day == weekday_name(d),
                ClassRoutine.class_id == class_id, ClassRoutine.section_id == section_id,
            )  # fmt: skip
            .order_by(ClassRoutine.time_start, ClassRoutine.time_start_min)
        )
    )
    marks: dict[int, dict[int, str]] = {}
    for p in db.scalars(
        select(PeriodAttendance).where(PeriodAttendance.class_id == class_id, PeriodAttendance.section_id == section_id, PeriodAttendance.date == d)
    ):
        marks.setdefault(p.student_id, {})[p.class_routine_id] = p.status
    return {
        "date": d,
        "periods": _periods_out(db, routines, d),
        "rows": [
            {"student_id": sid, "name": name, "roll": roll, "statuses": marks.get(sid, {})}
            for sid, roll, name in _enrolled(db, class_id, section_id)
        ],
    }


@router.get("/period-attendance/summary")
def period_summary(
    class_id: int,
    section_id: int,
    date_from: date,
    date_to: date,
    db: DB,
    user: CurrentUser = Depends(require_roles("admin", "teacher")),
):
    """Per student and subject: periods present (present or late) out of periods marked; excused periods don't count."""
    if not _teaches_class(db, user, class_id):
        raise forbid()
    if date_to < date_from or (date_to - date_from).days > 400:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a range of at most about a year")
    counts: dict[tuple[int, int], list[int]] = {}
    for sid, subject_id, st, n in db.execute(
        select(PeriodAttendance.student_id, PeriodAttendance.subject_id, PeriodAttendance.status, func.count())
        .where(
            PeriodAttendance.class_id == class_id, PeriodAttendance.section_id == section_id,
            PeriodAttendance.date >= date_from, PeriodAttendance.date <= date_to, PeriodAttendance.status != "excused",
        )  # fmt: skip
        .group_by(PeriodAttendance.student_id, PeriodAttendance.subject_id, PeriodAttendance.status)
    ):
        c = counts.setdefault((sid, subject_id), [0, 0])
        c[1] += n
        if st in ("present", "late"):
            c[0] += n
    subject_ids = sorted({s for _, s in counts})
    names = dict(db.execute(select(Subject.subject_id, Subject.name).where(Subject.subject_id.in_(subject_ids))).all()) if subject_ids else {}
    return {
        "subjects": [{"subject_id": s, "name": names.get(s)} for s in subject_ids],
        "rows": [
            {
                "student_id": sid, "name": name, "roll": roll,
                "subjects": {
                    s: {"present": c[0], "total": c[1], "percent": round(100 * c[0] / c[1], 1) if c[1] else None}
                    for s in subject_ids if (c := counts.get((sid, s)))
                },
            }  # fmt: skip
            for sid, roll, name in _enrolled(db, class_id, section_id)
        ],
    }


@router.post("/period-attendance/fill-daily")
def fill_daily(body: FillDaily, db: DB, user: CurrentUser = Depends(require_roles("admin", "teacher"))):
    """Fill the official DAILY attendance from the day's periods: present if present or late in at
    least one period, absent if absent in every marked period; students with no marked period (or
    only excused ones) are left alone. Days already marked are kept unless `overwrite`. No absence
    SMS is sent from here (it is sent only when the daily sheet itself is saved)."""
    if not _teaches_class(db, user, body.class_id):
        raise forbid()
    if body.date > school_now().date():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Attendance can't be taken for a future date")
    statuses: dict[int, list[str]] = {}
    for p in db.scalars(
        select(PeriodAttendance).where(
            PeriodAttendance.class_id == body.class_id, PeriodAttendance.section_id == body.section_id,
            PeriodAttendance.date == body.date,
        )  # fmt: skip
    ):
        statuses.setdefault(p.student_id, []).append(p.status)
    if not statuses:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No period attendance has been taken for that day")
    sheet = daily_sheet(db, body.class_id, body.section_id, body.date)  # creates the day's rows
    rows = {a.attendance_id: a for a in db.scalars(select(Attendance).where(Attendance.attendance_id.in_([r.attendance_id for r in sheet])))}
    updated = kept = skipped = 0
    for r in sheet:
        new = daily_status_from_periods(statuses.get(r.student_id, []))
        row = rows[r.attendance_id]
        if new is None:
            skipped += 1
        elif row.status and not body.overwrite:
            kept += 1
        elif row.status != new:
            row.status = new
            updated += 1
        else:
            kept += 1
    db.commit()
    return {"updated": updated, "kept": kept, "skipped": skipped}


# --- ID cards ------------------------------------------------------------------------------


def _card_out(db: Session, c: IdCard) -> dict:
    account = get_account(db, c.holder_role, c.holder_id)
    return {
        "card_id": c.card_id, "holder_role": c.holder_role, "holder_id": c.holder_id,
        "holder_name": account.name if account is not None else None,
        "card_uid": c.card_uid, "issued_on": c.issued_on, "active": c.active,
    }  # fmt: skip


def _issue(db: Session, role: str, holder_id: int, uid: str) -> IdCard:
    if db.scalars(select(IdCard.card_id).where(IdCard.card_uid == uid)).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Card {uid} is already registered")
    for old in db.scalars(select(IdCard).where(IdCard.holder_role == role, IdCard.holder_id == holder_id, IdCard.active.is_(True))):
        old.active = False
    card = IdCard(holder_role=role, holder_id=holder_id, card_uid=uid, issued_on=school_now().date(), active=True)
    db.add(card)
    return card


@router.get("/id-cards", response_model=Page, dependencies=admin_only)
def list_cards(
    db: DB,
    holder_role: HolderRole | None = None,
    holder_id: int | None = None,
    class_id: int | None = None,
    section_id: int | None = None,
    active: bool | None = True,
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
):
    stmt = select(IdCard)
    if holder_role:
        stmt = stmt.where(IdCard.holder_role == holder_role)
    if holder_id:
        stmt = stmt.where(IdCard.holder_id == holder_id)
    if class_id:
        enrolled = select(Enroll.student_id).where(Enroll.class_id == class_id, Enroll.year == running_year(db))
        if section_id:
            enrolled = enrolled.where(Enroll.section_id == section_id)
        stmt = stmt.where(IdCard.holder_role == "student", IdCard.holder_id.in_(enrolled))
    if active is not None:
        stmt = stmt.where(IdCard.active.is_(active))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(IdCard.card_id.desc()).limit(limit).offset(offset))
    return Page(items=[_card_out(db, c) for c in rows], total=total)


@router.post("/id-cards", status_code=201, dependencies=admin_only)
def issue_card(body: CardIn, db: DB):
    if get_account(db, body.holder_role, body.holder_id) is None:
        raise not_found("Card holder")
    uid = (body.card_uid or "").strip() or new_card_uid()
    card = _issue(db, body.holder_role, body.holder_id, uid)
    db.commit()
    return _card_out(db, card)


@router.post("/id-cards/bulk", dependencies=admin_only)
def bulk_cards(body: BulkCards, db: DB):
    """Barcode cards for every student of a class/section who has no active card. The student
    code is used as the card code when it is set and free (it is already printed on ID cards)."""
    stmt = select(Enroll.student_id, Student.student_code).join(Student, Student.student_id == Enroll.student_id).where(
        Enroll.class_id == body.class_id, Enroll.year == running_year(db)
    )
    if body.section_id:
        stmt = stmt.where(Enroll.section_id == body.section_id)
    have = set(db.scalars(select(IdCard.holder_id).where(IdCard.holder_role == "student", IdCard.active.is_(True))))
    taken = set(db.scalars(select(IdCard.card_uid)))
    created = 0
    for sid, code in db.execute(stmt):
        if sid in have:
            continue
        uid = code.strip() if code and code.strip() and code.strip() not in taken else new_card_uid()
        _issue(db, "student", sid, uid)
        taken.add(uid)
        created += 1
    db.commit()
    return {"created": created}


@router.post("/id-cards/{card_id}/revoke", dependencies=admin_only)
def revoke_card(card_id: int, db: DB):
    card = get_or_404(db, IdCard, card_id, "Card")
    card.active = False
    db.commit()
    return _card_out(db, card)


@router.delete("/id-cards/{card_id}", status_code=204, dependencies=admin_only)
def delete_card(card_id: int, db: DB):
    db.delete(get_or_404(db, IdCard, card_id, "Card"))
    db.commit()


# --- kiosk ---------------------------------------------------------------------------------


@router.post("/attendance-kiosk/scan", response_model=ScanOut)
def kiosk_scan(body: ScanIn, db: DB, user: CurrentUser = Depends(require_roles(*KIOSK_ROLES))):
    out = record_scan(db, body.card_uid, school_now(), body.source, recorded_by=user.ref)
    db.commit()
    return ScanOut(**out.__dict__)


@router.get("/attendance-capture/settings", response_model=CaptureSettings, dependencies=[Depends(require_roles(*KIOSK_ROLES))])
def get_capture_settings(db: DB):
    cutoff = late_after(db)
    return CaptureSettings(late_after=cutoff.strftime("%H:%M") if cutoff else None, duplicate_minutes=duplicate_minutes(db))


@router.put("/attendance-capture/settings", response_model=CaptureSettings, dependencies=admin_only)
def update_capture_settings(body: CaptureSettings, db: DB):
    value = (body.late_after or "").strip()
    if value and not HHMM.match(value):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "late_after must look like 08:15")
    set_setting(db, "attendance_late_after", value)
    set_setting(db, "attendance_duplicate_minutes", str(body.duplicate_minutes))
    db.commit()
    return get_capture_settings(db)


@router.get("/attendance-punches", response_model=Page, dependencies=[Depends(require_roles(*KIOSK_ROLES))])
def list_punches(
    db: DB,
    d: date | None = Query(None, alias="date"),
    result: str | None = None,
    device_id: int | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Scan log, newest first (school-local times)."""
    stmt = select(AttendancePunch)
    if d:
        start = datetime.combine(d, datetime.min.time())
        stmt = stmt.where(AttendancePunch.punched_at >= start, AttendancePunch.punched_at < start + timedelta(days=1))
    if result:
        stmt = stmt.where(AttendancePunch.result == result)
    if device_id:
        stmt = stmt.where(AttendancePunch.device_id == device_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(db.scalars(stmt.order_by(AttendancePunch.punch_id.desc()).limit(limit).offset(offset)))
    names: dict[tuple[str, int], str | None] = {}
    for p in rows:
        if p.holder_role and p.holder_id and (p.holder_role, p.holder_id) not in names:
            account = get_account(db, p.holder_role, p.holder_id)
            names[(p.holder_role, p.holder_id)] = account.name if account is not None else None
    items = [
        {
            "punch_id": p.punch_id, "card_uid": p.card_uid, "holder_role": p.holder_role, "holder_id": p.holder_id,
            "name": names.get((p.holder_role, p.holder_id)) if p.holder_role and p.holder_id else None,
            "punched_at": p.punched_at, "source": p.source, "result": p.result, "device_id": p.device_id,
        }  # fmt: skip
        for p in rows
    ]
    return Page(items=items, total=total)


# --- devices -------------------------------------------------------------------------------


def _device_out(d: AttendanceDevice, key: str | None = None) -> dict:
    out = {
        "device_id": d.device_id, "name": d.name, "location": d.location, "active": d.active,
        "last_seen_at": d.last_seen_at,
    }  # fmt: skip
    if key:
        out["api_key"] = key  # shown once
    return out


@router.get("/attendance-devices", dependencies=admin_only)
def list_devices(db: DB):
    return [_device_out(d) for d in db.scalars(select(AttendanceDevice).order_by(AttendanceDevice.name))]


@router.post("/attendance-devices", status_code=201, dependencies=admin_only)
def create_device(body: DeviceIn, db: DB):
    key = new_device_key()
    device = AttendanceDevice(name=body.name.strip(), location=body.location, active=body.active, api_key_hash=hash_key(key))
    db.add(device)
    db.commit()
    return _device_out(device, key)


@router.put("/attendance-devices/{device_id}", dependencies=admin_only)
def update_device(device_id: int, body: DeviceIn, db: DB):
    device = get_or_404(db, AttendanceDevice, device_id, "Device")
    device.name, device.location, device.active = body.name.strip(), body.location, body.active
    db.commit()
    return _device_out(device)


@router.post("/attendance-devices/{device_id}/rotate-key", dependencies=admin_only)
def rotate_device_key(device_id: int, db: DB):
    device = get_or_404(db, AttendanceDevice, device_id, "Device")
    key = new_device_key()
    device.api_key_hash = hash_key(key)
    db.commit()
    return _device_out(device, key)


@router.delete("/attendance-devices/{device_id}", status_code=204, dependencies=admin_only)
def delete_device(device_id: int, db: DB):
    db.delete(get_or_404(db, AttendanceDevice, device_id, "Device"))
    db.commit()


def current_device(db: DB, x_device_key: str | None = Header(default=None)) -> AttendanceDevice:
    """Devices authenticate with their own key (X-Device-Key), not a user token."""
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid device key")
    if not x_device_key:
        raise unauthorized
    digest = hash_key(x_device_key)
    device = db.scalars(select(AttendanceDevice).where(AttendanceDevice.api_key_hash == digest)).first()
    if device is None or not hmac.compare_digest(device.api_key_hash, digest) or not device.active:
        raise unauthorized
    return device


@router.post("/attendance-devices/punch")
def device_punch(body: PunchBatch | PunchIn, db: DB, device: AttendanceDevice = Depends(current_device)):
    """Punches from a terminal: one {card_uid, timestamp} or {punches: [...]} (offline backlog),
    applied oldest first. Results come back in that order."""
    throttle(f"device:{device.device_id}", 120, 60, "Too many requests from this device")
    tz = ZoneInfo(get_settings().school_timezone)
    now = school_now()
    timed = []
    for p in body.punches if isinstance(body, PunchBatch) else [body]:
        when = p.timestamp or now
        if when.tzinfo is not None:
            when = when.astimezone(tz).replace(tzinfo=None)
        timed.append((when.replace(microsecond=0), p.card_uid))
    results = []
    for when, card_uid in sorted(timed):
        out = record_scan(db, card_uid, when, "device", device_id=device.device_id)
        results.append({"card_uid": out.card_uid, "punched_at": when, "result": out.result, "name": out.name})
    device.last_seen_at = _now()
    db.commit()
    return {"results": results}
