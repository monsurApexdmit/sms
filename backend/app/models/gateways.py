"""Local payment gateway transactions (bKash, Nagad, SSLCommerz)."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Int, num, pk


class GatewayTransaction(Base):
    """One online payment attempt through bKash, Nagad or SSLCommerz. `reference` is our id sent
    to the gateway (SSLCommerz tran_id, bKash merchantInvoiceNumber, Nagad orderId); `gateway_ref`
    is the gateway's id for it (bKash paymentID, Nagad paymentReferenceId, SSLCommerz val_id).
    status = pending | paid | failed. The payment row is written once, when status becomes paid."""

    __tablename__ = "gateway_transaction"
    __table_args__ = (
        UniqueConstraint("gateway", "reference", name="uq_gateway_transaction_reference"),
        Index("ix_gateway_transaction_gateway_ref", "gateway", "gateway_ref"),
    )
    gateway_transaction_id: Mapped[int] = pk()
    gateway: Mapped[str] = mapped_column(String(20), nullable=False)
    reference: Mapped[str] = mapped_column(String(64), nullable=False)
    gateway_ref: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # payer-facing transaction number (bKash trxID, Nagad issuerPaymentRefNo, SSLCommerz bank_tran_id)
    gateway_trx_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    invoice_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="BDT")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending")
    payment_id: Int = num()
    # "role-id" of the student or parent who started it
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
