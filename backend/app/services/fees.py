"""Fee plans: billing instalments as legacy invoices, late fines and due reminders.

Generated invoices are ordinary `invoice` rows, so cash, Stripe and PayPal payments
work on them unchanged; `fee_invoice` links each one to its plan instalment.
"""

import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import BackgroundTasks
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import (
    Enroll,
    FeeDiscount,
    FeeHead,
    FeeInstalment,
    FeeInvoice,
    FeePlan,
    FeePlanItem,
    Invoice,
    Parent,
    Student,
)
from app.services.invoices import refresh_status
from app.services.notifications import notify, user
from app.services.settings import get_setting
from app.utils.money import fmt, num


def plan_total(db: Session, plan_id: int) -> int:
    return sum(db.scalars(select(FeePlanItem.amount).where(FeePlanItem.fee_plan_id == plan_id)))


def instalment_amount(total: int, share: Decimal | float) -> int:
    return round(total * float(share) / 100)


def discounted(db: Session, plan: FeePlan, student_id: int, base: int, share: Decimal | float) -> int:
    """`base` less the student's discounts for this plan's year. Percent discounts apply to
    the instalment; amount discounts are for the whole plan, spread by the instalment's share."""
    rows = db.scalars(
        select(FeeDiscount).where(
            FeeDiscount.student_id == student_id,
            FeeDiscount.year == plan.year,
            or_(FeeDiscount.fee_plan_id.is_(None), FeeDiscount.fee_plan_id == plan.fee_plan_id),
        )
    )
    percent = amount = 0.0
    for d in rows:
        if d.kind == "percent":
            percent += float(d.value)
        else:
            amount += float(d.value)
    reduced = base * (1 - min(percent, 100) / 100) - amount * float(share) / 100
    return max(round(reduced), 0)


@dataclass
class GenerateResult:
    created: int = 0
    skipped: int = 0  # already billed
    waived: int = 0  # discounts cover the whole amount


def generate_invoices(db: Session, plan: FeePlan, instalment: FeeInstalment) -> GenerateResult:
    """Bill `instalment` to every student enrolled in the plan's class and year. Safe to run again:
    students who already have an invoice for it are skipped. The caller commits."""
    total = plan_total(db, plan.fee_plan_id)
    base = instalment_amount(total, instalment.share_percent)
    heads = dict(db.execute(select(FeeHead.fee_head_id, FeeHead.name)).all())
    items = db.scalars(select(FeePlanItem).where(FeePlanItem.fee_plan_id == plan.fee_plan_id).order_by(FeePlanItem.fee_plan_item_id))
    description = "\n".join(
        f"{heads.get(i.fee_head_id, 'Fee')}: {fmt(instalment_amount(i.amount, instalment.share_percent))}" for i in items
    ) + f"\nDue {instalment.due_date.isoformat()}"
    billed = set(db.scalars(select(FeeInvoice.student_id).where(FeeInvoice.fee_instalment_id == instalment.fee_instalment_id)))
    students = db.scalars(
        select(Enroll.student_id).where(Enroll.class_id == plan.class_id, Enroll.year == plan.year).distinct()
    )
    now = int(time.time())
    result = GenerateResult()
    for student_id in students:
        if student_id is None:
            continue
        if student_id in billed:
            result.skipped += 1
            continue
        amount = discounted(db, plan, student_id, base, instalment.share_percent)
        if amount <= 0:
            result.waived += 1
            continue
        inv = Invoice(
            student_id=student_id, title=f"{plan.name} – {instalment.name}", description=description,
            amount=amount, amount_paid="0", creation_timestamp=now, year=plan.year,
        )  # fmt: skip
        refresh_status(inv)
        db.add(inv)
        db.flush()
        db.add(
            FeeInvoice(
                invoice_id=inv.invoice_id, fee_plan_id=plan.fee_plan_id, fee_instalment_id=instalment.fee_instalment_id,
                student_id=student_id, base_amount=amount, fine_amount=0,
            )  # fmt: skip
        )
        billed.add(student_id)
        result.created += 1
    return result


def _open_fee_invoices(db: Session):
    return db.execute(
        select(FeeInvoice, Invoice, FeeInstalment, FeePlan)
        .join(Invoice, Invoice.invoice_id == FeeInvoice.invoice_id)
        .join(FeeInstalment, FeeInstalment.fee_instalment_id == FeeInvoice.fee_instalment_id)
        .join(FeePlan, FeePlan.fee_plan_id == FeeInvoice.fee_plan_id)
        .where(Invoice.status != "paid")
    ).all()


def fine_for(plan: FeePlan, due_date: date, today: date) -> int:
    late_from = due_date + timedelta(days=plan.grace_days or 0)
    if today <= late_from or plan.late_fine_type == "none":
        return 0
    if plan.late_fine_type == "flat":
        return plan.late_fine_amount
    return plan.late_fine_amount * (today - late_from).days


def apply_late_fines(db: Session, today: date) -> int:
    """Set the late fine on every unpaid fee invoice. Fines are recalculated from the base amount,
    so running this again on the same day changes nothing. Returns how many invoices changed.
    The caller commits. Paid invoices keep the fine they had."""
    changed = 0
    for link, inv, instalment, plan in _open_fee_invoices(db):
        fine = fine_for(plan, instalment.due_date, today)
        if fine == link.fine_amount:
            continue
        link.fine_amount = fine
        inv.amount = link.base_amount + fine
        refresh_status(inv)
        changed += 1
    return changed


def send_due_reminders(db: Session, tasks: BackgroundTasks, today: date, days_before: int = 3) -> int:
    """Remind parents (and students with an email) of unpaid fee invoices due within `days_before`
    days or already overdue, at most once per invoice per day. Returns how many invoices were
    reminded. The caller commits."""
    school = get_setting(db, "system_name", "School")
    currency = get_setting(db, "currency").upper()
    reminded = 0
    for link, inv, instalment, _plan in _open_fee_invoices(db):
        if instalment.due_date > today + timedelta(days=days_before) or link.last_reminded_on == today:
            continue
        student = db.get(Student, link.student_id)
        if student is None:
            continue
        parent = db.get(Parent, student.parent_id) if student.parent_id else None
        due = fmt(num(inv.due) if inv.due not in (None, "") else num(inv.amount) - num(inv.amount_paid))
        when = "was due" if instalment.due_date < today else "is due"
        text = f"{student.name}: {inv.title} ({due} {currency}) {when} on {instalment.due_date.strftime('%d %b %Y')}."
        mail = {"email_subject": f"Fee reminder: {inv.title}", "email_body": f"{text}\n\nPlease pay at the school office or online.\n\n{school}"}
        title = f"Fee reminder: {inv.title}"
        if parent is not None:
            notify(db, tasks, [user("parent", parent.parent_id)], "fees", title, text, "/app/my-invoices", commit=False, **mail)
        # students were emailed (never texted) before preferences existed, and only when the
        # address differs from the parent's
        same_email = parent is not None and (parent.email or "").strip().lower() == (student.email or "").strip().lower()
        student_defaults = {"push"} if same_email else {"email", "push"}
        notify(
            db, tasks, [user("student", student.student_id)], "fees", title, text, "/app/my-invoices",
            commit=False, defaults=student_defaults, **mail,
        )  # fmt: skip
        link.last_reminded_on = today
        reminded += 1
    return reminded


def school_today() -> date:
    return datetime.now(ZoneInfo(get_settings().school_timezone)).date()


def run_daily_jobs(db: Session, tasks: BackgroundTasks, today: date | None = None) -> dict[str, int]:
    """Late fines, then reminders (so reminders quote the fined amount)."""
    today = today or school_today()
    fines = apply_late_fines(db, today)
    db.commit()
    reminders = send_due_reminders(db, tasks, today)
    db.commit()
    return {"fines_updated": fines, "reminders_sent": reminders}
