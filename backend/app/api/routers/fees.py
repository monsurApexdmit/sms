"""Fee structure: fee heads, plans per class and year with instalments, discounts and
scholarships, invoice generation, late fines, reminders and payment receipts."""

import datetime as dt
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.crud import crud_router, get_or_404
from app.core.deps import DB, Me, forbid, require_roles
from app.models import (
    FeeDiscount,
    FeeHead,
    FeeInstalment,
    FeeInvoice,
    FeePlan,
    FeePlanItem,
    Invoice,
    Payment,
    SchoolClass,
    Section,
    Student,
)
from app.services.access import children_ids, current_enroll
from app.services.fees import generate_invoices, instalment_amount, plan_total, run_daily_jobs
from app.services.invoices import num
from app.services.settings import get_setting
from app.services.years import valid_year_name

router = APIRouter(tags=["fees"])
FIN = ("admin", "accountant")
fin = [Depends(require_roles(*FIN))]


class FeeHeadIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)


router.include_router(
    crud_router(
        path="/fee-heads", model=FeeHead, schema_in=FeeHeadIn, read_roles=FIN, write_roles=FIN,
        order_by=FeeHead.name, label="Fee head",
    )  # fmt: skip
)


# --- plans --------------------------------------------------------------------------


class PlanItemIn(BaseModel):
    fee_head_id: int
    amount: int = Field(gt=0)


class InstalmentIn(BaseModel):
    fee_instalment_id: int | None = None  # set to keep an existing instalment
    name: str = Field(min_length=1, max_length=100)
    due_date: dt.date
    share_percent: Decimal = Field(gt=0, le=100, max_digits=5, decimal_places=2)


class PlanIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    class_id: int
    year: str
    late_fine_type: Literal["none", "flat", "per_day"] = "none"
    late_fine_amount: int = Field(default=0, ge=0)
    grace_days: int = Field(default=0, ge=0, le=365)
    items: list[PlanItemIn] = Field(min_length=1)
    instalments: list[InstalmentIn] = Field(min_length=1)

    @field_validator("year")
    @classmethod
    def check_year(cls, v: str) -> str:
        if not valid_year_name(v):
            raise ValueError("year must look like 2025-2026")
        return v

    @model_validator(mode="after")
    def check_plan(self):
        if sum(i.share_percent for i in self.instalments) != 100:
            raise ValueError("Instalment shares must add up to 100%")
        if len({i.fee_head_id for i in self.items}) != len(self.items):
            raise ValueError("Each fee head can appear only once in a plan")
        if self.late_fine_type != "none" and self.late_fine_amount <= 0:
            raise ValueError("Set a late fine amount, or choose no late fine")
        return self


class InstalmentOut(BaseModel):
    fee_instalment_id: int
    name: str
    due_date: dt.date
    share_percent: float
    amount: int
    invoices: int


class PlanOut(BaseModel):
    fee_plan_id: int
    name: str
    class_id: int
    class_name: str | None
    year: str
    late_fine_type: str
    late_fine_amount: int
    grace_days: int
    total: int
    items: list[dict]
    instalments: list[InstalmentOut]


def _plan_out(db: Session, plan: FeePlan) -> PlanOut:
    heads = dict(db.execute(select(FeeHead.fee_head_id, FeeHead.name)).all())
    items = list(db.scalars(select(FeePlanItem).where(FeePlanItem.fee_plan_id == plan.fee_plan_id).order_by(FeePlanItem.fee_plan_item_id)))
    total = sum(i.amount for i in items)
    counts = dict(
        db.execute(
            select(FeeInvoice.fee_instalment_id, func.count())
            .where(FeeInvoice.fee_plan_id == plan.fee_plan_id)
            .group_by(FeeInvoice.fee_instalment_id)
        ).all()
    )
    instalments = db.scalars(
        select(FeeInstalment).where(FeeInstalment.fee_plan_id == plan.fee_plan_id).order_by(FeeInstalment.due_date, FeeInstalment.fee_instalment_id)
    )
    school_class = db.get(SchoolClass, plan.class_id)
    return PlanOut(
        fee_plan_id=plan.fee_plan_id, name=plan.name, class_id=plan.class_id,
        class_name=school_class.name if school_class else None, year=plan.year,
        late_fine_type=plan.late_fine_type, late_fine_amount=plan.late_fine_amount, grace_days=plan.grace_days, total=total,
        items=[{"fee_head_id": i.fee_head_id, "head": heads.get(i.fee_head_id), "amount": i.amount} for i in items],
        instalments=[
            InstalmentOut(
                fee_instalment_id=i.fee_instalment_id, name=i.name, due_date=i.due_date, share_percent=float(i.share_percent),
                amount=instalment_amount(total, i.share_percent), invoices=counts.get(i.fee_instalment_id, 0),
            )  # fmt: skip
            for i in instalments
        ],
    )  # fmt: skip


def _billed(db: Session, **where) -> bool:
    stmt = select(func.count()).select_from(FeeInvoice)
    for column, value in where.items():
        stmt = stmt.where(getattr(FeeInvoice, column) == value)
    return (db.scalar(stmt) or 0) > 0


def _save_plan(db: Session, plan: FeePlan, body: PlanIn) -> None:
    if db.get(SchoolClass, body.class_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown class")
    known_heads = set(db.scalars(select(FeeHead.fee_head_id)))
    if any(i.fee_head_id not in known_heads for i in body.items):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown fee head")
    for key in ("name", "class_id", "year", "late_fine_type", "late_fine_amount", "grace_days"):
        setattr(plan, key, getattr(body, key))
    if plan.fee_plan_id is None:
        db.add(plan)
        db.flush()

    db.query(FeePlanItem).filter(FeePlanItem.fee_plan_id == plan.fee_plan_id).delete()
    db.add_all(FeePlanItem(fee_plan_id=plan.fee_plan_id, fee_head_id=i.fee_head_id, amount=i.amount) for i in body.items)

    existing = {i.fee_instalment_id: i for i in db.scalars(select(FeeInstalment).where(FeeInstalment.fee_plan_id == plan.fee_plan_id))}
    keep = {i.fee_instalment_id for i in body.instalments if i.fee_instalment_id}
    if keep - existing.keys():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown instalment")
    for old_id, old in existing.items():
        if old_id not in keep:
            if _billed(db, fee_instalment_id=old_id):
                raise HTTPException(status.HTTP_409_CONFLICT, f"Invoices were already generated for {old.name}; it cannot be removed")
            db.delete(old)
    for i in body.instalments:
        row = existing.get(i.fee_instalment_id) if i.fee_instalment_id else None
        if row is None:
            db.add(FeeInstalment(fee_plan_id=plan.fee_plan_id, name=i.name, due_date=i.due_date, share_percent=i.share_percent))
        else:
            row.name, row.due_date, row.share_percent = i.name, i.due_date, i.share_percent


@router.get("/fee-plans", response_model=list[PlanOut], dependencies=fin)
def list_plans(db: DB, year: str | None = None, class_id: int | None = None):
    stmt = select(FeePlan)
    if year:
        stmt = stmt.where(FeePlan.year == year)
    if class_id:
        stmt = stmt.where(FeePlan.class_id == class_id)
    return [_plan_out(db, p) for p in db.scalars(stmt.order_by(FeePlan.year.desc(), FeePlan.class_id, FeePlan.name))]


@router.post("/fee-plans", response_model=PlanOut, status_code=201, dependencies=fin)
def create_plan(body: PlanIn, db: DB):
    plan = FeePlan()
    _save_plan(db, plan, body)
    db.commit()
    return _plan_out(db, plan)


@router.put("/fee-plans/{plan_id}", response_model=PlanOut, dependencies=fin)
def update_plan(plan_id: int, body: PlanIn, db: DB):
    """Replaces the plan's items and instalments. Invoices already generated keep their amounts."""
    plan = get_or_404(db, FeePlan, plan_id, "Fee plan")
    if (body.class_id != plan.class_id or body.year != plan.year) and _billed(db, fee_plan_id=plan_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Invoices were already generated; the class and year cannot change")
    _save_plan(db, plan, body)
    db.commit()
    return _plan_out(db, plan)


@router.delete("/fee-plans/{plan_id}", status_code=204, dependencies=fin)
def delete_plan(plan_id: int, db: DB):
    plan = get_or_404(db, FeePlan, plan_id, "Fee plan")
    if _billed(db, fee_plan_id=plan_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Invoices were already generated from this plan; it cannot be deleted")
    db.query(FeePlanItem).filter(FeePlanItem.fee_plan_id == plan_id).delete()
    db.query(FeeInstalment).filter(FeeInstalment.fee_plan_id == plan_id).delete()
    db.query(FeeDiscount).filter(FeeDiscount.fee_plan_id == plan_id).delete()
    db.delete(plan)
    db.commit()


class GenerateIn(BaseModel):
    fee_instalment_id: int


@router.post("/fee-plans/{plan_id}/generate", dependencies=fin)
def generate(plan_id: int, body: GenerateIn, db: DB):
    """Invoice the instalment to every student enrolled in the plan's class and year.
    Students who already have an invoice for it are skipped."""
    plan = get_or_404(db, FeePlan, plan_id, "Fee plan")
    instalment = db.get(FeeInstalment, body.fee_instalment_id)
    if instalment is None or instalment.fee_plan_id != plan_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Instalment not found")
    if plan_total(db, plan_id) <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The plan has no fees")
    result = generate_invoices(db, plan, instalment)
    db.commit()
    return {"created": result.created, "skipped": result.skipped, "waived": result.waived}


# --- discounts and scholarships -------------------------------------------------------


class DiscountIn(BaseModel):
    student_id: int
    fee_plan_id: int | None = None
    year: str
    kind: Literal["percent", "amount"]
    value: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    reason: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def check(self):
        if not valid_year_name(self.year):
            raise ValueError("year must look like 2025-2026")
        if self.kind == "percent" and self.value > 100:
            raise ValueError("A percent discount can be at most 100")
        return self


class DiscountOut(BaseModel):
    fee_discount_id: int
    student_id: int
    student_name: str | None
    fee_plan_id: int | None
    plan_name: str | None
    year: str
    kind: str
    value: float
    reason: str | None


def _discount_out(db: Session, rows: list[FeeDiscount]) -> list[DiscountOut]:
    names = dict(db.execute(select(Student.student_id, Student.name).where(Student.student_id.in_({r.student_id for r in rows}))).all()) if rows else {}
    plans = dict(db.execute(select(FeePlan.fee_plan_id, FeePlan.name)).all()) if rows else {}
    return [
        DiscountOut(
            fee_discount_id=r.fee_discount_id, student_id=r.student_id, student_name=names.get(r.student_id),
            fee_plan_id=r.fee_plan_id, plan_name=plans.get(r.fee_plan_id) if r.fee_plan_id else None,
            year=r.year, kind=r.kind, value=float(r.value), reason=r.reason,
        )  # fmt: skip
        for r in rows
    ]


def _check_discount(db: Session, body: DiscountIn) -> None:
    if db.get(Student, body.student_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown student")
    if body.fee_plan_id is not None and db.get(FeePlan, body.fee_plan_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown fee plan")


@router.get("/fee-discounts", response_model=list[DiscountOut], dependencies=fin)
def list_discounts(db: DB, year: str | None = None, student_id: int | None = None):
    stmt = select(FeeDiscount)
    if year:
        stmt = stmt.where(FeeDiscount.year == year)
    if student_id:
        stmt = stmt.where(FeeDiscount.student_id == student_id)
    return _discount_out(db, list(db.scalars(stmt.order_by(FeeDiscount.fee_discount_id.desc()))))


@router.post("/fee-discounts", response_model=DiscountOut, status_code=201, dependencies=fin)
def create_discount(body: DiscountIn, db: DB):
    """Applies to invoices generated after it is saved; existing invoices keep their amounts."""
    _check_discount(db, body)
    row = FeeDiscount(**body.model_dump())
    db.add(row)
    db.commit()
    return _discount_out(db, [row])[0]


@router.put("/fee-discounts/{discount_id}", response_model=DiscountOut, dependencies=fin)
def update_discount(discount_id: int, body: DiscountIn, db: DB):
    row = get_or_404(db, FeeDiscount, discount_id, "Discount")
    _check_discount(db, body)
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    db.commit()
    return _discount_out(db, [row])[0]


@router.delete("/fee-discounts/{discount_id}", status_code=204, dependencies=fin)
def delete_discount(discount_id: int, db: DB):
    db.delete(get_or_404(db, FeeDiscount, discount_id, "Discount"))
    db.commit()


# --- daily jobs ----------------------------------------------------------------------


@router.post("/fees/daily-jobs", dependencies=[Depends(require_roles("admin"))])
def daily_jobs(tasks: BackgroundTasks, db: DB):
    """Apply late fines and send due reminders now (the scheduler also runs this once a day)."""
    return run_daily_jobs(db, tasks)


# --- receipts -------------------------------------------------------------------------


@router.get("/payments/{payment_id}/receipt")
def receipt(payment_id: int, user: Me, db: DB):
    """Everything a printed receipt shows. Staff see any receipt; students their own; parents their children's."""
    payment = get_or_404(db, Payment, payment_id, "Payment")
    if payment.payment_type != "income":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    allowed = (
        user.role in FIN
        or (user.role == "student" and payment.student_id == user.id)
        or (user.role == "parent" and payment.student_id in children_ids(db, user.id))
    )
    if not allowed:
        raise forbid()
    student = db.get(Student, payment.student_id) if payment.student_id else None
    inv = db.get(Invoice, payment.invoice_id) if payment.invoice_id else None
    enroll = current_enroll(db, payment.student_id, payment.year) if payment.student_id else None
    school_class = db.get(SchoolClass, enroll.class_id) if enroll and enroll.class_id else None
    section = db.get(Section, enroll.section_id) if enroll and enroll.section_id else None
    return {
        "school": {key: get_setting(db, key) for key in ("system_name", "address", "phone", "system_email")},
        "currency": get_setting(db, "currency", "usd"),
        "payment_id": payment.payment_id,
        "title": payment.title,
        "amount": num(payment.amount),
        "method": payment.method,
        "timestamp": payment.timestamp,
        "description": payment.description,
        "year": payment.year,
        "student": {"student_id": student.student_id, "name": student.name, "student_code": student.student_code} if student else None,
        "class_name": school_class.name if school_class else None,
        "section_name": section.name if section else None,
        "roll": enroll.roll if enroll else None,
        "invoice": (
            {"invoice_id": inv.invoice_id, "title": inv.title, "amount": num(inv.amount), "amount_paid": num(inv.amount_paid), "due": num(inv.due)}
            if inv else None
        ),  # fmt: skip
    }
