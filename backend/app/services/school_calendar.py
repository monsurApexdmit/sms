"""Holidays and working days, from the academic calendar and the `weekly_off_days`
setting (comma-separated weekday numbers, Monday = 0; e.g. "4" for Friday, "5,6" for
the weekend; empty = no weekly day off)."""

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CalendarEvent
from app.services.settings import get_setting


def weekly_off_days(db: Session) -> set[int]:
    raw = get_setting(db, "weekly_off_days")
    return {int(p) for p in raw.split(",") if p.strip().isdigit() and int(p) < 7}


def holidays_between(db: Session, start: date, end: date) -> dict[date, str]:
    """Holiday dates in [start, end] (inclusive) mapped to the holiday's title."""
    out: dict[date, str] = {}
    rows = db.scalars(
        select(CalendarEvent).where(
            CalendarEvent.kind == "holiday", CalendarEvent.start_date <= end, CalendarEvent.end_date >= start
        )
    )
    for ev in rows:
        day = max(ev.start_date, start)
        while day <= min(ev.end_date, end):
            out.setdefault(day, ev.title)
            day += timedelta(days=1)
    return out


def day_info(db: Session, d: date) -> dict:
    holiday = holidays_between(db, d, d).get(d)
    return {"date": d.isoformat(), "holiday": holiday, "weekly_off": d.weekday() in weekly_off_days(db)}


def working_days(db: Session, start: date, end: date) -> int:
    """School days in [start, end]: not a weekly day off and not a holiday."""
    if end < start:
        return 0
    off, holidays = weekly_off_days(db), holidays_between(db, start, end)
    total, day = 0, start
    while day <= end:
        if day.weekday() not in off and day not in holidays:
            total += 1
        day += timedelta(days=1)
    return total
