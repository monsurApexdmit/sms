"""Excel (.xlsx) downloads for list screens.

Cells keep their types: ints/floats as numbers, date/datetime as dates. Text that a
spreadsheet would treat as a formula (starting with =) is stored as plain text, and
control characters Excel rejects are removed.
"""

import io
import re
from collections.abc import Iterable, Sequence
from datetime import date, datetime, timezone
from typing import Any

from fastapi import HTTPException, Response, status
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

MAX_ROWS = 50_000
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def check_size(total: int) -> None:
    if total > MAX_ROWS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"{total} rows match; exports are limited to {MAX_ROWS}. Narrow the filters and try again.",
        )


def number(value: Any) -> float | int | None:
    """Legacy amounts and marks are often stored as text."""
    if value is None or value == "":
        return None
    if isinstance(value, int | float):
        return value
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return int(n) if n.is_integer() else n


def unix_date(value: Any) -> date | None:
    """Legacy unix-seconds text to a date (UTC, as the API stores day timestamps)."""
    n = number(value)
    if not n or n <= 0:
        return None
    return datetime.fromtimestamp(n, timezone.utc).date()


def _cell(ws, value: Any, bold: bool = False) -> WriteOnlyCell:
    if isinstance(value, str):
        value = ILLEGAL_CHARACTERS_RE.sub("", value)
    if isinstance(value, datetime) and value.tzinfo is not None:
        value = value.replace(tzinfo=None)
    cell = WriteOnlyCell(ws, value=value)
    if isinstance(value, str) and value.startswith("="):
        cell.data_type = "s"  # never a formula
    if isinstance(value, datetime):
        cell.number_format = "yyyy-mm-dd hh:mm"
    elif isinstance(value, date):
        cell.number_format = "yyyy-mm-dd"
    if bold:
        cell.font = Font(bold=True)
    return cell


def _width(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, datetime):
        return 16
    if isinstance(value, date):
        return 10
    return len(str(value))


def xlsx_response(filename: str, headers: Sequence[str], rows: Iterable[Sequence[Any]], sheet: str = "Sheet1") -> Response:
    rows = list(rows)
    check_size(len(rows))
    widths = [len(h) for h in headers]
    for row in rows[:1000]:  # widths from a sample keeps big exports fast
        for i, value in enumerate(row):
            widths[i] = max(widths[i], _width(value))

    wb = Workbook(write_only=True)
    ws = wb.create_sheet(title=sheet[:31])
    ws.freeze_panes = "A2"
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = min(max(w + 2, 8), 60)
    ws.append([_cell(ws, h, bold=True) for h in headers])
    for row in rows:
        ws.append([_cell(ws, v) for v in row])
    buf = io.BytesIO()
    wb.save(buf)
    name = _SAFE_NAME.sub("-", filename).strip("-") or "export"
    return Response(
        buf.getvalue(),
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'},
    )
