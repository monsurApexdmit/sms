"""bKash, Nagad and SSLCommerz checkout for students and parents.

Flow (all three): POST /invoices/{id}/<gateway>-checkout starts a payment for the amount
still due and returns the gateway page to send the browser to. The gateway sends the
browser back to a /return endpoint here, which only redirects to /app/my-invoices with
the reference; the page then calls the signed-in POST /payments/<gateway>/confirm, which
asks the gateway whether it was paid and records the payment once. SSLCommerz also calls
the IPN endpoint, which settles the same way. Nothing the browser sends is trusted.
"""

import logging
import re
import secrets
import time
from decimal import Decimal
from typing import Any, Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.crud import get_or_404
from app.api.deps import DB, CurrentUser, Me, not_found, require_roles
from app.api.v1.endpoints.finance import _ensure_invoice_access, _outstanding, _record_payment, payers
from app.core.config import get_settings
from app.models import GatewayTransaction, Invoice, Payment
from app.schemas.gateways import REF, ConfirmIn, GatewaySettingsIn
from app.services import local_gateways as gw
from app.services.accounts import get_account
from app.services.ratelimit import throttle
from app.services.settings import set_setting
from app.utils.dates import utc_now as _now

log = logging.getLogger("payments")
router = APIRouter(tags=["payment gateways"])
admin_only = [Depends(require_roles("admin"))]


def _front() -> str:
    return get_settings().frontend_url.rstrip("/")


def _failed(gateway: str, exc: gw.GatewayError) -> HTTPException:
    log.error("%s request failed: %s", gw.LABELS[gateway], exc)
    return HTTPException(
        status.HTTP_502_BAD_GATEWAY, f"{gw.LABELS[gateway]} could not process the request. Please try again later."
    )


def _credentials(db: Session, gateway: str) -> dict[str, str]:
    """Settings for confirming a payment already started: works even if the gateway was switched off meanwhile."""
    cfg = gw.get_config(db, gateway)
    if any(not cfg.get(k) for k in gw.FIELDS[gateway] if k not in ("active", "mode")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{gw.LABELS[gateway]} is not configured")
    cfg["mode"] = cfg.get("mode") if cfg.get("mode") in gw.MODES else "sandbox"
    return cfg


# --- settings -------------------------------------------------------------------------


def _all_settings(db: Session) -> dict:
    return {g: gw.masked_config(db, g) for g in gw.FIELDS} | {"currency_is_bdt": gw.bdt_currency(db)}


@router.get("/payment-gateways/settings", dependencies=admin_only)
def get_gateway_settings(db: DB):
    return _all_settings(db)


@router.put("/payment-gateways/settings", dependencies=admin_only)
def update_gateway_settings(body: GatewaySettingsIn, db: DB):
    for gateway, incoming in body.model_dump(exclude_none=True).items():
        try:
            set_setting(db, gateway, gw.merge_config(db, gateway, incoming))
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{gw.LABELS[gateway]}: {exc}") from None
    db.commit()
    return _all_settings(db)


# --- starting a payment ---------------------------------------------------------------


def _start(db: Session, user: CurrentUser, invoice_id: int, gateway: str) -> tuple[dict[str, str], Invoice, GatewayTransaction]:
    inv = get_or_404(db, Invoice, invoice_id, "Invoice")
    _ensure_invoice_access(db, user, inv)
    cfg = gw.enabled_config(db, gateway)
    if cfg is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{gw.LABELS[gateway]} payment is not enabled")
    due = _outstanding(inv)
    if due <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invoice is already paid")
    # alphanumeric only: Nagad's orderId accepts nothing else
    reference = f"INV{invoice_id}X{secrets.token_hex(5).upper()}"
    tx = GatewayTransaction(
        gateway=gateway, reference=reference, invoice_id=invoice_id, amount=Decimal(gw.money(due)), currency="BDT",
        status="pending", created_by=user.ref, created_at=_now(), updated_at=_now(),
    )  # fmt: skip
    db.add(tx)
    db.flush()
    return cfg, inv, tx


@router.post("/invoices/{invoice_id}/sslcommerz-checkout", dependencies=payers)
def sslcommerz_checkout(invoice_id: int, user: Me, db: DB):
    cfg, inv, tx = _start(db, user, invoice_id, "sslcommerz")
    account = get_account(db, user.role, user.id)
    back = f"{_front()}/api/payments/sslcommerz"
    try:
        url = gw.ssl_init(
            cfg, tran_id=tx.reference, amount=float(tx.amount),
            urls={"success": f"{back}/return/success", "fail": f"{back}/return/fail", "cancel": f"{back}/return/cancel", "ipn": f"{back}/ipn"},
            customer={"name": user.name, "email": user.email, "phone": getattr(account, "phone", None) or "", "address": getattr(account, "address", None) or ""},
            product=inv.title or f"Invoice #{invoice_id}",
        )  # fmt: skip
    except gw.GatewayError as exc:
        db.rollback()
        raise _failed("sslcommerz", exc) from None
    db.commit()
    return {"redirect_url": url}


@router.post("/invoices/{invoice_id}/bkash-checkout", dependencies=payers)
def bkash_checkout(invoice_id: int, user: Me, db: DB):
    cfg, _, tx = _start(db, user, invoice_id, "bkash")
    try:
        created = gw.bkash_create(
            cfg, amount=float(tx.amount), invoice_number=tx.reference, callback_url=f"{_front()}/api/payments/bkash/return"
        )
    except gw.GatewayError as exc:
        db.rollback()
        raise _failed("bkash", exc) from None
    tx.gateway_ref = str(created["paymentID"])
    db.commit()
    return {"redirect_url": created["bkashURL"]}


@router.post("/invoices/{invoice_id}/nagad-checkout", dependencies=payers)
def nagad_checkout(invoice_id: int, request: Request, user: Me, db: DB):
    cfg, _, tx = _start(db, user, invoice_id, "nagad")
    try:
        ref, url = gw.nagad_checkout(
            cfg, order_id=tx.reference, amount=float(tx.amount), invoice_id=invoice_id,
            callback_url=f"{_front()}/api/payments/nagad/return", client_ip=request.client.host if request.client else "127.0.0.1",
        )  # fmt: skip
    except gw.GatewayError as exc:
        db.rollback()
        raise _failed("nagad", exc) from None
    tx.gateway_ref = ref
    db.commit()
    return {"redirect_url": url}


# --- recording a verified payment ---------------------------------------------------------


def _out(tx: GatewayTransaction) -> dict:
    return {"status": tx.status, "invoice_id": tx.invoice_id}


def _settle(db: Session, tx: GatewayTransaction, *, amount: Any, currency: Any, trx_id: Any = None, gateway_ref: str | None = None) -> dict:
    """Records the gateway-confirmed payment once. Raises 409 when the gateway reports a
    different amount or currency than the payment was started for."""
    tx = db.scalars(
        select(GatewayTransaction)
        .where(GatewayTransaction.gateway_transaction_id == tx.gateway_transaction_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one()
    if tx.status == "paid":
        return _out(tx)
    expected = float(tx.amount)
    if str(currency or "").upper() != "BDT" or not gw.same_amount(amount, expected):
        log.error(
            "%s payment %s for invoice %s does not match: got %s %s, expected %s BDT",
            tx.gateway, tx.reference, tx.invoice_id, amount, currency, expected,
        )  # fmt: skip
        raise HTTPException(
            status.HTTP_409_CONFLICT, "The payment does not match the invoice due. Please contact the school office."
        )
    inv = db.get(Invoice, tx.invoice_id)
    if inv is None:
        raise not_found("Invoice")
    ref = f"{tx.gateway}:{tx.reference}"
    existing = db.scalars(select(Payment).where(Payment.description == ref)).first()
    if existing is None:
        if _outstanding(inv) + 0.005 < expected:
            # paid at the gateway after someone recorded another payment: keep the money on record
            log.warning("%s payment %s is more than invoice %s still owes", tx.gateway, tx.reference, inv.invoice_id)
        existing = _record_payment(db, inv, expected, tx.gateway, int(time.time()), ref)
        db.flush()
    tx.status, tx.payment_id, tx.updated_at = "paid", existing.payment_id, _now()
    if trx_id:
        tx.gateway_trx_id = str(trx_id)[:100]
    if gateway_ref:
        tx.gateway_ref = gateway_ref
    db.commit()
    return _out(tx)


def _mark_failed(db: Session, tx: GatewayTransaction) -> dict:
    if tx.status == "pending":
        tx.status, tx.updated_at = "failed", _now()
        db.commit()
    return _out(tx)


def _find(db: Session, gateway: str, *, reference: str | None = None, gateway_ref: str | None = None) -> GatewayTransaction | None:
    stmt = select(GatewayTransaction).where(GatewayTransaction.gateway == gateway)
    stmt = stmt.where(GatewayTransaction.reference == reference) if reference else stmt.where(GatewayTransaction.gateway_ref == gateway_ref)
    return db.scalars(stmt).first()


def _settle_sslcommerz(db: Session, cfg: dict[str, str], tx: GatewayTransaction, val_id: str) -> dict:
    v = gw.ssl_validate(cfg, val_id)
    if str(v.get("status", "")).upper() not in gw.SSL_OK or v.get("tran_id") != tx.reference:
        log.warning("SSLCommerz val_id %s did not validate for %s: %s", val_id, tx.reference, v.get("status"))
        return _out(tx)
    return _settle(
        db, tx, amount=v.get("currency_amount") or v.get("amount"), currency=v.get("currency_type") or v.get("currency"),
        trx_id=v.get("bank_tran_id"), gateway_ref=val_id,
    )  # fmt: skip


def _confirm_target(db: Session, user: CurrentUser, gateway: str, ref: str) -> GatewayTransaction:
    tx = _find(db, gateway, reference=ref) if gateway == "sslcommerz" else _find(db, gateway, gateway_ref=ref)
    if tx is None:
        raise not_found("Payment")
    _ensure_invoice_access(db, user, get_or_404(db, Invoice, tx.invoice_id, "Invoice"))
    return tx


@router.post("/payments/sslcommerz/confirm", dependencies=payers)
def sslcommerz_confirm(body: ConfirmIn, user: Me, db: DB):
    tx = _confirm_target(db, user, "sslcommerz", body.ref)
    if tx.status == "paid":
        return _out(tx)
    cfg = _credentials(db, "sslcommerz")
    try:
        val_id = gw.ssl_find_valid(cfg, tx.reference)
        return _settle_sslcommerz(db, cfg, tx, val_id) if val_id else _out(tx)
    except gw.GatewayError as exc:
        raise _failed("sslcommerz", exc) from None


@router.post("/payments/bkash/confirm", dependencies=payers)
def bkash_confirm(body: ConfirmIn, user: Me, db: DB):
    """Executes the approved bKash payment (or reads its state if it was executed already)."""
    tx = _confirm_target(db, user, "bkash", body.ref)
    if tx.status == "paid":
        return _out(tx)
    cfg = _credentials(db, "bkash")
    try:
        result = gw.bkash_execute(cfg, body.ref)
        if result.get("transactionStatus") != "Completed":
            result = gw.bkash_query(cfg, body.ref)
    except gw.GatewayError as exc:
        raise _failed("bkash", exc) from None
    state = result.get("transactionStatus")
    if state == "Completed":
        if result.get("paymentID") != body.ref or result.get("merchantInvoiceNumber", tx.reference) != tx.reference:
            log.error("bKash payment %s does not belong to %s", body.ref, tx.reference)
            raise HTTPException(status.HTTP_409_CONFLICT, "The payment does not match the invoice. Please contact the school office.")
        return _settle(db, tx, amount=result.get("amount"), currency=result.get("currency"), trx_id=result.get("trxID"))
    if state in ("Cancelled", "Failed", "Expired"):
        return _mark_failed(db, tx)
    return _out(tx)


@router.post("/payments/nagad/confirm", dependencies=payers)
def nagad_confirm(body: ConfirmIn, user: Me, db: DB):
    tx = _confirm_target(db, user, "nagad", body.ref)
    if tx.status == "paid":
        return _out(tx)
    cfg = _credentials(db, "nagad")
    try:
        result = gw.nagad_verify(cfg, body.ref)
    except gw.GatewayError as exc:
        raise _failed("nagad", exc) from None
    state = str(result.get("status", "")).lower()
    if state == "success":
        if (
            result.get("orderId") != tx.reference
            or result.get("paymentRefId", body.ref) != body.ref
            or result.get("merchantId", cfg["merchant_id"]) != cfg["merchant_id"]
        ):
            log.error("Nagad payment %s does not belong to %s", body.ref, tx.reference)
            raise HTTPException(status.HTTP_409_CONFLICT, "The payment does not match the invoice. Please contact the school office.")
        # Nagad only settles in BDT; its verify response has no currency field
        return _settle(db, tx, amount=result.get("amount"), currency="BDT", trx_id=result.get("issuerPaymentRefNo"))
    if state in ("aborted", "cancelled", "canceled", "failed", "rejected"):
        return _mark_failed(db, tx)
    return _out(tx)


# --- gateway callbacks (no login: the payer's browser and SSLCommerz's server call these) ---
# Left out of the API schema like the Stripe webhook. The /return endpoints only redirect;
# the IPN records a payment only after the SSLCommerz validation API confirms it.


def _callback_throttle(request: Request) -> None:
    throttle(f"gateway-callback:{request.client.host if request.client else '?'}", 120, 60, "Too many requests")


def _back_to_app(gateway: str, result: str, ref: Any) -> RedirectResponse:
    query = {"gateway": gateway, "result": result}
    if isinstance(ref, str) and re.match(REF, ref):
        query["ref"] = ref
    return RedirectResponse(f"{_front()}/app/my-invoices?{urlencode(query)}", status_code=status.HTTP_303_SEE_OTHER)


@router.post("/payments/sslcommerz/return/{result}", include_in_schema=False)
async def sslcommerz_return(result: Literal["success", "fail", "cancel"], request: Request):
    _callback_throttle(request)
    form = await request.form()
    return _back_to_app("sslcommerz", {"fail": "failure"}.get(result, result), form.get("tran_id"))


@router.post("/payments/sslcommerz/ipn", include_in_schema=False)
async def sslcommerz_ipn(request: Request, db: DB):
    _callback_throttle(request)
    form = await request.form()
    tran_id, val_id = form.get("tran_id"), form.get("val_id")
    if not isinstance(tran_id, str) or not isinstance(val_id, str) or not re.match(REF, tran_id) or not re.match(REF, val_id):
        return {"received": True}
    tx = _find(db, "sslcommerz", reference=tran_id)
    if tx is None or tx.status == "paid":
        return {"received": True}
    try:
        _settle_sslcommerz(db, _credentials(db, "sslcommerz"), tx, val_id)
    except (gw.GatewayError, HTTPException) as exc:
        log.error("SSLCommerz IPN for %s not recorded: %s", tran_id, getattr(exc, "detail", exc))
    return {"received": True}


@router.get("/payments/bkash/return", include_in_schema=False)
def bkash_return(request: Request):
    """bKash appends ?paymentID=…&status=success|failure|cancel."""
    _callback_throttle(request)
    state = request.query_params.get("status", "")
    return _back_to_app("bkash", state if state in ("success", "cancel") else "failure", request.query_params.get("paymentID"))


@router.get("/payments/nagad/return", include_in_schema=False)
def nagad_return(request: Request):
    """Nagad appends ?merchant=…&order_id=…&payment_ref_id=…&status=Success|Aborted|…"""
    _callback_throttle(request)
    state = request.query_params.get("status", "").lower()
    result = "success" if state == "success" else "cancel" if state in ("aborted", "cancelled", "canceled") else "failure"
    return _back_to_app("nagad", result, request.query_params.get("payment_ref_id"))


@router.get("/payments/gateway-transactions", dependencies=[Depends(require_roles("admin", "accountant"))])
def list_gateway_transactions(db: DB, invoice_id: int | None = None, limit: int = 50):
    """Recent online payment attempts (for the office when a payer asks about one)."""
    stmt = select(GatewayTransaction).order_by(GatewayTransaction.gateway_transaction_id.desc()).limit(min(max(limit, 1), 200))
    if invoice_id:
        stmt = stmt.where(GatewayTransaction.invoice_id == invoice_id)
    total = db.scalar(select(func.count()).select_from(GatewayTransaction)) or 0
    return {
        "total": total,
        "items": [
            {
                "gateway": t.gateway, "reference": t.reference, "gateway_trx_id": t.gateway_trx_id, "invoice_id": t.invoice_id,
                "amount": float(t.amount), "status": t.status, "payment_id": t.payment_id, "created_at": t.created_at,
            }  # fmt: skip
            for t in db.scalars(stmt)
        ],
    }
