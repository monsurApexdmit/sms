"""Read-only analytics over the school's existing data (no tables of its own).

Totals are SQL aggregates grouped by student / class / month; Python only combines the
grouped rows. Legacy columns store unix-day timestamps and amounts as text, so they are
cast in SQL (BigInteger / Numeric) the same way finance.py does.

At-risk score (0-100, higher = more concern), from these signals for the running year:

| Signal | Rule (query parameter, default) | Points |
|---|---|---|
| Attendance | present / marked days over the last `days` (30) calendar days below `min_attendance` (75 %) | 30, or 40 when 15+ points below |
| Failing subjects | subjects with a failing grade (grade point 0) in the latest exam with marks | 20 + 5 per extra subject, max 30 |
| Falling results | latest exam % at least `drop` (10) points below the previous exam's % | 15 |
| Overdue fees | any unpaid invoice past its due date (fee-plan instalment due date; other invoices `invoice_due_days` (30) after creation) | 10 |
| Homework | handed in fewer than `min_homework` (60 %) of homework already due (at least 3 due) | 10 |
| Leave | approved leave this year of `max_leave_days` (10) school days or more | 5 |

Level: high at 50+, medium at 25+, otherwise low. Attendance uses days that were actually
marked (present or absent) as the denominator, so a section whose attendance is not taken
is not flagged. Exams are ordered by exam_id; percentages use the marks recorded.
"""

import calendar
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import BigInteger, Numeric, and_, case, cast, func, or_, select, true
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser
from app.models import (
    AcademicYear,
    Attendance,
    ClassRoutine,
    Enroll,
    Exam,
    FeeInstalment,
    FeeInvoice,
    FeePlan,
    Grade,
    Homework,
    HomeworkSubmission,
    Invoice,
    LeaveRequest,
    Mark,
    MeetingBooking,
    MeetingSlot,
    Parent,
    Payment,
    SchoolClass,
    Section,
    StaffAttendance,
    Student,
    Subject,
    Teacher,
)
from app.services.fees import school_today
from app.services.invoices import num
from app.services.results import exam_results, grade_point

DAY = 86400
AGEING = (("1-30", 1, 30), ("31-60", 31, 60), ("61-90", 61, 90), ("90+", 91, None))


def day_ts(d: date) -> int:
    """Unix seconds of a day's midnight UTC, as the legacy timestamp columns store it."""
    return calendar.timegm(d.timetuple())


def money(column):
    return func.coalesce(func.sum(cast(column, Numeric(14, 2))), 0)


def day_cast(column):
    """Legacy unix-seconds text as a number (blank or non-numeric text casts to 0)."""
    return cast(column, BigInteger)


def pct(part: float, whole: float) -> float | None:
    return round(part * 100 / whole, 1) if whole else None


def month_starts(last: date, months: int) -> list[date]:
    first = date(last.year, last.month, 1)
    out = [first]
    for _ in range(months - 1):
        prev = out[-1] - timedelta(days=1)
        out.append(date(prev.year, prev.month, 1))
    return out[::-1]


def next_month(d: date) -> date:
    return date(d.year + d.month // 12, d.month % 12 + 1, 1)


# --- who may see what ---------------------------------------------------------------


def teacher_class_ids(db: Session, teacher_id: int) -> set[int]:
    """Classes a teacher teaches a subject in, or is class / section teacher of."""
    ids = set(db.scalars(select(Subject.class_id).where(Subject.teacher_id == teacher_id)))
    ids |= set(db.scalars(select(SchoolClass.class_id).where(SchoolClass.teacher_id == teacher_id)))
    ids |= set(db.scalars(select(Section.class_id).where(Section.teacher_id == teacher_id)))
    return {i for i in ids if i}


def class_scope(db: Session, user: CurrentUser) -> set[int] | None:
    """None = every class (admin)."""
    return None if user.role == "admin" else teacher_class_ids(db, user.id)


def _names(db: Session, model, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    pk = next(iter(model.__table__.primary_key.columns))
    return {k: v or "" for k, v in db.execute(select(pk, model.name).where(pk.in_(ids)))}


def _enrolled(db: Session, year: str, scope: set[int] | None, class_id: int | None, section_id: int | None):
    stmt = select(Enroll.student_id).where(Enroll.year == year, Enroll.student_id.is_not(None))
    if class_id:
        stmt = stmt.where(Enroll.class_id == class_id)
    if section_id:
        stmt = stmt.where(Enroll.section_id == section_id)
    if scope is not None:
        stmt = stmt.where(Enroll.class_id.in_(scope or {-1}))
    return stmt


# --- at risk --------------------------------------------------------------------------


@dataclass
class RiskParams:
    days: int = 30
    min_attendance: float = 75
    drop: float = 10
    invoice_due_days: int = 30
    min_homework: float = 60
    max_leave_days: int = 10
    min_score: int = 1


@dataclass
class Risk:
    student_id: int
    name: str
    roll: int | None
    class_id: int | None
    section_id: int | None
    class_name: str = ""
    section_name: str = ""
    score: int = 0
    level: str = "low"
    reasons: list[str] = field(default_factory=list)
    attendance_pct: float | None = None
    marked_days: int = 0
    latest_exam_pct: float | None = None
    previous_exam_pct: float | None = None
    failing_subjects: int = 0
    overdue_amount: float = 0
    homework_rate: float | None = None
    homework_due: int = 0
    leave_days: int = 0


def _fail_condition(db: Session):
    """SQL condition: the mark is in no grade with a grade point above 0 (a failing grade, as in results.py)."""
    passing = [g for g in db.scalars(select(Grade)) if grade_point(g) > 0]
    if not passing:
        return true()
    return ~or_(*[Mark.mark_obtained.between(g.mark_from or 0, g.mark_upto or 0) for g in passing])


def overdue_invoices(db: Session, today: date, invoice_due_days: int, student_ids=None) -> list[tuple[int, int, float, date, int]]:
    """(invoice_id, student_id, amount due, due date, days overdue) of every unpaid invoice past its due date."""
    stmt = (
        select(Invoice.invoice_id, Invoice.student_id, Invoice.due, Invoice.creation_timestamp, FeeInstalment.due_date)
        .outerjoin(FeeInvoice, FeeInvoice.invoice_id == Invoice.invoice_id)
        .outerjoin(FeeInstalment, FeeInstalment.fee_instalment_id == FeeInvoice.fee_instalment_id)
        .where(or_(Invoice.status.is_(None), Invoice.status != "paid"), Invoice.student_id.is_not(None))
    )
    if student_ids is not None:
        stmt = stmt.where(Invoice.student_id.in_(student_ids))
    out = []
    for invoice_id, student_id, due, created, due_on in db.execute(stmt):
        amount = num(due)
        if amount <= 0:
            continue
        if due_on is None:
            if not created:
                continue
            due_on = datetime.fromtimestamp(int(created) + invoice_due_days * DAY, timezone.utc).date()
        late = (today - due_on).days
        if late > 0:
            out.append((invoice_id, student_id, amount, due_on, late))
    return out


def at_risk(
    db: Session, year: str, scope: set[int] | None, p: RiskParams, class_id: int | None = None, section_id: int | None = None
) -> list[Risk]:
    today = school_today()
    enrolled = _enrolled(db, year, scope, class_id, section_id)
    rows = db.execute(
        select(Enroll.student_id, Enroll.roll, Enroll.class_id, Enroll.section_id, Student.name)
        .join(Student, Student.student_id == Enroll.student_id)
        .where(Enroll.student_id.in_(enrolled), Enroll.year == year)
        .order_by(Enroll.class_id, Enroll.section_id, Enroll.roll)
    ).all()
    risks: dict[int, Risk] = {}
    for sid, roll, cid, sec, name in rows:
        risks.setdefault(sid, Risk(student_id=sid, name=name or "", roll=roll, class_id=cid, section_id=sec))
    if not risks:
        return []

    # attendance over the window
    start = today - timedelta(days=p.days - 1)
    ts = day_cast(Attendance.timestamp)
    for sid, present, marked in db.execute(
        select(
            Attendance.student_id,
            func.sum(case((Attendance.status == 1, 1), else_=0)),
            func.sum(case((Attendance.status.in_((1, 2)), 1), else_=0)),
        )
        .where(Attendance.student_id.in_(enrolled), Attendance.year == year, ts >= day_ts(start), ts <= day_ts(today))
        .group_by(Attendance.student_id)
    ):
        if sid in risks and marked:
            risks[sid].marked_days = int(marked)
            risks[sid].attendance_pct = pct(present or 0, marked)

    # exam percentages (recorded marks) and failing subjects per exam
    fail_sum = func.sum(case((_fail_condition(db), 1), else_=0))
    per_exam: dict[int, list[tuple[int, float | None, int]]] = defaultdict(list)
    for sid, exam_id, obtained, full, failed in db.execute(
        select(
            Mark.student_id,
            Mark.exam_id,
            func.sum(Mark.mark_obtained),
            func.sum(case((Mark.mark_total > 0, Mark.mark_total), else_=100)),
            fail_sum,
        )
        .where(Mark.student_id.in_(enrolled), Mark.year == year, Mark.mark_obtained.is_not(None), Mark.exam_id.is_not(None))
        .group_by(Mark.student_id, Mark.exam_id)
    ):
        per_exam[sid].append((exam_id, pct(obtained or 0, full or 0), int(failed or 0)))
    for sid, exams in per_exam.items():
        if sid not in risks:
            continue
        exams.sort(key=lambda e: e[0])
        latest = exams[-1]
        risks[sid].latest_exam_pct, risks[sid].failing_subjects = latest[1], latest[2]
        if len(exams) > 1:
            risks[sid].previous_exam_pct = exams[-2][1]

    # overdue fees
    for _, sid, amount, _, _ in overdue_invoices(db, today, p.invoice_due_days, enrolled):
        if sid in risks:
            risks[sid].overdue_amount += amount

    # homework handed in, out of homework already due for the student's class / section
    due_by: dict[tuple[int, int | None], int] = {
        (c, s): n
        for c, s, n in db.execute(
            select(Homework.class_id, Homework.section_id, func.count())
            .where(Homework.year == year, Homework.due_date < today)
            .group_by(Homework.class_id, Homework.section_id)
        )
    }
    handed_in = dict(
        db.execute(
            select(HomeworkSubmission.student_id, func.count())
            .join(Homework, Homework.homework_id == HomeworkSubmission.homework_id)
            .where(HomeworkSubmission.student_id.in_(enrolled), Homework.year == year, Homework.due_date < today)
            .group_by(HomeworkSubmission.student_id)
        ).all()
    )

    # approved leave
    leave = dict(
        db.execute(
            select(LeaveRequest.student_id, func.sum(LeaveRequest.days))
            .where(LeaveRequest.student_id.in_(enrolled), LeaveRequest.status == "approved", LeaveRequest.year == year)
            .group_by(LeaveRequest.student_id)
        ).all()
    )

    classes = _names(db, SchoolClass, {r.class_id for r in risks.values()})
    sections = _names(db, Section, {r.section_id for r in risks.values()})
    out = []
    for r in risks.values():
        r.class_name, r.section_name = classes.get(r.class_id or 0, ""), sections.get(r.section_id or 0, "")
        r.homework_due = due_by.get((r.class_id, None), 0) + (due_by.get((r.class_id, r.section_id), 0) if r.section_id else 0)
        if r.homework_due:
            r.homework_rate = pct(min(handed_in.get(r.student_id, 0), r.homework_due), r.homework_due)
        r.leave_days = int(leave.get(r.student_id) or 0)
        _score(r, p)
        if r.score >= p.min_score:
            out.append(r)
    out.sort(key=lambda r: (-r.score, r.class_name, r.section_name, r.roll or 0, r.name))
    return out


def _score(r: Risk, p: RiskParams) -> None:
    points = 0
    if r.attendance_pct is not None and r.attendance_pct < p.min_attendance:
        points += 40 if r.attendance_pct < p.min_attendance - 15 else 30
        r.reasons.append(f"Attendance {r.attendance_pct:g}% over the last {p.days} days ({r.marked_days} days marked)")
    if r.failing_subjects:
        points += min(20 + 5 * (r.failing_subjects - 1), 30)
        r.reasons.append(f"Failing {r.failing_subjects} subject{'s' if r.failing_subjects > 1 else ''} in the latest exam")
    if r.latest_exam_pct is not None and r.previous_exam_pct is not None and r.previous_exam_pct - r.latest_exam_pct >= p.drop:
        points += 15
        r.reasons.append(f"Results fell from {r.previous_exam_pct:g}% to {r.latest_exam_pct:g}%")
    if r.overdue_amount > 0:
        points += 10
        r.reasons.append(f"Overdue fees of {r.overdue_amount:g}")
    if r.homework_rate is not None and r.homework_due >= 3 and r.homework_rate < p.min_homework:
        points += 10
        r.reasons.append(f"Handed in {r.homework_rate:g}% of {r.homework_due} homework assignments")
    if r.leave_days >= p.max_leave_days:
        points += 5
        r.reasons.append(f"{r.leave_days} school days of approved leave this year")
    r.score = min(points, 100)
    r.level = "high" if r.score >= 50 else "medium" if r.score >= 25 else "low"


# --- fees --------------------------------------------------------------------------------


def fee_overview(db: Session, year: str, months: int = 12) -> dict:
    today = school_today()
    starts = month_starts(today, months)
    bounds = [(day_ts(s), day_ts(next_month(s))) for s in starts]
    paid_ts = day_cast(Payment.timestamp)
    billed = db.execute(
        select(*[func.coalesce(func.sum(case((Invoice.creation_timestamp.between(a, b - 1), Invoice.amount), else_=0)), 0) for a, b in bounds])
    ).one()
    collected = db.execute(
        select(*[money(case((paid_ts.between(a, b - 1), Payment.amount), else_="0")) for a, b in bounds]).where(Payment.payment_type == "income")
    ).one()
    monthly = [
        {"month": s.strftime("%Y-%m"), "billed": float(billed[i] or 0), "collected": float(collected[i] or 0)}
        for i, s in enumerate(starts)
    ]

    year_billed, year_paid, year_due = db.execute(
        select(func.coalesce(func.sum(Invoice.amount), 0), money(Invoice.amount_paid), money(Invoice.due)).where(Invoice.year == year)
    ).one()

    by_class = [
        {"class_id": cid, "class_name": "", "outstanding": float(due or 0), "students": n}
        for cid, due, n in db.execute(
            select(Enroll.class_id, money(Invoice.due), func.count(func.distinct(Invoice.student_id)))
            .join(Enroll, and_(Enroll.student_id == Invoice.student_id, Enroll.year == Invoice.year))
            .where(Invoice.year == year, or_(Invoice.status.is_(None), Invoice.status != "paid"))
            .group_by(Enroll.class_id)
        )
        if due
    ]
    names = _names(db, SchoolClass, {c["class_id"] for c in by_class})
    for c in by_class:
        c["class_name"] = names.get(c["class_id"] or 0, "")
    by_class.sort(key=lambda c: -c["outstanding"])

    buckets = {label: {"bucket": label, "amount": 0.0, "invoices": 0} for label, _, _ in AGEING}
    for _, _, amount, _, late in overdue_invoices(db, today, 30):
        for label, lo, hi in AGEING:
            if late >= lo and (hi is None or late <= hi):
                buckets[label]["amount"] += amount
                buckets[label]["invoices"] += 1

    instalments = [
        {
            "fee_plan_id": plan_id, "plan": plan, "fee_instalment_id": inst_id, "instalment": inst, "due_date": due_on,
            "invoices": n, "billed": float(billed_i or 0), "collected": float(paid or 0), "rate": pct(float(paid or 0), float(billed_i or 0)),
        }  # fmt: skip
        for plan_id, plan, inst_id, inst, due_on, n, billed_i, paid in db.execute(
            select(
                FeePlan.fee_plan_id, FeePlan.name, FeeInstalment.fee_instalment_id, FeeInstalment.name, FeeInstalment.due_date,
                func.count(FeeInvoice.fee_invoice_id), func.coalesce(func.sum(Invoice.amount), 0), money(Invoice.amount_paid),
            )  # fmt: skip
            .join(FeeInstalment, FeeInstalment.fee_plan_id == FeePlan.fee_plan_id)
            .join(FeeInvoice, FeeInvoice.fee_instalment_id == FeeInstalment.fee_instalment_id)
            .join(Invoice, Invoice.invoice_id == FeeInvoice.invoice_id)
            .where(FeePlan.year == year)
            .group_by(FeePlan.fee_plan_id, FeePlan.name, FeeInstalment.fee_instalment_id, FeeInstalment.name, FeeInstalment.due_date)
            .order_by(FeeInstalment.due_date, FeePlan.name)
        )
    ]
    return {
        "year": year,
        "billed": float(year_billed or 0),
        "collected": float(year_paid or 0),
        "outstanding": float(year_due or 0),
        "collection_rate": pct(float(year_paid or 0), float(year_billed or 0)),
        "overdue": round(sum(b["amount"] for b in buckets.values()), 2),
        "monthly": monthly,
        "by_class": by_class,
        "ageing": list(buckets.values()),
        "instalments": instalments,
    }


def defaulters(db: Session, year: str, invoice_due_days: int = 30, class_id: int | None = None) -> list[dict]:
    """Students with overdue invoices, largest amount first."""
    today = school_today()
    per: dict[int, dict] = {}
    for _, sid, amount, due_on, late in overdue_invoices(db, today, invoice_due_days):
        row = per.setdefault(sid, {"student_id": sid, "amount": 0.0, "invoices": 0, "oldest_due": due_on, "days_overdue": 0})
        row["amount"] += amount
        row["invoices"] += 1
        row["oldest_due"] = min(row["oldest_due"], due_on)
        row["days_overdue"] = max(row["days_overdue"], late)
    if not per:
        return []
    enrolls = {
        sid: (cid, sec, roll)
        for sid, cid, sec, roll in db.execute(
            select(Enroll.student_id, Enroll.class_id, Enroll.section_id, Enroll.roll).where(Enroll.year == year, Enroll.student_id.in_(per))
        )
    }
    students = {
        s.student_id: s for s in db.scalars(select(Student).where(Student.student_id.in_(per)))
    }
    parents = dict(
        db.execute(select(Parent.parent_id, Parent.phone).where(Parent.parent_id.in_({s.parent_id for s in students.values() if s.parent_id}))).all()
    )
    classes = _names(db, SchoolClass, {e[0] for e in enrolls.values()})
    sections = _names(db, Section, {e[1] for e in enrolls.values()})
    out = []
    for sid, row in per.items():
        cid, sec, roll = enrolls.get(sid, (None, None, None))
        if class_id and cid != class_id:
            continue
        s = students.get(sid)
        row.update(
            name=(s.name if s else "") or "", roll=roll, class_id=cid, class_name=classes.get(cid or 0, ""),
            section_name=sections.get(sec or 0, ""), parent_phone=parents.get(s.parent_id) if s else None,
            amount=round(row["amount"], 2),
        )  # fmt: skip
        out.append(row)
    out.sort(key=lambda r: (-r["amount"], -r["days_overdue"], r["name"]))
    return out


# --- attendance -----------------------------------------------------------------------------


def attendance_overview(db: Session, year: str, scope: set[int] | None, month: str, threshold: float = 80, class_id: int | None = None) -> dict:
    y, m = (int(x) for x in month.split("-"))
    first = date(y, m, 1)
    a, b = day_ts(first), day_ts(next_month(first))
    ts = day_cast(Attendance.timestamp)
    present = func.sum(case((Attendance.status == 1, 1), else_=0))
    absent = func.sum(case((Attendance.status == 2, 1), else_=0))
    where = [Attendance.year == year]
    if class_id:
        where.append(Attendance.class_id == class_id)
    if scope is not None:
        where.append(Attendance.class_id.in_(scope or {-1}))

    sections = [
        {"class_id": cid, "section_id": sec, "present": int(p or 0), "absent": int(ab or 0), "rate": pct(p or 0, (p or 0) + (ab or 0))}
        for cid, sec, p, ab in db.execute(
            select(Attendance.class_id, Attendance.section_id, present, absent)
            .where(*where, ts >= a, ts < b)
            .group_by(Attendance.class_id, Attendance.section_id)
        )
        if (p or 0) + (ab or 0)
    ]
    cnames = _names(db, SchoolClass, {s["class_id"] for s in sections})
    snames = _names(db, Section, {s["section_id"] for s in sections})
    for s in sections:
        s["class_name"], s["section_name"] = cnames.get(s["class_id"] or 0, ""), snames.get(s["section_id"] or 0, "")
    sections.sort(key=lambda s: (s["class_name"], s["section_name"]))

    today = day_ts(school_today())
    tp, ta = db.execute(select(present, absent).where(*where, ts == today)).one()
    enrolled = db.scalar(select(func.count()).select_from(_enrolled(db, year, scope, class_id, None).subquery())) or 0

    starts = month_starts(first, 6)
    spans = [(day_ts(s), day_ts(next_month(s))) for s in starts]
    cols = []
    for lo, hi in spans:
        inside = ts.between(lo, hi - 1)
        cols += [func.sum(case((and_(inside, Attendance.status == 1), 1), else_=0)), func.sum(case((and_(inside, Attendance.status.in_((1, 2))), 1), else_=0))]
    totals = db.execute(select(*cols).where(*where)).one()
    trend = [{"month": s.strftime("%Y-%m"), "rate": pct(totals[2 * i] or 0, totals[2 * i + 1] or 0)} for i, s in enumerate(starts)]

    chronic = []
    for sid, cid, sec, p, ab in db.execute(
        select(Attendance.student_id, Attendance.class_id, Attendance.section_id, present, absent)
        .where(*where, ts >= a, ts < b)
        .group_by(Attendance.student_id, Attendance.class_id, Attendance.section_id)
    ):
        marked = (p or 0) + (ab or 0)
        rate = pct(p or 0, marked)
        if marked >= 3 and rate is not None and rate < threshold:
            chronic.append({"student_id": sid, "class_id": cid, "section_id": sec, "present": int(p or 0), "absent": int(ab or 0), "rate": rate})
    chronic.sort(key=lambda r: (r["rate"], -r["absent"]))
    chronic = chronic[:50]
    names = _names(db, Student, {c["student_id"] for c in chronic})
    cn = _names(db, SchoolClass, {c["class_id"] for c in chronic})
    sn = _names(db, Section, {c["section_id"] for c in chronic})
    for c in chronic:
        c.update(name=names.get(c["student_id"], ""), class_name=cn.get(c["class_id"] or 0, ""), section_name=sn.get(c["section_id"] or 0, ""))

    tp, ta = int(tp or 0), int(ta or 0)
    return {
        "month": month,
        "rate": pct(sum(s["present"] for s in sections), sum(s["present"] + s["absent"] for s in sections)),
        "sections": sections,
        "today": {"present": tp, "absent": ta, "not_marked": max(enrolled - tp - ta, 0), "enrolled": enrolled},
        "trend": trend,
        "chronic": chronic,
        "threshold": threshold,
    }


# --- exams -------------------------------------------------------------------------------------


def exams_with_marks(db: Session, year: str) -> list[dict]:
    ids = set(db.scalars(select(Mark.exam_id).where(Mark.year == year, Mark.mark_obtained.is_not(None)).distinct()))
    return [{"exam_id": e.exam_id, "name": e.name or ""} for e in db.scalars(select(Exam).where(Exam.year == year).order_by(Exam.exam_id)) if e.exam_id in ids]


def exam_overview(db: Session, year: str, scope: set[int] | None, exam_id: int, class_id: int | None = None) -> dict:
    class_ids = set(db.scalars(select(Mark.class_id).where(Mark.exam_id == exam_id, Mark.year == year).distinct()))
    if class_id:
        class_ids &= {class_id}
    if scope is not None:
        class_ids &= scope
    cnames = _names(db, SchoolClass, class_ids)
    classes, subjects, grades, ranked = [], {}, defaultdict(int), []
    for cid in sorted(class_ids, key=lambda c: cnames.get(c, "")):
        results = exam_results(db, exam_id, cid, year)
        done = [r for r in results.values() if r.result != "Incomplete"]
        passed = sum(1 for r in done if r.result == "Pass")
        classes.append({
            "class_id": cid, "class_name": cnames.get(cid, ""), "students": len(results), "complete": len(done),
            "average": round(sum(r.percentage or 0 for r in done) / len(done), 1) if done else None,
            "pass_rate": pct(passed, len(done)),
        })  # fmt: skip
        for r in results.values():
            if r.result != "Incomplete":
                ranked.append({"student_id": r.student_id, "class_id": cid, "class_name": cnames.get(cid, ""), "percentage": r.percentage, "gpa": r.gpa, "result": r.result})
            for line in r.subjects:
                if line.mark_obtained is None:
                    continue
                key = (cid, line.subject_id)
                s = subjects.setdefault(key, {"class_id": cid, "class_name": cnames.get(cid, ""), "subject_id": line.subject_id, "subject": line.subject or "", "marks": 0, "pct_sum": 0.0, "passed": 0})
                s["marks"] += 1
                s["pct_sum"] += line.mark_obtained * 100 / (line.full_marks or 100)
                s["passed"] += 1 if (line.grade_point or 0) > 0 else 0
                grades[line.grade or "No grade"] += 1
    subject_rows = [
        {k: v for k, v in s.items() if k not in ("pct_sum", "passed")} | {"average": round(s["pct_sum"] / s["marks"], 1), "pass_rate": pct(s["passed"], s["marks"])}
        for s in subjects.values()
    ]
    subject_rows.sort(key=lambda s: (s["pass_rate"] or 0, s["average"]))
    ranked.sort(key=lambda r: -(r["percentage"] or 0))
    names = _names(db, Student, {r["student_id"] for r in ranked[:10] + ranked[-10:]})
    for r in ranked:
        r["name"] = names.get(r["student_id"], "")
    grade_order = {g.name: -(g.mark_from or 0) for g in db.scalars(select(Grade))}
    return {
        "exam_id": exam_id,
        "classes": classes,
        "subjects": subject_rows,
        "grades": [{"grade": g, "count": n} for g, n in sorted(grades.items(), key=lambda kv: grade_order.get(kv[0], 1))],
        "top": ranked[:5],
        "bottom": ranked[::-1][:5] if len(ranked) > 5 else [],
    }


# --- teacher workload ------------------------------------------------------------------------------


def workload(db: Session, year: str, teacher_ids: list[int] | None = None) -> list[dict]:
    stmt = select(Teacher.teacher_id, Teacher.name).order_by(Teacher.name)
    if teacher_ids is not None:
        stmt = stmt.where(Teacher.teacher_id.in_(teacher_ids or [-1]))
    teachers = db.execute(stmt).all()
    ids = [t for t, _ in teachers]

    def grouped(q) -> dict:
        return {k: v for k, v in db.execute(q).all()}

    periods = grouped(
        select(Subject.teacher_id, func.count(ClassRoutine.class_routine_id))
        .join(Subject, Subject.subject_id == ClassRoutine.subject_id)
        .where(Subject.teacher_id.in_(ids), ClassRoutine.year == year)
        .group_by(Subject.teacher_id)
    )
    subjects = grouped(select(Subject.teacher_id, func.count()).where(Subject.teacher_id.in_(ids)).group_by(Subject.teacher_id))
    classes = grouped(select(Subject.teacher_id, func.count(func.distinct(Subject.class_id))).where(Subject.teacher_id.in_(ids)).group_by(Subject.teacher_id))
    homework = grouped(select(Homework.teacher_id, func.count()).where(Homework.teacher_id.in_(ids), Homework.year == year).group_by(Homework.teacher_id))
    backlog = grouped(
        select(Homework.teacher_id, func.count(HomeworkSubmission.submission_id))
        .join(Homework, Homework.homework_id == HomeworkSubmission.homework_id)
        .where(Homework.teacher_id.in_(ids), Homework.year == year, HomeworkSubmission.graded_at.is_(None))
        .group_by(Homework.teacher_id)
    )
    meetings = grouped(
        select(MeetingSlot.teacher_id, func.count(MeetingBooking.booking_id))
        .join(MeetingSlot, MeetingSlot.slot_id == MeetingBooking.slot_id)
        .where(MeetingSlot.teacher_id.in_(ids), MeetingBooking.status.in_(("booked", "done", "no_show")))
        .group_by(MeetingSlot.teacher_id)
    )
    leave = grouped(
        select(LeaveRequest.staff_id, func.sum(LeaveRequest.days))
        .where(LeaveRequest.staff_role == "teacher", LeaveRequest.staff_id.in_(ids), LeaveRequest.status == "approved", LeaveRequest.year == year)
        .group_by(LeaveRequest.staff_id)
    )
    ay = db.scalars(select(AcademicYear).where(AcademicYear.name == year)).first()
    att_where = [StaffAttendance.staff_role == "teacher", StaffAttendance.staff_id.in_(ids), StaffAttendance.status != "leave"]
    if ay is not None and ay.start_date:
        att_where.append(StaffAttendance.date >= ay.start_date)
    if ay is not None and ay.end_date:
        att_where.append(StaffAttendance.date <= ay.end_date)
    attendance = {
        sid: pct(int(came or 0), int(marked or 0))
        for sid, came, marked in db.execute(
            select(StaffAttendance.staff_id, func.sum(case((StaffAttendance.status.in_(("present", "late", "half_day")), 1), else_=0)), func.count())
            .where(*att_where)
            .group_by(StaffAttendance.staff_id)
        )
    }
    return [
        {
            "teacher_id": tid, "name": name or "", "periods_per_week": int(periods.get(tid) or 0),
            "subjects": int(subjects.get(tid) or 0), "classes": int(classes.get(tid) or 0),
            "homework_set": int(homework.get(tid) or 0), "ungraded": int(backlog.get(tid) or 0),
            "meetings": int(meetings.get(tid) or 0), "leave_days": int(leave.get(tid) or 0),
            "attendance_rate": attendance.get(tid),
        }  # fmt: skip
        for tid, name in teachers
    ]
