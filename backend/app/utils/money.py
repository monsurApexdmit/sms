"""Amounts in the legacy tables are stored as text."""


def num(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def fmt(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")
