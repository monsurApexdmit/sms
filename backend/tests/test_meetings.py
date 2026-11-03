from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.v1.endpoints import meetings
from app.db.session import SessionLocal
from app.models import CalendarEvent, MeetingBooking, MeetingSlot, Teacher
from app.services import notifications

NOW = datetime(2030, 1, 10, 8, 0)
DAY = "2030-01-10"


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(meetings, "_now", lambda: NOW)


@pytest.fixture
def emails(monkeypatch):
    sent = []
    monkeypatch.setattr(notifications, "enqueue", lambda tasks, fn, *args: sent.append((fn.__name__, args[0], args[1])))
    return sent


def _session(client, admin, **over) -> dict:
    body = {"title": "Term 1 PTM", "date": DAY, "start_time": "14:00", "end_time": "16:00", "slot_minutes": 15, "class_id": 1, **over}
    r = client.post("/api/meetings/sessions", headers=admin, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _slots(client, headers, session_id, **params) -> list[dict]:
    r = client.get(f"/api/meetings/sessions/{session_id}/slots", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _free_slot(client, parent, session_id, teacher_id=1, student_id=1) -> int:
    opts = client.get(f"/api/meetings/sessions/{session_id}/options", headers=parent, params={"student_id": student_id}).json()
    return next(t for t in opts if t["teacher_id"] == teacher_id)["free_slots"][0]["slot_id"]


# --- sessions ---------------------------------------------------------------------


def test_slots_generated_for_class_teachers(client, as_role):
    admin = as_role("admin")
    s = _session(client, admin, start_time="14:00", end_time="15:10", slot_minutes=20)
    assert s["teacher_ids"] == [1, 2] and s["slots"] == 6  # 14:00, 14:20, 14:40 per teacher; 15:00-15:20 doesn't fit
    times = [x["start_time"] for x in _slots(client, admin, s["session_id"], teacher_id=1)]
    assert times == ["14:00:00", "14:20:00", "14:40:00"]

    bad = {"title": "x", "date": DAY, "start_time": "14:00", "end_time": "14:10", "slot_minutes": 15, "class_id": 1}
    assert client.post("/api/meetings/sessions", headers=admin, json=bad).status_code == 422
    assert client.post("/api/meetings/sessions", headers=admin, json={**bad, "end_time": "15:00", "class_id": None}).status_code == 422
    assert client.post("/api/meetings/sessions", headers=as_role("teacher"), json={**bad, "end_time": "15:00"}).status_code == 403


def test_calendar_event_follows_the_session(client, as_role):
    admin = as_role("admin")
    s = _session(client, admin)
    with SessionLocal() as db:
        (ev,) = db.scalars(select(CalendarEvent)).all()
        assert (ev.kind, ev.audience, ev.start_date.isoformat()) == ("meeting", "parents", DAY)

    body = {"title": "Renamed", "date": "2030-01-11", "start_time": "14:00", "end_time": "16:00", "slot_minutes": 15, "class_id": 1}
    assert client.put(f"/api/meetings/sessions/{s['session_id']}", headers=admin, json=body).status_code == 200
    with SessionLocal() as db:
        (ev,) = db.scalars(select(CalendarEvent)).all()
        assert ev.title.endswith("Renamed") and ev.start_date.isoformat() == "2030-01-11"

    assert client.delete(f"/api/meetings/sessions/{s['session_id']}", headers=admin).status_code == 204
    with SessionLocal() as db:
        assert db.scalars(select(CalendarEvent)).all() == []
        assert db.scalars(select(MeetingSlot)).all() == []


# --- booking rules ------------------------------------------------------------------


def test_parent_books_and_both_sides_are_emailed(client, as_role, emails):
    admin, parent = as_role("admin"), as_role("parent")
    s = _session(client, admin)
    slot_id = _free_slot(client, parent, s["session_id"])
    r = client.post("/api/meetings/bookings", headers=parent, json={"slot_id": slot_id, "student_id": 1, "note": "Maths homework"})
    assert r.status_code == 201, r.text
    assert "teacher_note" not in r.json()
    assert {to for _, to, _ in emails} == {"p@example.com", "t1@example.com"}
    assert all("booked" in subject for _, _, subject in emails)

    mine = client.get("/api/meetings/bookings/mine", headers=parent).json()
    assert [(b["teacher_name"], b["status"]) for b in mine] == [("Teacher One", "booked")]
    opts = client.get(f"/api/meetings/sessions/{s['session_id']}/options", headers=parent, params={"student_id": 1}).json()
    assert next(t for t in opts if t["teacher_id"] == 1)["already_booked"] is True


def test_parent_cannot_book_other_child_or_teacher_outside_class(client, as_role):
    admin, parent = as_role("admin"), as_role("parent")
    with SessionLocal() as db:
        db.add(Teacher(name="Outsider", email="t3@example.com"))
        db.commit()
    s = _session(client, admin, class_id=None, teacher_ids=[1, 3])
    slot_id = _free_slot(client, parent, s["session_id"])
    # Kid Two has no parent; not this parent's child
    assert client.post("/api/meetings/bookings", headers=parent, json={"slot_id": slot_id, "student_id": 2}).status_code == 403
    assert client.get(f"/api/meetings/sessions/{s['session_id']}/options", headers=parent, params={"student_id": 2}).status_code == 403

    outsider = next(x for x in _slots(client, admin, s["session_id"], teacher_id=3))
    r = client.post("/api/meetings/bookings", headers=parent, json={"slot_id": outsider["slot_id"], "student_id": 1})
    assert r.status_code == 422
    opts = client.get(f"/api/meetings/sessions/{s['session_id']}/options", headers=parent, params={"student_id": 1}).json()
    assert [t["teacher_id"] for t in opts] == [1]


def test_double_booking_refused(client, as_role):
    admin, parent = as_role("admin"), as_role("parent")
    s = _session(client, admin)
    first, second = [x["slot_id"] for x in _slots(client, admin, s["session_id"], teacher_id=1)[:2]]
    assert client.post("/api/meetings/bookings", headers=parent, json={"slot_id": first, "student_id": 1}).status_code == 201
    # same slot again
    assert client.post("/api/meetings/bookings", headers=parent, json={"slot_id": first, "student_id": 1}).status_code == 409
    # same teacher, same child, same session
    assert client.post("/api/meetings/bookings", headers=parent, json={"slot_id": second, "student_id": 1}).status_code == 409
    # a different teacher is fine
    assert client.post("/api/meetings/bookings", headers=parent, json={"slot_id": _free_slot(client, parent, s["session_id"], 2), "student_id": 1}).status_code == 201


def test_database_refuses_concurrent_double_booking(client, as_role):
    """Two requests that both passed the checks: the unique active_slot_id stops the second."""
    s = _session(client, as_role("admin"))
    with SessionLocal() as db:
        slot = db.scalars(select(MeetingSlot).where(MeetingSlot.session_id == s["session_id"])).first()
        for key in ("a", "b"):
            db.add(MeetingBooking(slot_id=slot.slot_id, parent_id=1, student_id=1, status="booked", created_at=NOW, active_slot_id=slot.slot_id, active_key=key))
        with pytest.raises(IntegrityError):
            db.commit()


def test_booking_cutoff_and_past_slots(client, as_role):
    admin, parent = as_role("admin"), as_role("parent")
    s = _session(client, admin, start_time="07:00", end_time="11:00", slot_minutes=30)
    opts = client.get(f"/api/meetings/sessions/{s['session_id']}/options", headers=parent, params={"student_id": 1}).json()
    # now 08:00: 07:00-09:30 are past or inside the 2 hour cutoff
    assert [x["start_time"] for x in opts[0]["free_slots"]] == ["10:00:00", "10:30:00"]
    early = next(x for x in _slots(client, admin, s["session_id"], teacher_id=1) if x["start_time"] == "09:30:00")
    r = client.post("/api/meetings/bookings", headers=parent, json={"slot_id": early["slot_id"], "student_id": 1})
    assert r.status_code == 409


def test_cancel_then_rebook(client, as_role, emails):
    admin, parent = as_role("admin"), as_role("parent")
    s = _session(client, admin)
    slot_id = _free_slot(client, parent, s["session_id"])
    booking = client.post("/api/meetings/bookings", headers=parent, json={"slot_id": slot_id, "student_id": 1}).json()
    emails.clear()

    assert client.post(f"/api/meetings/bookings/{booking['booking_id']}/cancel", headers=as_role("teacher")).status_code == 403
    r = client.post(f"/api/meetings/bookings/{booking['booking_id']}/cancel", headers=parent)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert {to for _, to, _ in emails} == {"p@example.com", "t1@example.com"}
    assert client.post(f"/api/meetings/bookings/{booking['booking_id']}/cancel", headers=parent).status_code == 409

    again = client.post("/api/meetings/bookings", headers=parent, json={"slot_id": slot_id, "student_id": 1})
    assert again.status_code == 201
    # session layout is locked while booked
    body = {"title": "x", "date": DAY, "start_time": "13:00", "end_time": "16:00", "slot_minutes": 15, "class_id": 1}
    assert client.put(f"/api/meetings/sessions/{s['session_id']}", headers=admin, json=body).status_code == 409


# --- teachers -----------------------------------------------------------------------


def test_teacher_sees_only_own_slots_and_records_outcome(client, as_role):
    admin, parent, t1, t2 = as_role("admin"), as_role("parent"), as_role("teacher"), as_role("teacher2")
    s = _session(client, admin)
    assert {x["teacher_id"] for x in _slots(client, t1, s["session_id"])} == {1}
    assert {x["teacher_id"] for x in _slots(client, t1, s["session_id"], teacher_id=2)} == {1}

    slot_id = _free_slot(client, parent, s["session_id"])
    booking = client.post("/api/meetings/bookings", headers=parent, json={"slot_id": slot_id, "student_id": 1}).json()
    url = f"/api/meetings/bookings/{booking['booking_id']}/outcome"
    assert client.put(url, headers=t2, json={"status": "done"}).status_code == 403
    r = client.put(url, headers=t1, json={"status": "done", "teacher_note": "Needs extra practice"})
    assert r.status_code == 200 and r.json()["teacher_note"] == "Needs extra practice"
    # the private note never reaches the parent
    assert "teacher_note" not in client.get("/api/meetings/bookings/mine", headers=parent).json()[0]

    other = next(x for x in _slots(client, admin, s["session_id"], teacher_id=2))
    assert client.put(f"/api/meetings/slots/{other['slot_id']}/block", headers=t1, json={"blocked": True}).status_code == 403
    assert client.put(f"/api/meetings/slots/{slot_id}/block", headers=t1, json={"blocked": True}).status_code == 409
    free = next(x for x in _slots(client, t1, s["session_id"]) if x["status"] == "open")
    assert client.put(f"/api/meetings/slots/{free['slot_id']}/block", headers=t1, json={"blocked": True}).json()["status"] == "blocked"


def test_session_lists_by_role(client, as_role):
    admin = as_role("admin")
    with SessionLocal() as db:
        db.add(Teacher(name="Outsider", email="t3@example.com", password="x"))
        db.commit()
    _session(client, admin, title="Class ten")
    _session(client, admin, title="Other class", class_id=99, teacher_ids=[3])
    titles = lambda role: {x["title"] for x in client.get("/api/meetings/sessions", headers=as_role(role)).json()}  # noqa: E731
    assert titles("admin") == {"Class ten", "Other class"}
    assert titles("teacher") == {"Class ten"}
    assert titles("parent") == {"Class ten"}
    assert client.get("/api/meetings/sessions", headers=as_role("student")).status_code == 403
