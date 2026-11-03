import pytest
from sqlalchemy import select

from app.api.routers import attendance
from app.core.security import hash_password
from app.db import SessionLocal
from app.models import Librarian, Parent, SchoolClass, Section, StaffAttendance, Student, Subject, Teacher
from tests.conftest import PASSWORD, YEAR, login

WEEK = {"from_date": "2026-03-02", "to_date": "2026-03-06"}  # Monday to Friday


@pytest.fixture
def others(client):
    """A teacher of another class, a parent of another child, and a librarian."""
    with SessionLocal() as db:
        pw = hash_password(PASSWORD)
        db.add_all(
            [
                Teacher(name="Teacher Three", email="t3@example.com", password=pw),
                Parent(name="Other Parent", email="p2@example.com", password=pw),
                Librarian(name="Libby", email="lib@example.com", password=pw),
                SchoolClass(name="Nine", name_numeric="9"),
            ]
        )
        db.flush()
        db.add(Section(name="B", class_id=2))
        db.add(Subject(name="Biology", class_id=2, teacher_id=3, year=YEAR))
        db.add(Student(name="Other Kid", email="s3@example.com", password=pw, parent_id=2))
        db.commit()
    return lambda who: login(client, {"teacher3": "t3@example.com", "parent2": "p2@example.com", "librarian": "lib@example.com"}[who])


def _apply(client, headers, **body):
    return client.post("/api/leave", headers=headers, json={"reason": "Flu", "kind": "sick", **WEEK, **body})


def test_who_can_apply(client, as_role, others):
    assert _apply(client, as_role("student")).status_code == 201
    assert _apply(client, as_role("student"), student_id=2).status_code == 403
    assert _apply(client, as_role("parent"), student_id=1, from_date="2026-03-09", to_date="2026-03-09").status_code == 201
    assert _apply(client, as_role("parent"), student_id=2).status_code == 403  # not their child
    assert _apply(client, others("parent2"), student_id=1).status_code == 403
    assert _apply(client, as_role("parent")).status_code == 403  # parents must name a child

    r = _apply(client, others("librarian"))
    assert r.status_code == 201 and r.json()["person_role"] == "librarian" and r.json()["student_id"] is None
    assert _apply(client, as_role("teacher"), student_id=1).status_code == 403

    # admin-recorded leave is approved at once
    r = _apply(client, as_role("admin"), staff_role="teacher", staff_id=2)
    assert r.status_code == 201 and r.json()["status"] == "approved"
    assert _apply(client, as_role("admin")).status_code == 422


def test_dates_overlap_and_working_days(client, as_role):
    admin, student = as_role("admin"), as_role("student")
    client.put("/api/settings", headers=admin, json={"weekly_off_days": "4"})  # Fridays
    client.post("/api/calendar", headers=admin, json={"title": "Holiday", "start_date": "2026-03-04", "kind": "holiday"})

    assert client.get("/api/leave/days", headers=student, params={"from": "2026-03-02", "to": "2026-03-06"}).json() == {"days": 3}
    r = _apply(client, student)
    assert r.status_code == 201 and r.json()["days"] == 3

    assert _apply(client, student, from_date="2026-03-05", to_date="2026-03-10").status_code == 409  # overlaps
    assert _apply(client, student, from_date="2026-03-06", to_date="2026-03-06").status_code == 422  # Friday off: no school days
    assert _apply(client, student, from_date="2026-03-10", to_date="2026-03-09").status_code == 422
    assert _apply(client, student, from_date="2026-03-01", to_date="2026-05-30").status_code == 422  # too long


def test_who_can_decide(client, as_role, others):
    student_leave = _apply(client, as_role("parent"), student_id=1).json()["leave_id"]
    staff_leave = _apply(client, others("librarian")).json()["leave_id"]

    decide = lambda headers, leave_id, approve=True: client.post(f"/api/leave/{leave_id}/decision", headers=headers, json={"approve": approve, "note": "ok"})  # noqa: E731
    assert decide(others("teacher3"), student_leave).status_code == 403  # teaches another class
    assert decide(as_role("teacher"), staff_leave).status_code == 403  # staff leave: admin only
    assert decide(as_role("student"), student_leave).status_code == 403

    teacher_view = client.get("/api/leave/approvals", headers=as_role("teacher")).json()
    assert [i["leave_id"] for i in teacher_view["items"]] == [student_leave] and teacher_view["items"][0]["can_decide"]
    assert client.get("/api/leave/approvals", headers=others("teacher3")).json()["total"] == 0

    r = decide(as_role("teacher"), student_leave)
    assert r.status_code == 200 and r.json()["status"] == "approved" and r.json()["decided_by_name"] == "Teacher One"
    assert decide(as_role("admin"), student_leave).status_code == 409  # already decided
    assert decide(as_role("admin"), staff_leave, approve=False).json()["status"] == "rejected"

    mine = client.get("/api/leave/mine", headers=as_role("student")).json()
    assert mine["total"] == 1 and mine["items"][0]["applicant_role"] == "parent"


def test_cancel_only_own_pending(client, as_role):
    leave_id = _apply(client, as_role("parent"), student_id=1).json()["leave_id"]
    assert client.post(f"/api/leave/{leave_id}/cancel", headers=as_role("student")).status_code == 403  # not the applicant
    r = client.post(f"/api/leave/{leave_id}/cancel", headers=as_role("parent"))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert client.post(f"/api/leave/{leave_id}/cancel", headers=as_role("parent")).status_code == 409

    # cancelled leave no longer blocks the dates
    approved = _apply(client, as_role("parent"), student_id=1).json()["leave_id"]
    client.post(f"/api/leave/{approved}/decision", headers=as_role("admin"), json={"approve": True})
    assert client.post(f"/api/leave/{approved}/cancel", headers=as_role("parent")).status_code == 409


def test_attendance_sheet_marks_leave_and_skips_absence_sms(client, as_role, monkeypatch):
    admin = as_role("admin")
    with SessionLocal() as db:
        db.get(Parent, 1).phone = "+15550100"
        db.commit()
    client.put("/api/settings", headers=admin, json={"active_sms_service": "twilio"})
    leave_id = _apply(client, as_role("parent"), student_id=1).json()["leave_id"]

    sheet = lambda: client.get("/api/attendance/sheet", headers=admin, params={"class_id": 1, "section_id": 1, "date": "2026-03-03"}).json()  # noqa: E731
    assert [r["on_leave"] for r in sheet()] == [False, False]  # pending leave does not count
    client.post(f"/api/leave/{leave_id}/decision", headers=admin, json={"approve": True})
    rows = sheet()
    assert {r["student_id"]: r["on_leave"] for r in rows} == {1: True, 2: False}

    sent = []
    monkeypatch.setattr(attendance, "send_sms", lambda phone, text: sent.append((phone, text)))
    items = [{"attendance_id": r["attendance_id"], "status": 2} for r in rows]
    r = client.put("/api/attendance/sheet", headers=admin, json={"class_id": 1, "section_id": 1, "date": "2026-03-03", "items": items})
    assert r.status_code == 200
    assert sent == []  # Kid One is on leave; Kid Two has no parent phone


def test_summary_and_anonymous(client, as_role):
    leave_id = _apply(client, as_role("student")).json()["leave_id"]
    client.post(f"/api/leave/{leave_id}/decision", headers=as_role("admin"), json={"approve": True})
    body = client.get("/api/leave/summary", headers=as_role("admin")).json()
    assert body["year"] == YEAR and body["people"] == [{"role": "student", "id": 1, "name": "Kid One", "days": 5, "requests": 1}]
    assert client.get("/api/leave/summary", headers=as_role("teacher")).status_code == 403
    assert client.get("/api/leave/mine").status_code == 401


def test_approved_staff_leave_marks_staff_attendance(client, as_role):
    r = client.post(
        "/api/leave", headers=as_role("teacher"),
        json={"kind": "sick", "from_date": "2026-03-09", "to_date": "2026-03-10", "reason": "Flu"},
    )  # fmt: skip
    assert r.status_code == 201, r.text
    with SessionLocal() as db:
        assert db.scalars(select(StaffAttendance)).all() == []
    assert client.post(f"/api/leave/{r.json()['leave_id']}/decision", headers=as_role("admin"), json={"approve": True}).status_code == 200
    with SessionLocal() as db:
        rows = db.scalars(select(StaffAttendance).order_by(StaffAttendance.date)).all()
    assert [(a.staff_role, a.staff_id, a.date.isoformat(), a.status) for a in rows] == [
        ("teacher", 1, "2026-03-09", "leave"),
        ("teacher", 1, "2026-03-10", "leave"),
    ]
