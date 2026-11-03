"""Academic calendar: holidays, exams, events and meetings."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from app.api.crud import get_or_404
from app.api.deps import DB, Me, require_roles
from app.models import CalendarEvent
from app.schemas.calendar import EventIn, EventOut, Kind
from app.services.school_calendar import day_info, weekly_off_days

router = APIRouter(prefix="/calendar", tags=["calendar"])
admin_only = [Depends(require_roles("admin"))]

# which audiences each role sees (admins see everything)
VISIBLE: dict[str, tuple[str, ...]] = {
    "teacher": ("all", "staff"), "accountant": ("all", "staff"), "librarian": ("all", "staff"),
    "student": ("all", "students"), "parent": ("all", "parents"),
}  # fmt: skip


@router.get("", response_model=list[EventOut])
def list_events(
    user: Me,
    db: DB,
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    kind: Kind | None = None,
):
    """Events overlapping [from, to] that the user's role may see."""
    if (date_to - date_from).days > 400:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Ask for at most about a year at a time")
    stmt = select(CalendarEvent).where(CalendarEvent.start_date <= date_to, CalendarEvent.end_date >= date_from)
    if user.role != "admin":
        stmt = stmt.where(CalendarEvent.audience.in_(VISIBLE.get(user.role, ("all",))))
    if kind:
        stmt = stmt.where(CalendarEvent.kind == kind)
    return list(db.scalars(stmt.order_by(CalendarEvent.start_date, CalendarEvent.event_id)))


@router.get("/day")
def get_day(d: date = Query(alias="date"), *, _: Me, db: DB):
    """Whether `date` is a holiday or a weekly day off."""
    return day_info(db, d)


@router.get("/weekly-off-days", response_model=list[int])
def get_weekly_off_days(_: Me, db: DB):
    return sorted(weekly_off_days(db))


@router.post("", response_model=EventOut, status_code=201, dependencies=admin_only)
def create_event(body: EventIn, db: DB):
    row = CalendarEvent(**body.model_dump())
    db.add(row)
    db.commit()
    return row


@router.put("/{event_id}", response_model=EventOut, dependencies=admin_only)
def update_event(event_id: int, body: EventIn, db: DB):
    row = get_or_404(db, CalendarEvent, event_id, "Event")
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    db.commit()
    return row


@router.delete("/{event_id}", status_code=204, dependencies=admin_only)
def delete_event(event_id: int, db: DB):
    db.delete(get_or_404(db, CalendarEvent, event_id, "Event"))
    db.commit()
