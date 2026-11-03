"""Check-in by card: the kiosk (barcode / QR / RFID reader or camera) and devices that push
punches. Each scan is logged in `attendance_punch` and marks attendance:

- students: the legacy DAILY attendance row for that day is set to present (1). The legacy
  table has no "late" status, so lateness is kept on the punch only (result = marked_late).
- staff: `staff_attendance` gets present or late with the check-in time; a later scan the
  same day (outside the duplicate window) records the check-out time.

Settings: `attendance_late_after` ("HH:MM", school-local; empty = never late) and
`attendance_duplicate_minutes` (scans of the same card within this many minutes are ignored).
"""

import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.routers.attendance import day_ts
from app.core.config import get_settings
from app.models import Attendance, AttendancePunch, IdCard, StaffAttendance
from app.services.access import current_enroll
from app.services.accounts import get_account
from app.services.files import user_image_url
from app.services.settings import get_setting, running_year

HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
DEFAULT_DUPLICATE_MINUTES = 10
MARKED = ("marked_present", "marked_late", "checked_out")


def school_now() -> datetime:
    """Current school-local time, naive (as stored)."""
    return datetime.now(ZoneInfo(get_settings().school_timezone)).replace(tzinfo=None, microsecond=0)


def late_after(db: Session) -> time | None:
    raw = get_setting(db, "attendance_late_after")
    return time(int(raw[:2]), int(raw[3:])) if HHMM.match(raw) else None


def duplicate_minutes(db: Session) -> int:
    raw = get_setting(db, "attendance_duplicate_minutes")
    return int(raw) if raw.isdigit() else DEFAULT_DUPLICATE_MINUTES


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def new_device_key() -> str:
    return "dev_" + secrets.token_urlsafe(32)


def new_card_uid() -> str:
    """Printable code for a barcode card (Code 128 friendly)."""
    return "C" + secrets.token_hex(5).upper()


def active_card(db: Session, card_uid: str) -> IdCard | None:
    return db.scalars(select(IdCard).where(IdCard.card_uid == card_uid, IdCard.active.is_(True))).first()


@dataclass
class ScanResult:
    result: str
    card_uid: str
    holder_role: str | None = None
    holder_id: int | None = None
    name: str | None = None
    image_url: str | None = None
    punched_at: datetime | None = None
    message: str = ""


MESSAGES = {
    "marked_present": "Checked in",
    "marked_late": "Checked in late",
    "checked_out": "Checked out",
    "already_marked": "Already checked in today",
    "duplicate": "Already scanned a moment ago",
    "unknown_card": "Card not recognised",
    "not_enrolled": "Not enrolled in the current year",
    "invalid_time": "Scan time is in the future",
}


def _mark_student(db: Session, student_id: int, when: datetime) -> str:
    enroll = current_enroll(db, student_id, running_year(db))
    if enroll is None:
        return "not_enrolled"
    ts = day_ts(when.date())
    row = db.scalars(
        select(Attendance).where(
            Attendance.student_id == student_id, Attendance.class_id == enroll.class_id,
            Attendance.section_id == enroll.section_id, Attendance.year == enroll.year, Attendance.timestamp == ts,
        )  # fmt: skip
    ).first()
    if row is None:
        row = Attendance(
            student_id=student_id, class_id=enroll.class_id, section_id=enroll.section_id, year=enroll.year, timestamp=ts
        )
        db.add(row)
    elif row.status == 1:
        return "already_marked"
    row.status = 1
    cutoff = late_after(db)
    return "marked_late" if cutoff and when.time() > cutoff else "marked_present"


def _mark_staff(db: Session, role: str, staff_id: int, when: datetime, recorded_by: str | None) -> str:
    clock = when.strftime("%H:%M")
    cutoff = late_after(db)
    late = bool(cutoff and when.time() > cutoff)
    row = db.scalars(
        select(StaffAttendance).where(
            StaffAttendance.staff_role == role, StaffAttendance.staff_id == staff_id, StaffAttendance.date == when.date()
        )
    ).first()
    if row is None:
        db.add(
            StaffAttendance(
                staff_role=role, staff_id=staff_id, date=when.date(), status="late" if late else "present",
                check_in=clock, recorded_by=recorded_by,
            )  # fmt: skip
        )
        return "marked_late" if late else "marked_present"
    if row.status in ("present", "late", "half_day") and row.check_in:
        if clock > row.check_in:
            row.check_out = clock
            return "checked_out"
        return "already_marked"
    # absent, leave or marked without a time: the person came in
    row.status, row.check_in, row.recorded_by = ("late" if late else "present"), clock, recorded_by
    return "marked_late" if late else "marked_present"


def record_scan(
    db: Session, card_uid: str, when: datetime, source: str, *, device_id: int | None = None, recorded_by: str | None = None
) -> ScanResult:
    """Apply one scan and log it. The caller commits."""
    card_uid = card_uid.strip()
    card = active_card(db, card_uid)
    out = ScanResult(result="unknown_card", card_uid=card_uid, punched_at=when)
    if card is not None:
        out.holder_role, out.holder_id = card.holder_role, card.holder_id
        account = get_account(db, card.holder_role, card.holder_id)
        out.name = account.name if account is not None else None
        out.image_url = user_image_url(card.holder_role, card.holder_id)
        if when > school_now() + timedelta(minutes=5):
            out.result = "invalid_time"
        elif _recent_scan(db, card.holder_role, card.holder_id, when):
            out.result = "duplicate"
        elif card.holder_role == "student":
            out.result = _mark_student(db, card.holder_id, when)
        else:
            out.result = _mark_staff(db, card.holder_role, card.holder_id, when, recorded_by)
    out.message = MESSAGES[out.result]
    db.add(
        AttendancePunch(
            device_id=device_id, card_uid=card_uid[:100], holder_role=out.holder_role, holder_id=out.holder_id,
            punched_at=when, source=source, result=out.result, recorded_by=recorded_by,
        )  # fmt: skip
    )
    db.flush()
    return out


def _recent_scan(db: Session, role: str, holder_id: int, when: datetime) -> bool:
    window = timedelta(minutes=duplicate_minutes(db))
    return (
        db.scalars(
            select(AttendancePunch.punch_id).where(
                AttendancePunch.holder_role == role, AttendancePunch.holder_id == holder_id,
                AttendancePunch.result.in_(MARKED),
                AttendancePunch.punched_at > when - window, AttendancePunch.punched_at <= when,
            )  # fmt: skip
        ).first()
        is not None
    )


def daily_status_from_periods(statuses: list[str]) -> int | None:
    """Rule for filling DAILY attendance from periods: present (1) when the student was present
    or late in at least one marked period, absent (2) when every marked period says absent,
    otherwise (only excused periods) no change (None)."""
    if any(s in ("present", "late") for s in statuses):
        return 1
    if statuses and all(s == "absent" for s in statuses):
        return 2
    return None


def weekday_name(d: date) -> str:
    """Day name as stored in the legacy class_routine.day column ("monday" ...)."""
    return ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")[d.weekday()]
