import calendar
import logging
import time
import datetime as dt
from datetime import date

import stripe
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import BigInteger, Numeric, case, cast, func, or_, select
from sqlalchemy.orm import Session

from app.api.crud import Page, crud_router, get_or_404, out_schema
from app.core.config import get_settings
from app.core.deps import DB, CurrentUser, Me, forbid, not_found, require_roles
from app.models import ExpenseCategory, FeeInvoice, Invoice, Payment, Student
from app.services.access import children_ids
from app.services.invoices import fmt as _fmt
from app.services.invoices import num as _num
from app.services.invoices import refresh_status as _refresh_status
from app.services.paypal import (
    PayPalClient,
    PayPalError,
    approve_link,
    completed_capture,
    format_amount,
    order_invoice_id,
)
from app.services.settings import get_setting, paypal_credentials, running_year, stripe_secret

log = logging.getLogger("payments")
router = APIRouter(tags=["finance"])
FIN = ("admin", "accountant")
fin = [Depends(require_roles(*FIN))]


class ExpenseCategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


router.include_router(
    crud_router(
        path="/expense-categories", model=ExpenseCategory, schema_in=ExpenseCategoryIn,
        read_roles=FIN, write_roles=FIN, order_by=ExpenseCategory.name, label="Expense category",
    )  # fmt: skip
)


def _ts(d: date | None) -> int:
    return calendar.timegm(d.timetuple()) if d else int(time.time())


# --- invoices -----------------------------------------------------------------

InvoiceBase = out_schema(Invoice)
PaymentBase = out_schema(Payment)


class InvoiceOut(InvoiceBase):  # type: ignore[misc,valid-type]
    student_name: str | None = None


class InvoiceDetail(InvoiceOut):
    payments: list[PaymentBase] = []  # type: ignore[valid-type]


class InvoiceIn(BaseModel):
    student_id: int
    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    amount: int = Field(gt=0)
    amount_paid: float = Field(default=0, ge=0)
    method: str | None = Field(default="cash", max_length=50)
    date: dt.date | None = None


class MassInvoiceIn(InvoiceIn):
    student_id: int | None = None  # type: ignore[assignment]
    student_ids: list[int] = Field(min_length=1)


class InvoiceUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    amount: int = Field(gt=0)


class PaymentIn(BaseModel):
    amount: float = Field(gt=0)
    method: str = Field(default="cash", max_length=50)
    date: dt.date | None = None
    description: str | None = None


def _invoice_out(db: Session, rows: list[Invoice]) -> list[InvoiceOut]:
    ids = {r.student_id for r in rows if r.student_id}
    names = (
        dict(db.execute(select(Student.student_id, Student.name).where(Student.student_id.in_(ids))).all())
        if ids
        else {}
    )
    return [InvoiceOut(**InvoiceBase.model_validate(r).model_dump(), student_name=names.get(r.student_id)) for r in rows]


def _record_payment(
    db: Session, inv: Invoice, amount: float, method: str, when: int, description: str | None = None
) -> Payment:
    payment = Payment(
        invoice_id=inv.invoice_id,
        student_id=inv.student_id,
        title=inv.title,
        payment_type="income",
        method=method,
        amount=_fmt(amount),
        timestamp=str(when),
        year=inv.year,
        description=description,
    )
    db.add(payment)
    inv.amount_paid = _fmt(_num(inv.amount_paid) + amount)
    inv.payment_timestamp = str(when)
    inv.payment_method = method
    _refresh_status(inv)
    return payment


def _create_invoice(db: Session, body: InvoiceIn, student_id: int) -> Invoice:
    when = _ts(body.date)
    inv = Invoice(
        student_id=student_id,
        title=body.title,
        description=body.description,
        amount=body.amount,
        amount_paid="0",
        creation_timestamp=when,
        year=running_year(db),
    )
    _refresh_status(inv)
    db.add(inv)
    db.flush()
    if body.amount_paid > 0:
        _record_payment(db, inv, min(body.amount_paid, body.amount), body.method or "cash", when)
    return inv


def _ensure_invoice_access(db: Session, user: CurrentUser, inv: Invoice) -> None:
    if user.role in FIN:
        return
    if user.role == "student" and inv.student_id == user.id:
        return
    if user.role == "parent" and inv.student_id in children_ids(db, user.id):
        return
    raise forbid()


class InvoiceSummary(BaseModel):
    billed: float
    collected: float
    outstanding: float
    open: int
    partial: int


class InvoicePage(Page):
    summary: InvoiceSummary


def _money_sum(column):
    # amounts are stored as text in the legacy schema
    return func.coalesce(func.sum(cast(column, Numeric(14, 2))), 0)


@router.get("/invoices", response_model=InvoicePage, dependencies=fin)
def list_invoices(
    db: DB,
    student_id: int | None = None,
    status_: str | None = Query(None, alias="status"),
    year: str | None = None,
    q: str | None = Query(None, max_length=100, description="Invoice number, title or student name"),
    limit: int = Query(100, ge=1, le=2000),
    offset: int = Query(0, ge=0),
):
    """One page of invoices; `total` and `summary` cover every invoice matching the filters."""
    stmt = select(Invoice)
    if student_id:
        stmt = stmt.where(Invoice.student_id == student_id)
    if status_:
        stmt = stmt.where(Invoice.status == status_)
    if year:
        stmt = stmt.where(Invoice.year == year)
    if q and q.strip():
        term = q.strip()
        like = f"%{term}%"
        matches = [Invoice.title.like(like), Invoice.student_id.in_(select(Student.student_id).where(Student.name.like(like)))]
        if term.isdigit():
            matches.append(Invoice.invoice_id == int(term))
        stmt = stmt.where(or_(*matches))
    sub = stmt.subquery()
    open_ = sub.c.status != "paid"
    billed, collected, outstanding, total, open_count, partial = db.execute(
        select(
            _money_sum(sub.c.amount),
            _money_sum(sub.c.amount_paid),
            _money_sum(sub.c.due),
            func.count(),
            func.count(case((open_, 1))),
            func.count(case((open_ & (cast(sub.c.amount_paid, Numeric(14, 2)) > 0), 1))),
        )
    ).one()
    rows = list(db.scalars(stmt.order_by(Invoice.invoice_id.desc()).limit(limit).offset(offset)))
    summary = InvoiceSummary(
        billed=float(billed), collected=float(collected), outstanding=float(outstanding), open=open_count, partial=partial
    )
    return InvoicePage(items=_invoice_out(db, rows), total=total, summary=summary)


@router.get("/invoices/mine", response_model=list[InvoiceOut], dependencies=[Depends(require_roles("student", "parent"))])
def my_invoices(user: Me, db: DB):
    ids = [user.id] if user.role == "student" else children_ids(db, user.id)
    if not ids:
        return []
    rows = list(db.scalars(select(Invoice).where(Invoice.student_id.in_(ids)).order_by(Invoice.invoice_id.desc())))
    return _invoice_out(db, rows)


@router.get("/invoices/{invoice_id}", response_model=InvoiceDetail)
def get_invoice(invoice_id: int, user: Me, db: DB):
    inv = get_or_404(db, Invoice, invoice_id, "Invoice")
    _ensure_invoice_access(db, user, inv)
    payments = db.scalars(select(Payment).where(Payment.invoice_id == invoice_id).order_by(Payment.payment_id))
    base = _invoice_out(db, [inv])[0].model_dump()
    return InvoiceDetail(**base, payments=[PaymentBase.model_validate(p) for p in payments])


@router.post("/invoices", response_model=InvoiceOut, status_code=201, dependencies=fin)
def create_invoice(body: InvoiceIn, db: DB):
    get_or_404(db, Student, body.student_id, "Student")
    inv = _create_invoice(db, body, body.student_id)
    db.commit()
    return _invoice_out(db, [inv])[0]


@router.post("/invoices/mass", status_code=201, dependencies=fin)
def create_mass_invoice(body: MassInvoiceIn, db: DB):
    for sid in body.student_ids:
        _create_invoice(db, body, sid)
    db.commit()
    return {"created": len(body.student_ids)}


@router.put("/invoices/{invoice_id}", response_model=InvoiceOut, dependencies=fin)
def update_invoice(invoice_id: int, body: InvoiceUpdate, db: DB):
    inv = get_or_404(db, Invoice, invoice_id, "Invoice")
    inv.title, inv.description, inv.amount = body.title, body.description, body.amount
    link = db.scalars(select(FeeInvoice).where(FeeInvoice.invoice_id == invoice_id)).first()
    if link is not None:
        # a manual amount change becomes the new base; late fines are added on top of it
        link.base_amount = max(body.amount - link.fine_amount, 0)
    _refresh_status(inv)
    db.commit()
    return _invoice_out(db, [inv])[0]


@router.delete("/invoices/{invoice_id}", status_code=204, dependencies=fin)
def delete_invoice(invoice_id: int, db: DB):
    inv = get_or_404(db, Invoice, invoice_id, "Invoice")
    db.query(Payment).filter(Payment.invoice_id == invoice_id).delete()
    db.query(FeeInvoice).filter(FeeInvoice.invoice_id == invoice_id).delete()
    db.delete(inv)
    db.commit()


@router.post("/invoices/{invoice_id}/payments", response_model=InvoiceOut, dependencies=fin)
def take_payment(invoice_id: int, body: PaymentIn, db: DB):
    inv = get_or_404(db, Invoice, invoice_id, "Invoice")
    due = _num(inv.due) if inv.due not in (None, "") else _num(inv.amount) - _num(inv.amount_paid)
    if body.amount > due + 0.001:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Amount is larger than the due ({_fmt(due)})")
    _record_payment(db, inv, body.amount, body.method, _ts(body.date), body.description)
    db.commit()
    return _invoice_out(db, [inv])[0]


# --- payments & expenses ------------------------------------------------------


class PaymentOut(PaymentBase):  # type: ignore[misc,valid-type]
    student_name: str | None = None
    category_name: str | None = None


class ExpenseIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    expense_category_id: int | None = None
    amount: float = Field(gt=0)
    method: str = Field(default="cash", max_length=50)
    date: dt.date | None = None
    description: str | None = None


class PaymentPage(Page):
    amount_total: float


@router.get("/payments", response_model=PaymentPage, dependencies=fin)
def list_payments(
    db: DB,
    payment_type: str | None = Query(None, pattern="^(income|expense)$"),
    year: str | None = None,
    student_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(200, ge=1, le=5000),
    offset: int = Query(0, ge=0),
):
    """One page of payments; `total` and `amount_total` cover every payment matching the filters."""
    stmt = select(Payment)
    if payment_type:
        stmt = stmt.where(Payment.payment_type == payment_type)
    if year:
        stmt = stmt.where(Payment.year == year)
    if student_id:
        stmt = stmt.where(Payment.student_id == student_id)
    if date_from or date_to:
        # unix timestamps stored as text; blank or non-numeric ones cast to 0 and fall outside the range
        when = cast(Payment.timestamp, BigInteger)
        stmt = stmt.where(when >= (_ts(date_from) if date_from else 1))
        if date_to:
            stmt = stmt.where(when < _ts(date_to) + 86400)
    sub = stmt.subquery()
    total, amount_total = db.execute(select(func.count(), _money_sum(sub.c.amount))).one()
    rows = list(db.scalars(stmt.order_by(Payment.payment_id.desc()).limit(limit).offset(offset)))
    ids = {r.student_id for r in rows if r.student_id}
    students = dict(db.execute(select(Student.student_id, Student.name).where(Student.student_id.in_(ids))).all()) if ids else {}
    cats = dict(db.execute(select(ExpenseCategory.expense_category_id, ExpenseCategory.name)).all())
    items = [
        PaymentOut(
            **PaymentBase.model_validate(r).model_dump(),
            student_name=students.get(r.student_id),
            category_name=cats.get(r.expense_category_id),
        )
        for r in rows
    ]
    return PaymentPage(items=items, total=total, amount_total=float(amount_total))


def _apply_expense(row: Payment, body: ExpenseIn) -> None:
    row.title = body.title
    row.expense_category_id = body.expense_category_id
    row.amount = _fmt(body.amount)
    row.method = body.method
    row.timestamp = str(_ts(body.date))
    row.description = body.description


@router.post("/expenses", response_model=PaymentOut, status_code=201, dependencies=fin)
def create_expense(body: ExpenseIn, db: DB):
    row = Payment(payment_type="expense", year=running_year(db))
    _apply_expense(row, body)
    db.add(row)
    db.commit()
    db.refresh(row)
    return PaymentOut(**PaymentBase.model_validate(row).model_dump())


@router.put("/expenses/{payment_id}", response_model=PaymentOut, dependencies=fin)
def update_expense(payment_id: int, body: ExpenseIn, db: DB):
    row = get_or_404(db, Payment, payment_id, "Expense")
    if row.payment_type != "expense":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not an expense")
    _apply_expense(row, body)
    db.commit()
    return PaymentOut(**PaymentBase.model_validate(row).model_dump())


@router.delete("/expenses/{payment_id}", status_code=204, dependencies=fin)
def delete_expense(payment_id: int, db: DB):
    row = get_or_404(db, Payment, payment_id, "Expense")
    if row.payment_type != "expense":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not an expense")
    db.delete(row)
    db.commit()


@router.get("/finance/summary", dependencies=fin)
def summary(db: DB, year: str | None = None):
    year = year or running_year(db)
    totals = {"income": 0.0, "expense": 0.0}
    monthly: dict[str, dict[str, float]] = {}
    for p in db.scalars(select(Payment).where(Payment.year == year)):
        kind = p.payment_type if p.payment_type in totals else None
        if not kind:
            continue
        amount = _num(p.amount)
        totals[kind] += amount
        if p.timestamp and p.timestamp.isdigit():
            key = time.strftime("%Y-%m", time.gmtime(int(p.timestamp)))
            monthly.setdefault(key, {"income": 0.0, "expense": 0.0})[kind] += amount
    unpaid = db.scalars(select(Invoice).where(Invoice.year == year, Invoice.status != "paid")).all()
    return {
        "year": year,
        "currency": get_setting(db, "currency", "usd"),
        "income": round(totals["income"], 2),
        "expense": round(totals["expense"], 2),
        "balance": round(totals["income"] - totals["expense"], 2),
        "unpaid_invoices": len(unpaid),
        "outstanding_due": round(sum(_num(i.due) for i in unpaid), 2),
        "monthly": [{"month": k, **v} for k, v in sorted(monthly.items())],
    }


# --- Stripe -------------------------------------------------------------------


@router.post("/invoices/{invoice_id}/stripe-checkout")
def stripe_checkout(invoice_id: int, user: Me, db: DB):
    inv = get_or_404(db, Invoice, invoice_id, "Invoice")
    _ensure_invoice_access(db, user, inv)
    secret = stripe_secret(db)
    if not secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Online card payment is not enabled")
    due = _num(inv.due)
    if due <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invoice is already paid")
    front = get_settings().frontend_url
    session = stripe.checkout.Session.create(
        api_key=secret,
        mode="payment",
        line_items=[
            {
                "quantity": 1,
                "price_data": {
                    "currency": get_setting(db, "currency", "usd").lower(),
                    "unit_amount": round(due * 100),
                    "product_data": {"name": inv.title or f"Invoice #{invoice_id}"},
                },
            }
        ],
        metadata={"invoice_id": str(invoice_id)},
        success_url=f"{front}/app/my-invoices?paid={invoice_id}",
        cancel_url=f"{front}/app/my-invoices",
    )
    return {"url": session.url}


@router.post("/payments/stripe/webhook", include_in_schema=False)
async def stripe_webhook(request: Request, db: DB):
    """Invoices are only marked paid from Stripe's signed webhook, never from the browser."""
    secret = get_settings().stripe_webhook_secret
    if not secret:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Webhook secret not configured")
    try:
        event = stripe.Webhook.construct_event(
            await request.body(), request.headers.get("stripe-signature", ""), secret
        )
    except (ValueError, stripe.SignatureVerificationError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid signature") from None
    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        ref = f"stripe:{session['id']}"
        already = db.scalar(select(func.count()).select_from(Payment).where(Payment.description == ref))
        invoice_id = int(session.get("metadata", {}).get("invoice_id", 0) or 0)
        inv = db.get(Invoice, invoice_id) if invoice_id else None
        if inv is not None and not already and session.get("payment_status") == "paid":
            _record_payment(db, inv, session["amount_total"] / 100, "stripe", int(time.time()), ref)
            db.commit()
    return {"received": True}


# --- PayPal -------------------------------------------------------------------

payers = [Depends(require_roles("student", "parent"))]


class PayPalCaptureIn(BaseModel):
    order_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9-]+$")


def _paypal(db: Session) -> PayPalClient:
    creds = paypal_credentials(db)
    if creds is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "PayPal payment is not enabled")
    return PayPalClient(*creds)


def _outstanding(inv: Invoice) -> float:
    return round(max(_num(inv.amount) - _num(inv.amount_paid), 0), 2)


def _paypal_failed(exc: PayPalError) -> HTTPException:
    log.error("PayPal request failed: %s", exc)
    return HTTPException(status.HTTP_502_BAD_GATEWAY, "PayPal could not process the request. Please try again later.")


@router.post("/invoices/{invoice_id}/paypal-order", dependencies=payers)
def paypal_order(invoice_id: int, user: Me, db: DB):
    inv = get_or_404(db, Invoice, invoice_id, "Invoice")
    _ensure_invoice_access(db, user, inv)
    client = _paypal(db)
    due = _outstanding(inv)
    if due <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invoice is already paid")
    currency = get_setting(db, "currency", "usd").upper()
    front = get_settings().frontend_url
    try:
        order = client.create_order(
            invoice_id=invoice_id,
            title=inv.title or f"Invoice #{invoice_id}",
            amount=format_amount(due, currency),
            currency=currency,
            return_url=f"{front}/app/my-invoices?paypal=return",
            cancel_url=f"{front}/app/my-invoices?paypal=cancel",
            brand=get_setting(db, "system_name", "School"),
        )
    except PayPalError as exc:
        raise _paypal_failed(exc) from None
    url = approve_link(order)
    if not url:
        raise _paypal_failed(PayPalError(f"order {order.get('id')} has no approve link"))
    return {"approve_url": url}


@router.post("/payments/paypal/capture", dependencies=payers)
def paypal_capture(body: PayPalCaptureIn, user: Me, db: DB):
    """Captures an approved order and records it only after checking the invoice,
    the amount and the currency PayPal reports. Safe to call more than once."""
    client = _paypal(db)
    try:
        order = client.get_order(body.order_id)
        invoice_id = order_invoice_id(order)
        inv = db.get(Invoice, invoice_id) if invoice_id else None
        if inv is None:
            raise not_found("Invoice")
        _ensure_invoice_access(db, user, inv)
        if order.get("status") == "APPROVED":
            order = client.capture_order(body.order_id)
    except PayPalError as exc:
        raise _paypal_failed(exc) from None
    capture = completed_capture(order) if order.get("status") == "COMPLETED" else None
    if capture is None:
        return {"status": "pending", "invoice_id": inv.invoice_id}

    ref = f"paypal:{capture.get('id')}"
    if db.scalar(select(func.count()).select_from(Payment).where(Payment.description == ref)):
        return {"status": "paid", "invoice_id": inv.invoice_id}
    amount = capture.get("amount") or {}
    try:
        value = float(amount.get("value"))
    except (TypeError, ValueError):
        value = -1.0
    expected_currency = get_setting(db, "currency", "usd").upper()
    if amount.get("currency_code") != expected_currency or abs(value - _outstanding(inv)) > 0.005:
        log.error(
            "PayPal capture %s for invoice %s does not match: got %s %s, due %s %s",
            capture.get("id"), inv.invoice_id, amount.get("value"), amount.get("currency_code"),
            _outstanding(inv), expected_currency,
        )  # fmt: skip
        raise HTTPException(
            status.HTTP_409_CONFLICT, "The PayPal payment does not match the invoice due. Please contact the school office."
        )
    _record_payment(db, inv, value, "paypal", int(time.time()), ref)
    db.commit()
    return {"status": "paid", "invoice_id": inv.invoice_id}
