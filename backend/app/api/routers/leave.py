"""Leave requests for students (applied by the student or a parent) and staff.

Student leave is decided by an admin or a teacher of the student's current class;
staff leave by an admin. Leave an admin records is approved straight away."""

from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.api.crud import Page, get_or_404
from app.core.deps import DB, CurrentUser, Me, forbid, require_roles
from app.models import Enroll, LeaveRequest, SchoolClass, Section, Student, Subject
from app.services.access import children_ids, current_enroll
from app.services.accounts import get_account, ref_name
from app.services.notifications import notify, parent_or_student, user
from app.services.payroll import record_staff_leave
from app.services.school_calendar import working_days
from app.services.settings import running_year

ALL = ("admin", "teacher", "accountant", "librarian", "student", "parent")
STAFF_ROLES = ("teacher", "accountant", "librarian")
MAX_SPAN_DAYS = 60
OPEN = ("pending", "approved")

router = APIRouter(prefix="/leave", tags=["leave"], dependencies=[Depends(require_roles(*ALL))])

Kind = Literal["sick", "casual", "family", "other"]


class LeaveIn(BaseModel):
    # students apply for themselves and staff for themselves; parents name a child;
    # admins name a student or a member of staff
    student_id: int | None = None
    staff_role: Literal["teacher", "accountant", "librarian"] | None = None
    staff_id: int | None = None
    kind: Kind = "other"
    from_date: date
    to_date: date
    reason: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def check_dates(self):
        if self.to_date < self.from_date:
            raise ValueError("to_date must not be before from_date")
        if (self.to_date - self.from_date).days >= MAX_SPAN_DAYS:
            raise ValueError(f"Leave can cover at most {MAX_SPAN_DAYS} days; split longer leave into several requests")
        return self


class DecisionIn(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=2000)


class LeaveOut(BaseModel):
    leave_id: int
    kind: str
    from_date: date
    to_date: date
    days: int
    reason: str | None
    status: str
    person_role: str
    person_name: str
    student_id: int | None
    class_name: str | None
    applicant_role: str
    applicant_name: str
    decided_by_name: str | None
    decided_at: datetime | None
    decision_note: str | None
    created_at: datetime
    can_cancel: bool
    can_decide: bool


# --- rules ------------------------------------------------------------------------


def _teacher_class_ids(db: Session, teacher_id: int) -> set[int]:
    return {c for c in db.scalars(select(Subject.class_id).where(Subject.teacher_id == teacher_id)) if c}


def _can_decide(db: Session, user: CurrentUser, row: LeaveRequest) -> bool:
    if row.status != "pending":
        return False
    if user.role == "admin":
        return True
    if user.role != "teacher" or row.student_id is None:
        return False
    enroll = current_enroll(db, row.student_id)
    return enroll is not None and enroll.class_id in _teacher_class_ids(db, user.id)


def _can_cancel(user: CurrentUser, row: LeaveRequest) -> bool:
    return row.status == "pending" and row.applicant_role == user.role and row.applicant_id == user.id


def _person_filter(row: LeaveRequest):
    if row.student_id is not None:
        return LeaveRequest.student_id == row.student_id
    return (LeaveRequest.staff_role == row.staff_role) & (LeaveRequest.staff_id == row.staff_id)


def _resolve_person(db: Session, user: CurrentUser, body: LeaveIn) -> tuple[int | None, str | None, int | None]:
    """(student_id, staff_role, staff_id) the leave is for, after checking the user may apply for them."""
    staff_given = body.staff_role is not None or body.staff_id is not None
    if user.role == "student":
        if staff_given or body.student_id not in (None, user.id):
            raise forbid()
        return user.id, None, None
    if user.role == "parent":
        if staff_given or body.student_id is None or body.student_id not in children_ids(db, user.id):
            raise forbid()
        return body.student_id, None, None
    if user.role in STAFF_ROLES:
        if body.student_id is not None or (staff_given and (body.staff_role, body.staff_id) != (user.role, user.id)):
            raise forbid()
        return None, user.role, user.id
    # admin
    if (body.student_id is None) == (body.staff_role is None or body.staff_id is None):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Give either a student or a member of staff")
    if body.student_id is not None:
        get_or_404(db, Student, body.student_id, "Student")
        return body.student_id, None, None
    if get_account(db, body.staff_role, body.staff_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Staff member not found")
    return None, body.staff_role, body.staff_id


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# --- output -------------------------------------------------------------------------


def _out(db: Session, user: CurrentUser, rows: list[LeaveRequest]) -> list[LeaveOut]:
    student_ids = {r.student_id for r in rows if r.student_id}
    students = dict(db.execute(select(Student.student_id, Student.name).where(Student.student_id.in_(student_ids))).all()) if student_ids else {}
    classes: dict[int, str] = {}
    if student_ids:
        year = running_year(db)
        for sid, cname, sname in db.execute(
            select(Enroll.student_id, SchoolClass.name, Section.name)
            .join(SchoolClass, SchoolClass.class_id == Enroll.class_id)
            .outerjoin(Section, Section.section_id == Enroll.section_id)
            .where(Enroll.student_id.in_(student_ids), Enroll.year == year)
        ):
            classes[sid] = f"{cname}{f' / {sname}' if sname else ''}"
    out = []
    for r in rows:
        if r.student_id is not None:
            person_role, person_name = "student", students.get(r.student_id) or "Deleted student"
        else:
            person_role, person_name = r.staff_role or "", ref_name(db, f"{r.staff_role}-{r.staff_id}")
        out.append(
            LeaveOut(
                leave_id=r.leave_id, kind=r.kind, from_date=r.from_date, to_date=r.to_date, days=r.days, reason=r.reason,
                status=r.status, person_role=person_role, person_name=person_name, student_id=r.student_id,
                class_name=classes.get(r.student_id) if r.student_id else None,
                applicant_role=r.applicant_role, applicant_name=ref_name(db, f"{r.applicant_role}-{r.applicant_id}"),
                decided_by_name=ref_name(db, r.decided_by) if r.decided_by else None,
                decided_at=r.decided_at.replace(tzinfo=timezone.utc) if r.decided_at else None,
                decision_note=r.decision_note, created_at=r.created_at.replace(tzinfo=timezone.utc),
                can_cancel=_can_cancel(user, r), can_decide=_can_decide(db, user, r),
            )  # fmt: skip
        )
    return out


def _page(db: Session, user: CurrentUser, stmt, order, limit: int, offset: int) -> Page:
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(db.scalars(stmt.order_by(*order).limit(limit).offset(offset)))
    return Page(items=_out(db, user, rows), total=total)


def _notify_decision(db: Session, tasks: BackgroundTasks, row: LeaveRequest) -> None:
    span = row.from_date.isoformat() if row.from_date == row.to_date else f"{row.from_date.isoformat()} to {row.to_date.isoformat()}"
    note = f" Note: {row.decision_note}" if row.decision_note else ""
    if row.student_id is not None:
        student = db.get(Student, row.student_id)
        name = student.name if student else "your child"
        recipient = parent_or_student(db, row.student_id)
        # a student without a linked parent was only ever emailed
        defaults = None if student and student.parent_id else {"email", "push"}
    else:
        name = "you"
        recipient = user(row.staff_role or "", row.staff_id or 0)
        defaults = {"email", "push"}  # staff decisions were emailed, not texted
    text = f"Leave for {name} ({span}) was {row.status}.{note}"
    notify(db, tasks, [recipient], "leave", f"Leave request {row.status}", text, "/app/leave", defaults=defaults)


# --- routes -------------------------------------------------------------------------


@router.get("/days")
def count_days(d_from: date = Query(alias="from"), d_to: date = Query(alias="to"), *, db: DB):
    """School days in a date range, shown while filling in a request."""
    if d_to < d_from or (d_to - d_from).days >= MAX_SPAN_DAYS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Choose a range of at most {MAX_SPAN_DAYS} days")
    return {"days": working_days(db, d_from, d_to)}


def _mark_staff_attendance(db: Session, row: LeaveRequest) -> None:
    """Approved staff leave shows as "leave" on the staff attendance sheet (and is paid in payroll)."""
    if row.staff_role and row.staff_id:
        record_staff_leave(db, row.staff_role, row.staff_id, row.from_date, row.to_date, row.decided_by)


@router.post("", response_model=LeaveOut, status_code=201)
def apply(body: LeaveIn, user: Me, db: DB):
    student_id, staff_role, staff_id = _resolve_person(db, user, body)
    days = working_days(db, body.from_date, body.to_date)
    if days == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "There are no school days in that range")
    row = LeaveRequest(
        applicant_role=user.role, applicant_id=user.id, student_id=student_id, staff_role=staff_role, staff_id=staff_id,
        kind=body.kind, from_date=body.from_date, to_date=body.to_date, days=days, reason=body.reason.strip(),
        status="pending", created_at=_now(), year=running_year(db),
    )  # fmt: skip
    overlap = db.scalars(
        select(LeaveRequest.leave_id).where(
            _person_filter(row), LeaveRequest.status.in_(OPEN),
            LeaveRequest.from_date <= body.to_date, LeaveRequest.to_date >= body.from_date,
        )  # fmt: skip
    ).first()
    if overlap is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "There is already a pending or approved leave request for these dates")
    if user.role == "admin":
        row.status, row.decided_by, row.decided_at = "approved", user.ref, _now()
        _mark_staff_attendance(db, row)
    db.add(row)
    db.commit()
    return _out(db, user, [row])[0]


@router.get("/mine", response_model=Page)
def my_requests(
    user: Me,
    db: DB,
    status_: str | None = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Students: their own leave; parents: their children's; staff: their own; admins: leave they recorded."""
    stmt = select(LeaveRequest)
    if user.role == "student":
        stmt = stmt.where(LeaveRequest.student_id == user.id)
    elif user.role == "parent":
        stmt = stmt.where(LeaveRequest.student_id.in_(children_ids(db, user.id) or [-1]))
    elif user.role in STAFF_ROLES:
        stmt = stmt.where(LeaveRequest.staff_role == user.role, LeaveRequest.staff_id == user.id)
    else:
        stmt = stmt.where(LeaveRequest.applicant_role == user.role, LeaveRequest.applicant_id == user.id)
    if status_:
        stmt = stmt.where(LeaveRequest.status == status_)
    return _page(db, user, stmt, (LeaveRequest.from_date.desc(), LeaveRequest.leave_id.desc()), limit, offset)


@router.get("/approvals", response_model=Page, dependencies=[Depends(require_roles("admin", "teacher"))])
def to_decide(
    user: Me,
    db: DB,
    status_: str | None = Query(None, alias="status"),
    who: Literal["students", "staff"] | None = None,
    class_id: int | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Requests the user may decide (and past decisions), pending first. Teachers see their classes' students."""
    stmt = select(LeaveRequest)
    year = running_year(db)
    if user.role == "teacher":
        class_ids = _teacher_class_ids(db, user.id)
        if class_id is not None:
            class_ids &= {class_id}
        stmt = stmt.where(LeaveRequest.student_id.in_(select(Enroll.student_id).where(Enroll.year == year, Enroll.class_id.in_(class_ids or [-1]))))
    else:
        if who == "students":
            stmt = stmt.where(LeaveRequest.student_id.is_not(None))
        elif who == "staff":
            stmt = stmt.where(LeaveRequest.student_id.is_(None))
        if class_id is not None:
            stmt = stmt.where(LeaveRequest.student_id.in_(select(Enroll.student_id).where(Enroll.year == year, Enroll.class_id == class_id)))
    if status_:
        stmt = stmt.where(LeaveRequest.status == status_)
    pending_first = case((LeaveRequest.status == "pending", 0), else_=1)
    return _page(db, user, stmt, (pending_first, LeaveRequest.from_date.desc(), LeaveRequest.leave_id.desc()), limit, offset)


@router.post("/{leave_id}/decision", response_model=LeaveOut, dependencies=[Depends(require_roles("admin", "teacher"))])
def decide(leave_id: int, body: DecisionIn, user: Me, tasks: BackgroundTasks, db: DB):
    row = get_or_404(db, LeaveRequest, leave_id, "Leave request")
    if row.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"This request is already {row.status}")
    if not _can_decide(db, user, row):
        raise forbid()
    row.status = "approved" if body.approve else "rejected"
    row.decided_by, row.decided_at = user.ref, _now()
    row.decision_note = (body.note or "").strip() or None
    if row.status == "approved":
        _mark_staff_attendance(db, row)
    db.commit()
    _notify_decision(db, tasks, row)
    return _out(db, user, [row])[0]


@router.post("/{leave_id}/cancel", response_model=LeaveOut)
def cancel(leave_id: int, user: Me, db: DB):
    row = get_or_404(db, LeaveRequest, leave_id, "Leave request")
    if row.applicant_role != user.role or row.applicant_id != user.id:
        raise forbid()
    if row.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only pending requests can be cancelled")
    row.status = "cancelled"
    db.commit()
    return _out(db, user, [row])[0]


@router.get("/summary", dependencies=[Depends(require_roles("admin"))])
def summary(db: DB, year: str | None = None):
    """Approved leave days per person in a year (default: the running year)."""
    year = year or running_year(db)
    rows = db.execute(
        select(LeaveRequest.student_id, LeaveRequest.staff_role, LeaveRequest.staff_id, func.sum(LeaveRequest.days), func.count())
        .where(LeaveRequest.status == "approved", LeaveRequest.year == year)
        .group_by(LeaveRequest.student_id, LeaveRequest.staff_role, LeaveRequest.staff_id)
    ).all()
    out = []
    for student_id, staff_role, staff_id, days, count in rows:
        role, uid = ("student", student_id) if student_id is not None else (staff_role, staff_id)
        out.append({"role": role, "id": uid, "name": ref_name(db, f"{role}-{uid}"), "days": int(days or 0), "requests": count})
    return {"year": year, "people": sorted(out, key=lambda p: (-p["days"], p["name"]))}
