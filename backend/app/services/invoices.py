"""Money helpers for the legacy invoice/payment tables, which store amounts as text."""

from app.models import Invoice
from app.utils.money import fmt, num

__all__ = ["fmt", "num", "refresh_status"]


def refresh_status(inv: Invoice) -> None:
    due = max(num(inv.amount) - num(inv.amount_paid), 0)
    inv.due = fmt(due)
    inv.status = "paid" if due <= 0 else "unpaid"
