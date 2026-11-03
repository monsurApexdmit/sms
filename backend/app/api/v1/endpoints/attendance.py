"""Attendance. The legacy table stores one row per student per day with
`timestamp` = unix time of that day's midnight (as text) and status
0/NULL = not taken, 1 = present, 2 = absent."""

import calendar
from datetime import date, datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import DB, Me, require_roles
from app.models import Attendance, Enroll, Student
from app.schemas.attendance import SheetRow, SheetSave
from app.services.access import ensure_can_view_student
from app.services.leave import students_on_leave
from app.services.notifications import notify, user
from app.services.school_calendar import holidays_between, weekly_off_days, working_days
from app.services.settings import running_year

router = APIRouter(prefix="/attendance", tags=["attendance"])
staff = [Depends(require_roles("admin", "teacher"))]


def day_ts(d: date) -> str:
    return str(calendar.timegm(d.timetuple()))


def _month_range(month: str) -> tuple[int, int, int]:
    try:
        y, m = (int(p) for p in month.split("-"))
        days = calendar.monthrange(y, m)[1]
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "month must be YYYY-MM") from None
    start = calendar.timegm(date(y, m, 1).timetuple())
    return start, start + days * 86400, days


def _month_calendar(db: Session, start: int, days: int) -> dict:
    """Day numbers of the month that are holidays (with titles) or weekly days off, and the working-day count."""
    first = datetime.fromtimestamp(start, timezone.utc).date()
    last = date(first.year, first.month, days)
    off = weekly_off_days(db)
    return {
        "holidays": {d.day: title for d, title in holidays_between(db, first, last).items()},
        "off_days": [n for n in range(1, days + 1) if date(first.year, first.month, n).weekday() in off],
        "working_days": working_days(db, first, last),
    }


def _sheet(db: Session, class_id: int, section_id: int, d: date) -> list[SheetRow]:
    year, ts = running_year(db), day_ts(d)
    enrolled = db.execute(
        select(Enroll.student_id, Enroll.roll, Student.name)
        .join(Student, Student.student_id == Enroll.student_id)
        .where(Enroll.class_id == class_id, Enroll.section_id == section_id, Enroll.year == year)
        .order_by(Enroll.roll, Student.name)
    ).all()
    rows = {
        a.student_id: a
        for a in db.scalars(
            select(Attendance).where(
                Attendance.class_id == class_id, Attendance.section_id == section_id,
                Attendance.year == year, Attendance.timestamp == ts,
            )  # fmt: skip
        )
    }
    for sid, _, _ in enrolled:
        if sid not in rows:
            row = Attendance(class_id=class_id, section_id=section_id, year=year, timestamp=ts, student_id=sid, status=0)
            db.add(row)
            rows[sid] = row
    db.commit()
    on_leave = students_on_leave(db, rows, d)
    return [
        SheetRow(
            attendance_id=rows[sid].attendance_id, student_id=sid, name=name, roll=roll, status=rows[sid].status,
            on_leave=sid in on_leave,
        )  # fmt: skip
        for sid, roll, name in enrolled
    ]


@router.get("/sheet", response_model=list[SheetRow], dependencies=staff)
def get_sheet(class_id: int, section_id: int, date: date, db: DB):
    return _sheet(db, class_id, section_id, date)


@router.put("/sheet", response_model=list[SheetRow], dependencies=staff)
def save_sheet(body: SheetSave, tasks: BackgroundTasks, db: DB):
    ts = day_ts(body.date)
    rows = {
        a.attendance_id: a
        for a in db.scalars(
            select(Attendance).where(
                Attendance.attendance_id.in_([i.attendance_id for i in body.items]),
                Attendance.class_id == body.class_id,
                Attendance.section_id == body.section_id,
                Attendance.timestamp == ts,
            )
        )
    }
    newly_absent = []
    for item in body.items:
        row = rows.get(item.attendance_id)
        if row is None:
            continue
        if item.status == 2 and row.status != 2:
            newly_absent.append(row.student_id)
        row.status = item.status
    db.commit()

    # parents already know about approved leave
    newly_absent = [sid for sid in newly_absent if sid not in students_on_leave(db, newly_absent, body.date)]
    if newly_absent:
        for student in db.scalars(select(Student).where(Student.student_id.in_(newly_absent), Student.parent_id.is_not(None))):
            text = f"Your child {student.name} is absent today ({body.date.isoformat()})."
            notify(
                db, tasks, [user("parent", student.parent_id)], "attendance", f"{student.name} is absent", text,
                "/app/attendance-report", sms_text=text, commit=False,
            )  # fmt: skip
        db.commit()
    return _sheet(db, body.class_id, body.section_id, body.date)


@router.get("/report", dependencies=staff)
def class_report(class_id: int, section_id: int, month: str, db: DB):
    start, end, days = _month_range(month)
    year = running_year(db)
    students = db.execute(
        select(Enroll.student_id, Enroll.roll, Student.name)
        .join(Student, Student.student_id == Enroll.student_id)
        .where(Enroll.class_id == class_id, Enroll.section_id == section_id, Enroll.year == year)
        .order_by(Enroll.roll, Student.name)
    ).all()
    grid: dict[int, dict[int, int]] = {sid: {} for sid, _, _ in students}
    for a in db.scalars(
        select(Attendance).where(Attendance.class_id == class_id, Attendance.section_id == section_id)
    ):
        ts = int(a.timestamp) if a.timestamp and a.timestamp.isdigit() else -1
        if start <= ts < end and a.student_id in grid:
            grid[a.student_id][(ts - start) // 86400 + 1] = a.status or 0
    return {
        "days": days,
        **_month_calendar(db, start, days),
        "rows": [
            {
                "student_id": sid,
                "name": name,
                "roll": roll,
                "days": grid[sid],
                "present": sum(1 for v in grid[sid].values() if v == 1),
                "absent": sum(1 for v in grid[sid].values() if v == 2),
            }
            for sid, roll, name in students
        ],
    }


@router.get("/student/{student_id}")
def student_report(student_id: int, month: str, user: Me, db: DB):
    ensure_can_view_student(db, user, student_id)
    start, end, days = _month_range(month)
    out: dict[int, int] = {}
    for a in db.scalars(select(Attendance).where(Attendance.student_id == student_id)):
        ts = int(a.timestamp) if a.timestamp and a.timestamp.isdigit() else -1
        if start <= ts < end:
            out[(ts - start) // 86400 + 1] = a.status or 0
    return {
        "days": days,
        **_month_calendar(db, start, days),
        "records": out,
        "present": sum(1 for v in out.values() if v == 1),
        "absent": sum(1 for v in out.values() if v == 2),
    }
