"""Money helpers for the legacy invoice/payment tables, which store amounts as text."""

from app.models import Invoice


def num(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def fmt(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def refresh_status(inv: Invoice) -> None:
    due = max(num(inv.amount) - num(inv.amount_paid), 0)
    inv.due = fmt(due)
    inv.status = "paid" if due <= 0 else "unpaid"
