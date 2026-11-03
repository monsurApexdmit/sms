"""Staff attendance and payroll calculations.

Payslip rule (per staff member, per month):
- working days = days of the month that are not a weekly day off or a holiday
  (app/services/school_calendar.py);
- unpaid days = working days marked "absent" + half of those marked "half_day".
  "present", "late" and "leave" (approved leave) are paid; working days with no
  attendance recorded are paid too, so a month without staff attendance pays in full;
- absence deduction = basic / working days × unpaid days, only when the setting
  `payroll_deduct_absence` is "1";
- gross = basic + allowances; net = gross − deductions − absence deduction (never below 0).
"""

import calendar
import json
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import SalaryStructure, StaffAttendance
from app.services.accounts import ROLE_MODELS
from app.services.school_calendar import holidays_between, weekly_off_days
from app.services.settings import get_setting

STAFF_ROLES = ("teacher", "librarian", "accountant")
STATUSES = ("present", "absent", "late", "half_day", "leave")
CENT = Decimal("0.01")


def money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(CENT, rounding=ROUND_HALF_UP)


def parse_items(raw: str | None) -> list[dict]:
    """allowances / deductions JSON column -> [{"name", "amount"}]."""
    try:
        items = json.loads(raw or "[]")
    except ValueError:
        return []
    return [{"name": str(i.get("name", "")), "amount": float(i.get("amount") or 0)} for i in items if isinstance(i, dict)]


def dump_items(items: list[dict]) -> str:
    return json.dumps([{"name": i["name"], "amount": float(money(i["amount"]))} for i in items])


def month_bounds(month: str) -> tuple[date, date]:
    y, m = (int(p) for p in month.split("-"))
    return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])


def school_days(db: Session, first: date, last: date) -> list[date]:
    off, holidays = weekly_off_days(db), holidays_between(db, first, last)
    days, day = [], first
    while day <= last:
        if day.weekday() not in off and day not in holidays:
            days.append(day)
        day += timedelta(days=1)
    return days


def all_staff(db: Session) -> list[tuple[str, int, str]]:
    """(role, id, name) of every teacher, librarian and accountant, by role then name."""
    out = []
    for role in STAFF_ROLES:
        model = ROLE_MODELS[role]
        pk = getattr(model, f"{role}_id")
        out.extend((role, i, name or "") for i, name in db.execute(select(pk, model.name).order_by(model.name, pk)))
    return out


def staff_name(db: Session, role: str, staff_id: int) -> str | None:
    if role not in STAFF_ROLES:
        return None
    row = db.get(ROLE_MODELS[role], staff_id)
    return (row.name or "") if row is not None else None


def deduct_absence(db: Session) -> bool:
    return get_setting(db, "payroll_deduct_absence", "0") == "1"


def structure_for(db: Session, role: str, staff_id: int, last_day: date) -> SalaryStructure | None:
    return db.scalars(
        select(SalaryStructure)
        .where(SalaryStructure.staff_role == role, SalaryStructure.staff_id == staff_id, SalaryStructure.effective_from <= last_day)
        .order_by(SalaryStructure.effective_from.desc(), SalaryStructure.salary_structure_id.desc())
    ).first()


@dataclass
class Pay:
    basic: Decimal
    allowances: list[dict]
    deductions: list[dict]
    absence_deduction: Decimal
    gross: Decimal
    net: Decimal
    working_days: int
    present_days: Decimal
    absent_days: Decimal
    leave_days: int


def compute_pay(db: Session, structure: SalaryStructure, month: str, deduct: bool) -> Pay:
    first, last = month_bounds(month)
    days = set(school_days(db, first, last))
    statuses = [
        a.status
        for a in db.scalars(
            select(StaffAttendance).where(
                StaffAttendance.staff_role == structure.staff_role, StaffAttendance.staff_id == structure.staff_id,
                StaffAttendance.date >= first, StaffAttendance.date <= last,
            )  # fmt: skip
        )
        if a.date in days
    ]
    absent = Decimal(statuses.count("absent")) + Decimal(statuses.count("half_day")) / 2
    working = len(days)
    basic = money(structure.basic)
    allowances, deductions = parse_items(structure.allowances), parse_items(structure.deductions)
    absence = money(basic / working * absent) if deduct and working else Decimal("0.00")
    gross = basic + sum((money(i["amount"]) for i in allowances), Decimal(0))
    net = max(gross - sum((money(i["amount"]) for i in deductions), Decimal(0)) - absence, Decimal(0))
    return Pay(
        basic=basic, allowances=allowances, deductions=deductions, absence_deduction=absence, gross=money(gross),
        net=money(net), working_days=working, present_days=Decimal(working) - absent, absent_days=absent,
        leave_days=statuses.count("leave"),
    )  # fmt: skip


def record_staff_leave(db: Session, role: str, staff_id: int, start: date, end: date, recorded_by: str | None = None) -> int:
    """Mark approved leave on the staff attendance of every school day in [start, end].
    Days already marked present/late are kept (the person came in). Returns the number of
    days marked. Call when a staff leave request is approved; the caller commits."""
    marked = 0
    existing = {
        a.date: a
        for a in db.scalars(
            select(StaffAttendance).where(
                StaffAttendance.staff_role == role, StaffAttendance.staff_id == staff_id,
                StaffAttendance.date >= start, StaffAttendance.date <= end,
            )  # fmt: skip
        )
    }
    for day in school_days(db, start, end):
        row = existing.get(day)
        if row is None:
            db.add(StaffAttendance(staff_role=role, staff_id=staff_id, date=day, status="leave", recorded_by=recorded_by))
        elif row.status in ("present", "late"):
            continue
        else:
            row.status, row.recorded_by = "leave", recorded_by
        marked += 1
    return marked


def clear_staff_leave(db: Session, role: str, staff_id: int, start: date, end: date) -> None:
    """Undo record_staff_leave (leave cancelled after approval): removes the "leave" marks in [start, end]."""
    db.execute(
        delete(StaffAttendance).where(
            StaffAttendance.staff_role == role, StaffAttendance.staff_id == staff_id, StaffAttendance.status == "leave",
            StaffAttendance.date >= start, StaffAttendance.date <= end,
        )  # fmt: skip
    )
