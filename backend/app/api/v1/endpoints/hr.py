"""Staff HR: staff attendance, salary structures, payroll runs and payslips.
The pay rules are documented in app/services/payroll.py."""

import calendar
import datetime as dt
import time
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.crud import get_or_404
from app.api.v1.endpoints.finance import _fmt
from app.api.deps import DB, CurrentUser, Me, forbid, require_roles
from app.models import ExpenseCategory, Payment, PayrollRun, Payslip, SalaryStructure, StaffAttendance
from app.services.payroll import (
    STAFF_ROLES,
    STATUSES,
    all_staff,
    compute_pay,
    deduct_absence,
    dump_items,
    month_bounds,
    parse_items,
    staff_name,
    structure_for,
)
from app.services.school_calendar import day_info, holidays_between, weekly_off_days, working_days
from app.services.settings import get_setting, running_year, set_setting

router = APIRouter(prefix="/hr", tags=["hr"])
admin_only = [Depends(require_roles("admin"))]
PAYROLL = ("admin", "accountant")
payroll_roles = [Depends(require_roles(*PAYROLL))]
staff_only = [Depends(require_roles(*STAFF_ROLES))]

StaffRole = Literal["teacher", "librarian", "accountant"]
Status = Literal["present", "absent", "late", "half_day", "leave"]
TIME = r"^([01]\d|2[0-3]):[0-5]\d$"
MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _require_staff(db: Session, role: str, staff_id: int) -> str:
    name = staff_name(db, role, staff_id)
    if name is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Staff member not found")
    return name


@router.get("/staff", dependencies=payroll_roles)
def list_staff(db: DB):
    return [{"staff_role": r, "staff_id": i, "name": n} for r, i, n in all_staff(db)]


# --- staff attendance -------------------------------------------------------------


class SheetItem(BaseModel):
    staff_role: StaffRole
    staff_id: int
    status: Status | None = None  # None removes the day's record
    check_in: str | None = Field(default=None, pattern=TIME)
    check_out: str | None = Field(default=None, pattern=TIME)
    note: str | None = Field(default=None, max_length=500)


class SheetSave(BaseModel):
    date: dt.date
    items: list[SheetItem]


def _sheet(db: Session, d: date) -> dict:
    rows = {(a.staff_role, a.staff_id): a for a in db.scalars(select(StaffAttendance).where(StaffAttendance.date == d))}
    out = []
    for role, sid, name in all_staff(db):
        a = rows.get((role, sid))
        out.append({
            "staff_role": role, "staff_id": sid, "name": name, "status": a.status if a else None,
            "check_in": a.check_in if a else None, "check_out": a.check_out if a else None, "note": a.note if a else None,
        })  # fmt: skip
    return {"day": day_info(db, d), "rows": out}


@router.get("/attendance/sheet", dependencies=admin_only)
def get_sheet(d: date = Query(alias="date"), *, db: DB):
    return _sheet(db, d)


@router.put("/attendance/sheet")
def save_sheet(body: SheetSave, db: DB, user: CurrentUser = Depends(require_roles("admin"))):
    if body.date > date.today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Attendance can't be taken for a future date")
    known = {(r, i) for r, i, _ in all_staff(db)}
    rows = {(a.staff_role, a.staff_id): a for a in db.scalars(select(StaffAttendance).where(StaffAttendance.date == body.date))}
    for item in body.items:
        key = (item.staff_role, item.staff_id)
        if key not in known:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown staff member {item.staff_role}-{item.staff_id}")
        row = rows.get(key)
        if item.status is None:
            if row is not None:
                db.delete(row)
            continue
        if row is None:
            row = StaffAttendance(staff_role=item.staff_role, staff_id=item.staff_id, date=body.date)
            db.add(row)
            rows[key] = row
        row.status, row.check_in, row.check_out = item.status, item.check_in, item.check_out
        row.note, row.recorded_by = item.note, user.ref
    db.commit()
    return _sheet(db, body.date)


def _month_report(db: Session, month: str, only: tuple[str, int] | None = None) -> dict:
    first, last = month_bounds(month)
    stmt = select(StaffAttendance).where(StaffAttendance.date >= first, StaffAttendance.date <= last)
    if only:
        stmt = stmt.where(StaffAttendance.staff_role == only[0], StaffAttendance.staff_id == only[1])
    grid: dict[tuple[str, int], dict[int, str]] = {}
    for a in db.scalars(stmt):
        grid.setdefault((a.staff_role, a.staff_id), {})[a.date.day] = a.status
    staff = [s for s in all_staff(db) if only is None or (s[0], s[1]) == only]
    off = weekly_off_days(db)
    return {
        "days": last.day,
        "holidays": {d.day: title for d, title in holidays_between(db, first, last).items()},
        "off_days": [n for n in range(1, last.day + 1) if date(first.year, first.month, n).weekday() in off],
        "working_days": working_days(db, first, last),
        "rows": [
            {
                "staff_role": role, "staff_id": sid, "name": name, "days": grid.get((role, sid), {}),
                **{s: sum(1 for v in grid.get((role, sid), {}).values() if v == s) for s in STATUSES},
            }  # fmt: skip
            for role, sid, name in staff
        ],
    }


@router.get("/attendance/report", dependencies=admin_only)
def attendance_report(db: DB, month: str = Query(pattern=MONTH)):
    return _month_report(db, month)


@router.get("/attendance/mine", dependencies=staff_only)
def my_attendance(user: Me, db: DB, month: str = Query(pattern=MONTH)):
    return _month_report(db, month, only=(user.role, user.id))


# --- settings ---------------------------------------------------------------------


class PayrollSettings(BaseModel):
    deduct_absence: bool


@router.get("/settings", response_model=PayrollSettings, dependencies=payroll_roles)
def get_payroll_settings(db: DB):
    return PayrollSettings(deduct_absence=deduct_absence(db))


@router.put("/settings", response_model=PayrollSettings, dependencies=admin_only)
def update_payroll_settings(body: PayrollSettings, db: DB):
    set_setting(db, "payroll_deduct_absence", "1" if body.deduct_absence else "0")
    db.commit()
    return body


# --- salary structures --------------------------------------------------------------


class PayItem(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    amount: float = Field(ge=0, le=10_000_000)


class StructureIn(BaseModel):
    staff_role: StaffRole
    staff_id: int
    basic: float = Field(ge=0, le=10_000_000)
    allowances: list[PayItem] = Field(default_factory=list, max_length=30)
    deductions: list[PayItem] = Field(default_factory=list, max_length=30)
    effective_from: date


def _structure_out(r: SalaryStructure, names: dict[tuple[str, int], str]) -> dict:
    return {
        "salary_structure_id": r.salary_structure_id, "staff_role": r.staff_role, "staff_id": r.staff_id,
        "name": names.get((r.staff_role, r.staff_id)), "basic": float(r.basic), "allowances": parse_items(r.allowances),
        "deductions": parse_items(r.deductions), "effective_from": r.effective_from,
    }  # fmt: skip


def _apply_structure(row: SalaryStructure, body: StructureIn) -> None:
    row.staff_role, row.staff_id, row.basic, row.effective_from = body.staff_role, body.staff_id, body.basic, body.effective_from
    row.allowances = dump_items([i.model_dump() for i in body.allowances])
    row.deductions = dump_items([i.model_dump() for i in body.deductions])


@router.get("/salary-structures", dependencies=payroll_roles)
def list_structures(db: DB, staff_role: StaffRole | None = None, staff_id: int | None = None):
    names = {(r, i): n for r, i, n in all_staff(db)}
    stmt = select(SalaryStructure)
    if staff_role:
        stmt = stmt.where(SalaryStructure.staff_role == staff_role)
    if staff_id:
        stmt = stmt.where(SalaryStructure.staff_id == staff_id)
    rows = db.scalars(stmt.order_by(SalaryStructure.staff_role, SalaryStructure.staff_id, SalaryStructure.effective_from.desc()))
    return [_structure_out(r, names) for r in rows]


@router.post("/salary-structures", status_code=201, dependencies=admin_only)
def create_structure(body: StructureIn, db: DB):
    name = _require_staff(db, body.staff_role, body.staff_id)
    row = SalaryStructure()
    _apply_structure(row, body)
    db.add(row)
    db.commit()
    return _structure_out(row, {(body.staff_role, body.staff_id): name})


@router.put("/salary-structures/{structure_id}", dependencies=admin_only)
def update_structure(structure_id: int, body: StructureIn, db: DB):
    row = get_or_404(db, SalaryStructure, structure_id, "Salary structure")
    name = _require_staff(db, body.staff_role, body.staff_id)
    _apply_structure(row, body)
    db.commit()
    return _structure_out(row, {(body.staff_role, body.staff_id): name})


@router.delete("/salary-structures/{structure_id}", status_code=204, dependencies=admin_only)
def delete_structure(structure_id: int, db: DB):
    db.delete(get_or_404(db, SalaryStructure, structure_id, "Salary structure"))
    db.commit()


# --- payroll --------------------------------------------------------------------------


class RunIn(BaseModel):
    month: str = Field(pattern=MONTH)


class PayIn(BaseModel):
    method: str = Field(default="bank", max_length=50)
    date: dt.date | None = None


def _payslip_out(p: Payslip, run: PayrollRun) -> dict:
    return {
        "payslip_id": p.payslip_id, "payroll_run_id": p.payroll_run_id, "month": run.month, "run_status": run.status,
        "staff_role": p.staff_role, "staff_id": p.staff_id, "name": p.staff_name, "basic": float(p.basic),
        "allowances": parse_items(p.allowances), "deductions": parse_items(p.deductions),
        "absence_deduction": float(p.absence_deduction), "gross": float(p.gross), "net": float(p.net),
        "working_days": p.working_days, "present_days": float(p.present_days), "absent_days": float(p.absent_days),
        "leave_days": p.leave_days, "paid_on": p.paid_on, "payment_id": p.payment_id,
    }  # fmt: skip


def _run_out(db: Session, run: PayrollRun, with_payslips: bool = False) -> dict:
    slips = list(db.scalars(select(Payslip).where(Payslip.payroll_run_id == run.payroll_run_id).order_by(Payslip.staff_role, Payslip.staff_name)))
    out = {
        "payroll_run_id": run.payroll_run_id, "month": run.month, "status": run.status, "created_by": run.created_by,
        "created_at": run.created_at, "finalized_at": run.finalized_at, "paid_at": run.paid_at, "staff": len(slips),
        "gross": round(sum(float(p.gross) for p in slips), 2), "net": round(sum(float(p.net) for p in slips), 2),
    }  # fmt: skip
    if with_payslips:
        out["payslips"] = [_payslip_out(p, run) for p in slips]
    return out


def _calculate(db: Session, run: PayrollRun) -> None:
    """(Re)build the payslips of a draft run from the salary structures and staff attendance."""
    db.execute(delete(Payslip).where(Payslip.payroll_run_id == run.payroll_run_id))
    _, last = month_bounds(run.month)
    deduct = deduct_absence(db)
    for role, sid, name in all_staff(db):
        structure = structure_for(db, role, sid, last)
        if structure is None:
            continue
        pay = compute_pay(db, structure, run.month, deduct)
        db.add(Payslip(
            payroll_run_id=run.payroll_run_id, staff_role=role, staff_id=sid, staff_name=name, basic=pay.basic,
            allowances=dump_items(pay.allowances), deductions=dump_items(pay.deductions),
            absence_deduction=pay.absence_deduction, gross=pay.gross, net=pay.net, working_days=pay.working_days,
            present_days=pay.present_days, absent_days=pay.absent_days, leave_days=pay.leave_days,
        ))  # fmt: skip


def _draft(db: Session, run_id: int) -> PayrollRun:
    run = get_or_404(db, PayrollRun, run_id, "Payroll run")
    if run.status != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, "This payroll is finalized and can no longer change")
    return run


@router.get("/payroll", dependencies=payroll_roles)
def list_runs(db: DB):
    return [_run_out(db, r) for r in db.scalars(select(PayrollRun).order_by(PayrollRun.month.desc()))]


@router.post("/payroll", status_code=201)
def create_run(body: RunIn, db: DB, user: CurrentUser = Depends(require_roles(*PAYROLL))):
    if db.scalar(select(func.count()).select_from(PayrollRun).where(PayrollRun.month == body.month)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Payroll for {body.month} already exists")
    run = PayrollRun(month=body.month, status="draft", created_by=user.ref, created_at=_now())
    db.add(run)
    db.flush()
    _calculate(db, run)
    db.commit()
    return _run_out(db, run, with_payslips=True)


@router.get("/payroll/{run_id}", dependencies=payroll_roles)
def get_run(run_id: int, db: DB):
    return _run_out(db, get_or_404(db, PayrollRun, run_id, "Payroll run"), with_payslips=True)


@router.post("/payroll/{run_id}/recalculate", dependencies=payroll_roles)
def recalculate_run(run_id: int, db: DB):
    run = _draft(db, run_id)
    _calculate(db, run)
    db.commit()
    return _run_out(db, run, with_payslips=True)


@router.post("/payroll/{run_id}/finalize", dependencies=payroll_roles)
def finalize_run(run_id: int, db: DB):
    run = _draft(db, run_id)
    run.status, run.finalized_at = "finalized", _now()
    db.commit()
    return _run_out(db, run, with_payslips=True)


@router.delete("/payroll/{run_id}", status_code=204, dependencies=payroll_roles)
def delete_run(run_id: int, db: DB):
    db.delete(_draft(db, run_id))
    db.commit()


def _salary_category(db: Session) -> int:
    cat = db.scalars(select(ExpenseCategory).where(ExpenseCategory.name == "Salary")).first()
    if cat is None:
        cat = ExpenseCategory(name="Salary")
        db.add(cat)
        db.flush()
    return cat.expense_category_id


@router.post("/payroll/{run_id}/pay", dependencies=payroll_roles)
def pay_run(run_id: int, body: PayIn, db: DB):
    """Records one expense payment per unpaid payslip, so Income & expenses includes payroll.
    Payslips already paid are skipped, so calling this again changes nothing."""
    run = get_or_404(db, PayrollRun, run_id, "Payroll run")
    if run.status == "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, "Finalize the payroll before paying it")
    paid_on = body.date or date.today()
    when = str(calendar.timegm(paid_on.timetuple()) if body.date else int(time.time()))
    category, year = _salary_category(db), running_year(db)
    for slip in db.scalars(select(Payslip).where(Payslip.payroll_run_id == run.payroll_run_id, Payslip.paid_on.is_(None))):
        if float(slip.net) > 0:
            payment = Payment(
                payment_type="expense", expense_category_id=category, title=f"Salary {run.month} – {slip.staff_name}",
                method=body.method, amount=_fmt(float(slip.net)), timestamp=when, year=year,
                description=f"payslip:{slip.payslip_id}",
            )  # fmt: skip
            db.add(payment)
            db.flush()
            slip.payment_id = payment.payment_id
        slip.paid_on = paid_on
    if run.status != "paid":
        run.status, run.paid_at = "paid", _now()
    db.commit()
    return _run_out(db, run, with_payslips=True)


# --- payslips ----------------------------------------------------------------------------


@router.get("/payslips/mine", dependencies=staff_only)
def my_payslips(user: Me, db: DB):
    rows = db.execute(
        select(Payslip, PayrollRun)
        .join(PayrollRun, PayrollRun.payroll_run_id == Payslip.payroll_run_id)
        .where(Payslip.staff_role == user.role, Payslip.staff_id == user.id, PayrollRun.status != "draft")
        .order_by(PayrollRun.month.desc())
    ).all()
    return [_payslip_out(p, r) for p, r in rows]


@router.get("/payslips/{payslip_id}")
def get_payslip(payslip_id: int, user: Me, db: DB):
    slip = get_or_404(db, Payslip, payslip_id, "Payslip")
    run = db.get(PayrollRun, slip.payroll_run_id)
    # admins and accountants see every payslip; other staff only their own, once finalized
    if user.role not in PAYROLL and ((slip.staff_role, slip.staff_id) != (user.role, user.id) or run.status == "draft"):
        raise forbid()
    return {
        **_payslip_out(slip, run),
        "school": get_setting(db, "system_name"), "address": get_setting(db, "address"),
        "currency": get_setting(db, "currency", "usd"),
    }  # fmt: skip
