"""Analytics for admins (everything), accountants (fees) and teachers (their own classes
and workload). Read-only; the scoring rules are in app/services/analytics.py."""

import re
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import DB, CurrentUser, Me, forbid, require_roles
from app.schemas.analytics import AtRiskPage, DefaulterPage
from app.services import analytics as svc
from app.services.export import xlsx_response
from app.services.fees import school_today
from app.services.settings import running_year

router = APIRouter(prefix="/analytics", tags=["analytics"])
TEACHING = [Depends(require_roles("admin", "teacher"))]
FIN = [Depends(require_roles("admin", "accountant"))]


def _scope(db: Session, user: CurrentUser, class_id: int | None) -> set[int] | None:
    """Classes the user may look at; 403 when a teacher asks for a class they don't teach."""
    scope = svc.class_scope(db, user)
    if class_id and scope is not None and class_id not in scope:
        raise forbid()
    return scope


def _risk_params(
    days: int = Query(30, ge=7, le=180, description="Attendance window in calendar days"),
    min_attendance: float = Query(75, ge=0, le=100, description="Flag attendance below this %"),
    drop: float = Query(10, ge=1, le=100, description="Flag a fall of this many percentage points between the last two exams"),
    invoice_due_days: int = Query(30, ge=0, le=365, description="Invoices not generated from a fee plan are due this many days after creation"),
    min_homework: float = Query(60, ge=0, le=100, description="Flag handing in less than this % of homework due"),
    max_leave_days: int = Query(10, ge=1, le=365, description="Flag this many approved leave days or more"),
    min_score: int = Query(1, ge=0, le=100, description="Only list students scoring at least this"),
) -> svc.RiskParams:
    return svc.RiskParams(days, min_attendance, drop, invoice_due_days, min_homework, max_leave_days, min_score)


@router.get("/summary", dependencies=[Depends(require_roles("admin"))])
def summary(db: DB):
    """Dashboard tiles: students at risk, and fees billed / collected this month."""
    year = running_year(db)
    risks = svc.at_risk(db, year, None, svc.RiskParams(min_score=25))
    month = svc.fee_overview(db, year, months=1)["monthly"][0]
    return {
        "at_risk_high": sum(1 for r in risks if r.level == "high"),
        "at_risk_medium": sum(1 for r in risks if r.level == "medium"),
        "billed_this_month": month["billed"],
        "collected_this_month": month["collected"],
    }


@router.get("/at-risk", response_model=AtRiskPage, dependencies=TEACHING)
def at_risk(
    user: Me,
    db: DB,
    class_id: int | None = None,
    section_id: int | None = None,
    params: svc.RiskParams = Depends(_risk_params),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    scope = _scope(db, user, class_id)
    rows = svc.at_risk(db, running_year(db), scope, params, class_id, section_id)
    counts = {level: sum(1 for r in rows if r.level == level) for level in ("high", "medium", "low")}
    return AtRiskPage(items=[asdict(r) for r in rows[offset : offset + limit]], total=len(rows), counts=counts, params=asdict(params))


@router.get("/at-risk.xlsx", dependencies=TEACHING)
def at_risk_xlsx(
    user: Me, db: DB, class_id: int | None = None, section_id: int | None = None, params: svc.RiskParams = Depends(_risk_params)
):
    rows = svc.at_risk(db, running_year(db), _scope(db, user, class_id), params, class_id, section_id)
    headers = [
        "Student", "Class", "Section", "Roll", "Score", "Level", "Attendance %", "Days marked", "Latest exam %",
        "Previous exam %", "Failing subjects", "Overdue fees", "Homework handed in %", "Leave days", "Reasons",
    ]  # fmt: skip
    return xlsx_response(
        "students-at-risk",
        headers,
        (
            [
                r.name, r.class_name, r.section_name, r.roll, r.score, r.level, r.attendance_pct, r.marked_days, r.latest_exam_pct,
                r.previous_exam_pct, r.failing_subjects, r.overdue_amount, r.homework_rate, r.leave_days, "; ".join(r.reasons),
            ]  # fmt: skip
            for r in rows
        ),
        "At risk",
    )


@router.get("/fees", dependencies=FIN)
def fees(db: DB, months: int = Query(12, ge=1, le=36)):
    return svc.fee_overview(db, running_year(db), months)


@router.get("/fees/defaulters", response_model=DefaulterPage, dependencies=FIN)
def fee_defaulters(
    db: DB,
    class_id: int | None = None,
    invoice_due_days: int = Query(30, ge=0, le=365),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    rows = svc.defaulters(db, running_year(db), invoice_due_days, class_id)
    return DefaulterPage(items=rows[offset : offset + limit], total=len(rows), amount=round(sum(r["amount"] for r in rows), 2))


@router.get("/fees/defaulters.xlsx", dependencies=FIN)
def fee_defaulters_xlsx(db: DB, class_id: int | None = None, invoice_due_days: int = Query(30, ge=0, le=365)):
    rows = svc.defaulters(db, running_year(db), invoice_due_days, class_id)
    headers = ["Student", "Class", "Section", "Roll", "Amount overdue", "Invoices", "Oldest due date", "Days overdue", "Parent phone"]
    return xlsx_response(
        "fee-defaulters",
        headers,
        ([r["name"], r["class_name"], r["section_name"], r["roll"], r["amount"], r["invoices"], r["oldest_due"], r["days_overdue"], r["parent_phone"]] for r in rows),
        "Defaulters",
    )


@router.get("/attendance", dependencies=TEACHING)
def attendance(
    user: Me,
    db: DB,
    month: str | None = Query(None, description="YYYY-MM, default this month"),
    class_id: int | None = None,
    threshold: float = Query(80, ge=0, le=100, description="Chronic absentees: attendance below this % in the month"),
):
    month = month or school_today().strftime("%Y-%m")
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "month must be YYYY-MM")
    return svc.attendance_overview(db, running_year(db), _scope(db, user, class_id), month, threshold, class_id)


@router.get("/exams", dependencies=TEACHING)
def exams(user: Me, db: DB, exam_id: int | None = None, class_id: int | None = None):
    """Results of one exam (default: the latest with marks) by class and subject."""
    scope = _scope(db, user, class_id)
    year = running_year(db)
    options = svc.exams_with_marks(db, year)
    if exam_id is None:
        exam_id = options[-1]["exam_id"] if options else None
    if exam_id is None:
        return {"exams": options, "exam_id": None, "classes": [], "subjects": [], "grades": [], "top": [], "bottom": []}
    return {"exams": options, **svc.exam_overview(db, year, scope, exam_id, class_id)}


@router.get("/workload", dependencies=TEACHING)
def workload(user: Me, db: DB):
    """Every teacher's workload for admins; a teacher sees only their own."""
    return svc.workload(db, running_year(db), None if user.role == "admin" else [user.id])
