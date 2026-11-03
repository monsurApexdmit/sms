"""Parent-teacher meetings: sessions with per-teacher slots that parents book for a child."""

from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.crud import get_or_404
from app.core.config import get_settings
from app.core.deps import DB, CurrentUser, Me, forbid, require_roles
from app.models import (
    CalendarEvent,
    MeetingBooking,
    MeetingSession,
    MeetingSlot,
    Parent,
    SchoolClass,
    Student,
    Subject,
    Teacher,
)
from app.services.access import children_ids, current_enroll
from app.services.notifications import notify, user
from app.services.settings import get_setting

router = APIRouter(prefix="/meetings", tags=["meetings"])
admin_only = [Depends(require_roles("admin"))]
VIEWERS = Depends(require_roles("admin", "teacher", "parent"))

# Parents cannot book (or rebook) a slot that starts sooner than this.
BOOKING_CUTOFF = timedelta(hours=2)
ACTIVE = ("booked", "done", "no_show")


def _now() -> datetime:
    """Current wall-clock time in the school's time zone (naive, like the session times)."""
    return datetime.now(ZoneInfo(get_settings().school_timezone)).replace(tzinfo=None)


# --- schemas ----------------------------------------------------------------------


class SessionIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    date: date
    start_time: time
    end_time: time
    slot_minutes: int = Field(ge=5, le=120)
    location: str | None = Field(default=None, max_length=300)
    class_id: int | None = None
    # empty: every teacher of class_id
    teacher_ids: list[int] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def check(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        if not self.teacher_ids and self.class_id is None:
            raise ValueError("Choose the teachers, or a class to invite all its teachers")
        if not _slot_times(self.start_time, self.end_time, self.slot_minutes):
            raise ValueError("The time window is shorter than one slot")
        return self


class SessionOut(BaseModel):
    session_id: int
    title: str
    date: date
    start_time: time
    end_time: time
    slot_minutes: int
    location: str | None
    class_id: int | None
    class_name: str | None
    teacher_ids: list[int]
    slots: int
    booked: int


class BookingIn(BaseModel):
    slot_id: int
    student_id: int
    note: str | None = Field(default=None, max_length=1000)


class OutcomeIn(BaseModel):
    status: Literal["booked", "done", "no_show"]
    teacher_note: str | None = Field(default=None, max_length=2000)


class BlockIn(BaseModel):
    blocked: bool


# --- helpers ----------------------------------------------------------------------


def _slot_times(start: time, end: time, minutes: int) -> list[tuple[time, time]]:
    day = date(2000, 1, 1)
    at, stop, step = datetime.combine(day, start), datetime.combine(day, end), timedelta(minutes=minutes)
    out = []
    while at + step <= stop:
        out.append((at.time(), (at + step).time()))
        at += step
    return out


def _class_teachers(db: Session, class_id: int) -> set[int]:
    return {t for t in db.scalars(select(Subject.teacher_id).where(Subject.class_id == class_id)) if t}


def _session_teachers(db: Session, body: SessionIn) -> list[int]:
    ids = set(body.teacher_ids) or _class_teachers(db, body.class_id or 0)
    if not ids:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That class has no teachers assigned to its subjects")
    known = set(db.scalars(select(Teacher.teacher_id).where(Teacher.teacher_id.in_(ids))))
    if known != ids:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown teacher")
    return sorted(ids)


def _starts_at(session: MeetingSession, slot: MeetingSlot) -> datetime:
    return datetime.combine(session.date, slot.start_time)


def _sync_event(db: Session, row: MeetingSession) -> None:
    ev = db.get(CalendarEvent, row.calendar_event_id) if row.calendar_event_id else None
    if ev is None:
        ev = CalendarEvent(kind="meeting", audience="parents")
        db.add(ev)
    ev.title = f"Parent-teacher meeting: {row.title}"
    ev.start_date = ev.end_date = row.date
    window = f"{row.start_time:%H:%M}–{row.end_time:%H:%M}"
    ev.description = f"{window}{f', {row.location}' if row.location else ''}. Book a slot under Meetings."
    db.flush()
    row.calendar_event_id = ev.event_id


def _session_out(db: Session, row: MeetingSession) -> SessionOut:
    counts = dict(
        db.execute(
            select(MeetingSlot.status, func.count()).where(MeetingSlot.session_id == row.session_id).group_by(MeetingSlot.status)
        ).all()
    )
    teachers = db.scalars(select(MeetingSlot.teacher_id).where(MeetingSlot.session_id == row.session_id).distinct())
    cls = db.get(SchoolClass, row.class_id) if row.class_id else None
    return SessionOut(
        session_id=row.session_id, title=row.title, date=row.date, start_time=row.start_time, end_time=row.end_time,
        slot_minutes=row.slot_minutes, location=row.location, class_id=row.class_id, class_name=cls.name if cls else None,
        teacher_ids=sorted(teachers), slots=sum(counts.values()), booked=counts.get("booked", 0),
    )  # fmt: skip


def _has_bookings(db: Session, session_id: int) -> bool:
    return (
        db.scalar(
            select(func.count())
            .select_from(MeetingBooking)
            .join(MeetingSlot, MeetingSlot.slot_id == MeetingBooking.slot_id)
            .where(MeetingSlot.session_id == session_id, MeetingBooking.status.in_(ACTIVE))
        )
        or 0
    ) > 0


def _generate_slots(db: Session, row: MeetingSession, teacher_ids: list[int]) -> None:
    for teacher_id in teacher_ids:
        for start, end in _slot_times(row.start_time, row.end_time, row.slot_minutes):
            db.add(MeetingSlot(session_id=row.session_id, teacher_id=teacher_id, start_time=start, end_time=end, status="open"))


def _delete_slots(db: Session, session_id: int) -> None:
    """Slots of a session and every booking on them (also done in the database by ON DELETE CASCADE)."""
    slot_ids = select(MeetingSlot.slot_id).where(MeetingSlot.session_id == session_id)
    for b in db.scalars(select(MeetingBooking).where(MeetingBooking.slot_id.in_(slot_ids))):
        db.delete(b)
    for s in db.scalars(select(MeetingSlot).where(MeetingSlot.session_id == session_id)):
        db.delete(s)
    db.flush()


def _child_class(db: Session, student_id: int) -> int | None:
    enroll = current_enroll(db, student_id)
    return enroll.class_id if enroll else None


def _visible_to_parent(db: Session, parent_id: int, row: MeetingSession) -> bool:
    if row.class_id is None:
        return True
    return any(_child_class(db, sid) == row.class_id for sid in children_ids(db, parent_id))


def _ensure_session_access(db: Session, user: CurrentUser, row: MeetingSession) -> None:
    if user.role == "admin":
        return
    if user.role == "teacher":
        mine = db.scalar(
            select(func.count()).select_from(MeetingSlot).where(MeetingSlot.session_id == row.session_id, MeetingSlot.teacher_id == user.id)
        )
        if mine:
            return
    if user.role == "parent" and _visible_to_parent(db, user.id, row):
        return
    raise forbid()


def _deactivate(booking: MeetingBooking, slot: MeetingSlot) -> None:
    booking.status = "cancelled"
    booking.cancelled_at = datetime.now(timezone.utc).replace(tzinfo=None)
    booking.active_slot_id = None
    booking.active_key = None
    if slot.status == "booked":
        slot.status = "open"


def _notify(db: Session, tasks: BackgroundTasks, booking: MeetingBooking, slot: MeetingSlot, session: MeetingSession, what: str) -> None:
    """Tell the parent and the teacher that a booking was made or cancelled."""
    school = get_setting(db, "system_name", "School")
    parent, teacher, student = db.get(Parent, booking.parent_id), db.get(Teacher, slot.teacher_id), db.get(Student, booking.student_id)
    when = f"{session.date:%d %b %Y}, {slot.start_time:%H:%M}–{slot.end_time:%H:%M}"
    where = f"\nLocation: {session.location}" if session.location else ""
    child = student.name if student else "your child"
    subject = f"Parent-teacher meeting {what}: {when}"
    body = (
        f"{session.title}\n{when}{where}\n\nStudent: {child}\nParent: {parent.name if parent else '-'}\n"
        f"Teacher: {teacher.name if teacher else '-'}\n"
        f"{f'Agenda: {booking.note}' if booking.note else ''}\n\n{school}"
    )
    short = f"{child} with {teacher.name if teacher else 'the teacher'}, {when}"
    if parent is not None:
        notify(db, tasks, [user("parent", parent.parent_id)], "meetings", subject, short, "/app/book-meeting", email_body=body)
    if teacher is not None:
        notify(db, tasks, [user("teacher", teacher.teacher_id)], "meetings", subject, short, "/app/my-meetings", email_body=body)


def _booking_out(db: Session, b: MeetingBooking, *, for_staff: bool) -> dict:
    slot = db.get(MeetingSlot, b.slot_id)
    session = db.get(MeetingSession, slot.session_id) if slot else None
    student, parent = db.get(Student, b.student_id), db.get(Parent, b.parent_id)
    teacher = db.get(Teacher, slot.teacher_id) if slot else None
    out = {
        "booking_id": b.booking_id, "slot_id": b.slot_id, "status": b.status, "note": b.note,
        "student_id": b.student_id, "student_name": student.name if student else None,
        "parent_id": b.parent_id, "parent_name": parent.name if parent else None, "parent_phone": parent.phone if parent else None,
        "teacher_id": slot.teacher_id if slot else None, "teacher_name": teacher.name if teacher else None,
        "session_id": session.session_id if session else None, "session_title": session.title if session else None,
        "date": session.date if session else None, "location": session.location if session else None,
        "start_time": slot.start_time if slot else None, "end_time": slot.end_time if slot else None,
        "created_at": b.created_at, "cancelled_at": b.cancelled_at,
    }  # fmt: skip
    if for_staff:
        out["teacher_note"] = b.teacher_note
    return out


# --- sessions ---------------------------------------------------------------------


@router.get("/sessions", response_model=list[SessionOut], dependencies=[VIEWERS])
def list_sessions(user: Me, db: DB, include_past: bool = False):
    """Admins see every session; teachers the ones they take part in; parents those open to their children."""
    stmt = select(MeetingSession)
    if not include_past:
        stmt = stmt.where(MeetingSession.date >= _now().date())
    if user.role == "teacher":
        stmt = stmt.where(MeetingSession.session_id.in_(select(MeetingSlot.session_id).where(MeetingSlot.teacher_id == user.id)))
    rows = list(db.scalars(stmt.order_by(MeetingSession.date, MeetingSession.start_time)))
    if user.role == "parent":
        rows = [r for r in rows if _visible_to_parent(db, user.id, r)]
    return [_session_out(db, r) for r in rows]


@router.post("/sessions", response_model=SessionOut, status_code=201, dependencies=admin_only)
def create_session(body: SessionIn, user: Me, db: DB):
    teachers = _session_teachers(db, body)
    row = MeetingSession(**body.model_dump(exclude={"teacher_ids"}), created_by=user.ref)
    db.add(row)
    db.flush()
    _generate_slots(db, row, teachers)
    _sync_event(db, row)
    db.commit()
    return _session_out(db, row)


@router.put("/sessions/{session_id}", response_model=SessionOut, dependencies=admin_only)
def update_session(session_id: int, body: SessionIn, db: DB):
    """Title and location can always change. The day, times, slot length, class and teachers
    can change only while nobody has booked: the slots are then generated again."""
    row = get_or_404(db, MeetingSession, session_id, "Meeting session")
    teachers = _session_teachers(db, body)
    current = sorted(db.scalars(select(MeetingSlot.teacher_id).where(MeetingSlot.session_id == session_id).distinct()))
    layout_changed = (
        (body.date, body.start_time, body.end_time, body.slot_minutes, body.class_id)
        != (row.date, row.start_time, row.end_time, row.slot_minutes, row.class_id)
        or teachers != current
    )  # fmt: skip
    if layout_changed:
        if _has_bookings(db, session_id):
            raise HTTPException(status.HTTP_409_CONFLICT, "Parents have booked slots; only the title and location can change")
        _delete_slots(db, session_id)
    for key, value in body.model_dump(exclude={"teacher_ids"}).items():
        setattr(row, key, value)
    if layout_changed:
        _generate_slots(db, row, teachers)
    _sync_event(db, row)
    db.commit()
    return _session_out(db, row)


@router.delete("/sessions/{session_id}", status_code=204, dependencies=admin_only)
def delete_session(session_id: int, tasks: BackgroundTasks, db: DB):
    """Deletes the session, its slots and calendar entry; parents and teachers with bookings are emailed."""
    row = get_or_404(db, MeetingSession, session_id, "Meeting session")
    for booking, slot in db.execute(
        select(MeetingBooking, MeetingSlot)
        .join(MeetingSlot, MeetingSlot.slot_id == MeetingBooking.slot_id)
        .where(MeetingSlot.session_id == session_id, MeetingBooking.status == "booked")
    ).all():
        _notify(db, tasks, booking, slot, row, "cancelled")
    if row.calendar_event_id and (ev := db.get(CalendarEvent, row.calendar_event_id)) is not None:
        db.delete(ev)
    _delete_slots(db, session_id)
    db.delete(row)
    db.commit()


@router.get("/sessions/{session_id}/slots", dependencies=[Depends(require_roles("admin", "teacher"))])
def session_slots(session_id: int, user: Me, db: DB, teacher_id: int | None = None):
    """Slots with their active booking. Teachers only see their own slots."""
    row = get_or_404(db, MeetingSession, session_id, "Meeting session")
    _ensure_session_access(db, user, row)
    stmt = select(MeetingSlot).where(MeetingSlot.session_id == session_id)
    if user.role == "teacher":
        stmt = stmt.where(MeetingSlot.teacher_id == user.id)
    elif teacher_id:
        stmt = stmt.where(MeetingSlot.teacher_id == teacher_id)
    slots = list(db.scalars(stmt.order_by(MeetingSlot.teacher_id, MeetingSlot.start_time)))
    bookings = {
        b.slot_id: b
        for b in db.scalars(
            select(MeetingBooking).where(MeetingBooking.slot_id.in_([s.slot_id for s in slots]), MeetingBooking.status.in_(ACTIVE))
        )
    } if slots else {}  # fmt: skip
    names = dict(db.execute(select(Teacher.teacher_id, Teacher.name).where(Teacher.teacher_id.in_({s.teacher_id for s in slots}))).all()) if slots else {}
    return [
        {
            "slot_id": s.slot_id, "teacher_id": s.teacher_id, "teacher_name": names.get(s.teacher_id),
            "start_time": s.start_time, "end_time": s.end_time, "status": s.status,
            "booking": _booking_out(db, bookings[s.slot_id], for_staff=True) if s.slot_id in bookings else None,
        }  # fmt: skip
        for s in slots
    ]


@router.get("/sessions/{session_id}/options", dependencies=[Depends(require_roles("parent"))])
def booking_options(session_id: int, student_id: int, user: Me, db: DB):
    """Teachers of the child's class in this session, with their free (bookable) slots."""
    row = get_or_404(db, MeetingSession, session_id, "Meeting session")
    if student_id not in children_ids(db, user.id):
        raise forbid()
    class_id = _child_class(db, student_id)
    if class_id is None or (row.class_id is not None and row.class_id != class_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This meeting is not for your child's class")
    teachers = _class_teachers(db, class_id)
    booked_with = set(
        db.scalars(
            select(MeetingSlot.teacher_id)
            .join(MeetingBooking, MeetingBooking.slot_id == MeetingSlot.slot_id)
            .where(MeetingSlot.session_id == session_id, MeetingBooking.student_id == student_id, MeetingBooking.status.in_(ACTIVE))
        )
    )
    cutoff = _now() + BOOKING_CUTOFF
    out = []
    for teacher in db.scalars(select(Teacher).where(Teacher.teacher_id.in_(teachers)).order_by(Teacher.name)):
        slots = list(
            db.scalars(
                select(MeetingSlot)
                .where(MeetingSlot.session_id == session_id, MeetingSlot.teacher_id == teacher.teacher_id)
                .order_by(MeetingSlot.start_time)
            )
        )
        if not slots:
            continue
        subjects = sorted(
            n for n in db.scalars(select(Subject.name).where(Subject.class_id == class_id, Subject.teacher_id == teacher.teacher_id)) if n
        )
        out.append(
            {
                "teacher_id": teacher.teacher_id, "teacher_name": teacher.name, "subjects": subjects,
                "already_booked": teacher.teacher_id in booked_with,
                "free_slots": [
                    {"slot_id": s.slot_id, "start_time": s.start_time, "end_time": s.end_time}
                    for s in slots if s.status == "open" and _starts_at(row, s) >= cutoff
                ],
            }  # fmt: skip
        )
    return out


# --- bookings ---------------------------------------------------------------------


@router.post("/bookings", status_code=201, dependencies=[Depends(require_roles("parent"))])
def book(body: BookingIn, user: Me, tasks: BackgroundTasks, db: DB):
    if body.student_id not in children_ids(db, user.id):
        raise forbid()
    slot = get_or_404(db, MeetingSlot, body.slot_id, "Slot")
    session = db.get(MeetingSession, slot.session_id)
    class_id = _child_class(db, body.student_id)
    if class_id is None or (session.class_id is not None and session.class_id != class_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This meeting is not for your child's class")
    if slot.teacher_id not in _class_teachers(db, class_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This teacher does not teach your child's class")
    if _starts_at(session, slot) < _now() + BOOKING_CUTOFF:
        raise HTTPException(status.HTTP_409_CONFLICT, "Slots must be booked at least 2 hours in advance")
    if slot.status != "open":
        raise HTTPException(status.HTTP_409_CONFLICT, "That slot is no longer available")
    key = f"{session.session_id}:{slot.teacher_id}:{body.student_id}"
    if db.scalar(select(func.count()).select_from(MeetingBooking).where(MeetingBooking.active_key == key)):
        raise HTTPException(status.HTTP_409_CONFLICT, "You already have a meeting with this teacher for this child")
    booking = MeetingBooking(
        slot_id=slot.slot_id, parent_id=user.id, student_id=body.student_id, note=body.note, status="booked",
        created_at=datetime.now(timezone.utc).replace(tzinfo=None), active_slot_id=slot.slot_id, active_key=key,
    )  # fmt: skip
    db.add(booking)
    slot.status = "booked"
    try:
        db.commit()
    except IntegrityError:
        # another request booked the slot (or this teacher for this child) first
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "That slot is no longer available") from None
    _notify(db, tasks, booking, slot, session, "booked")
    return _booking_out(db, booking, for_staff=False)


@router.get("/bookings/mine", dependencies=[Depends(require_roles("parent"))])
def my_bookings(user: Me, db: DB, include_past: bool = False):
    stmt = (
        select(MeetingBooking)
        .join(MeetingSlot, MeetingSlot.slot_id == MeetingBooking.slot_id)
        .join(MeetingSession, MeetingSession.session_id == MeetingSlot.session_id)
        .where(MeetingBooking.parent_id == user.id)
    )
    if not include_past:
        stmt = stmt.where(MeetingSession.date >= _now().date())
    rows = db.scalars(stmt.order_by(MeetingSession.date, MeetingSlot.start_time, MeetingBooking.booking_id))
    return [_booking_out(db, b, for_staff=False) for b in rows]


@router.post("/bookings/{booking_id}/cancel", dependencies=[Depends(require_roles("admin", "parent"))])
def cancel_booking(booking_id: int, user: Me, tasks: BackgroundTasks, db: DB):
    booking = get_or_404(db, MeetingBooking, booking_id, "Booking")
    if user.role == "parent" and booking.parent_id != user.id:
        raise forbid()
    if booking.status != "booked":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only upcoming bookings can be cancelled")
    slot = db.get(MeetingSlot, booking.slot_id)
    session = db.get(MeetingSession, slot.session_id)
    if user.role == "parent" and _starts_at(session, slot) <= _now():
        raise HTTPException(status.HTTP_409_CONFLICT, "The meeting has already started")
    _deactivate(booking, slot)
    db.commit()
    _notify(db, tasks, booking, slot, session, "cancelled")
    return _booking_out(db, booking, for_staff=user.role == "admin")


@router.put("/bookings/{booking_id}/outcome", dependencies=[Depends(require_roles("admin", "teacher"))])
def record_outcome(booking_id: int, body: OutcomeIn, user: Me, db: DB):
    """Mark a meeting done or no-show (or back to booked) and keep a private note."""
    booking = get_or_404(db, MeetingBooking, booking_id, "Booking")
    slot = db.get(MeetingSlot, booking.slot_id)
    if user.role == "teacher" and slot.teacher_id != user.id:
        raise forbid()
    if booking.status == "cancelled":
        raise HTTPException(status.HTTP_409_CONFLICT, "The booking was cancelled")
    booking.status = body.status
    booking.teacher_note = body.teacher_note
    db.commit()
    return _booking_out(db, booking, for_staff=True)


# --- slots ------------------------------------------------------------------------


@router.put("/slots/{slot_id}/block", dependencies=[Depends(require_roles("admin", "teacher"))])
def block_slot(slot_id: int, body: BlockIn, user: Me, db: DB):
    slot = get_or_404(db, MeetingSlot, slot_id, "Slot")
    if user.role == "teacher" and slot.teacher_id != user.id:
        raise forbid()
    if slot.status == "booked":
        raise HTTPException(status.HTTP_409_CONFLICT, "The slot is booked; cancel the booking first")
    slot.status = "blocked" if body.blocked else "open"
    db.commit()
    return {"slot_id": slot.slot_id, "status": slot.status}


@router.get("/teachers", dependencies=admin_only)
def session_teacher_options(db: DB, class_id: int | None = None):
    """Teachers to invite: all, or those teaching `class_id` (preselected in the form)."""
    of_class = _class_teachers(db, class_id) if class_id else set()
    rows = db.scalars(select(Teacher).order_by(Teacher.name))
    return [{"teacher_id": t.teacher_id, "name": t.name, "teaches_class": t.teacher_id in of_class} for t in rows]

