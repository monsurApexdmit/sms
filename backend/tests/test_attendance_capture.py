from datetime import date, datetime

import pytest
from sqlalchemy import select

from app.api.v1.endpoints import attendance_capture as capture_router
from app.api.v1.endpoints.attendance import day_ts
from app.db.session import SessionLocal
from app.models import Attendance, ClassRoutine, LeaveRequest, PeriodAttendance, StaffAttendance
from app.services import attendance_capture as capture
from tests.conftest import YEAR

MONDAY = date(2026, 3, 9)


def _routine(subject_id: int, hour: int) -> int:
    with SessionLocal() as db:
        r = ClassRoutine(
            class_id=1, section_id=1, subject_id=subject_id, day="monday", year=YEAR,
            time_start=hour, time_start_min=0, time_end=hour, time_end_min=45,
        )  # fmt: skip
        db.add(r)
        db.commit()
        return r.class_routine_id


def _daily(student_id: int, d: date = MONDAY) -> int | None:
    with SessionLocal() as db:
        row = db.scalars(select(Attendance).where(Attendance.student_id == student_id, Attendance.timestamp == day_ts(d))).first()
        return row.status if row else None


@pytest.fixture
def clock(monkeypatch):
    """Set the school clock: clock(hour, minute) on MONDAY."""

    def set_time(hour: int, minute: int = 0) -> None:
        now = datetime(MONDAY.year, MONDAY.month, MONDAY.day, hour, minute)
        monkeypatch.setattr(capture, "school_now", lambda: now)
        monkeypatch.setattr(capture_router, "school_now", lambda: now)

    set_time(7, 0)
    return set_time


# --- per-period attendance ---------------------------------------------------------------


def test_period_sheet_permissions_and_upsert(client, as_role):
    physics = _routine(2, 9)  # taught by teacher 2
    params = {"class_routine_id": physics, "date": MONDAY.isoformat()}
    assert client.get("/api/period-attendance/sheet", headers=as_role("teacher"), params=params).status_code == 403
    assert client.get("/api/period-attendance/sheet", headers=as_role("teacher2"), params={**params, "date": "2026-03-10"}).status_code == 422

    t2 = as_role("teacher2")
    periods = client.get("/api/period-attendance/periods", headers=t2, params={"date": MONDAY.isoformat()}).json()
    assert [p["class_routine_id"] for p in periods] == [physics]
    assert client.get("/api/period-attendance/periods", headers=as_role("teacher"), params={"date": MONDAY.isoformat()}).json() == []

    body = {"class_routine_id": physics, "date": MONDAY.isoformat(), "items": [{"student_id": 1, "status": "present"}, {"student_id": 2, "status": "late"}]}
    assert client.put("/api/period-attendance/sheet", headers=t2, json=body).status_code == 200
    body["items"][1]["status"] = "absent"
    sheet = client.put("/api/period-attendance/sheet", headers=t2, json=body).json()
    assert [r["status"] for r in sheet["rows"]] == ["present", "absent"]
    with SessionLocal() as db:
        assert len(db.scalars(select(PeriodAttendance)).all()) == 2
    body["items"] = [{"student_id": 99, "status": "present"}]
    assert client.put("/api/period-attendance/sheet", headers=t2, json=body).status_code == 422


def test_students_on_leave_are_excused(client, as_role):
    math = _routine(1, 8)
    with SessionLocal() as db:
        db.add(LeaveRequest(
            applicant_role="parent", applicant_id=1, student_id=1, kind="sick", from_date=MONDAY, to_date=MONDAY,
            days=1, status="approved", created_at=datetime(2026, 3, 1), year=YEAR,
        ))  # fmt: skip
        db.commit()
    sheet = client.get("/api/period-attendance/sheet", headers=as_role("teacher"), params={"class_routine_id": math, "date": MONDAY.isoformat()}).json()
    first = next(r for r in sheet["rows"] if r["student_id"] == 1)
    second = next(r for r in sheet["rows"] if r["student_id"] == 2)
    assert first["on_leave"] and first["status"] == "excused"
    assert not second["on_leave"] and second["status"] is None


def test_fill_daily_from_periods(client, as_role):
    math, physics = _routine(1, 8), _routine(2, 9)
    save = lambda role, routine, s1, s2: client.put(  # noqa: E731
        "/api/period-attendance/sheet", headers=as_role(role),
        json={"class_routine_id": routine, "date": MONDAY.isoformat(), "items": [{"student_id": 1, "status": s1}, {"student_id": 2, "status": s2}]},
    )  # fmt: skip
    body = {"class_id": 1, "section_id": 1, "date": MONDAY.isoformat()}
    assert client.post("/api/period-attendance/fill-daily", headers=as_role("teacher"), json=body).status_code == 422  # nothing taken yet
    assert save("teacher", math, "absent", "absent").status_code == 200
    assert save("teacher2", physics, "present", "absent").status_code == 200

    r = client.post("/api/period-attendance/fill-daily", headers=as_role("teacher"), json=body)
    assert r.json() == {"updated": 2, "kept": 0, "skipped": 0}
    assert (_daily(1), _daily(2)) == (1, 2)

    # already marked days are kept unless overwrite
    save("teacher2", physics, "present", "present")
    assert client.post("/api/period-attendance/fill-daily", headers=as_role("teacher"), json=body).json()["kept"] == 2
    assert _daily(2) == 2
    client.post("/api/period-attendance/fill-daily", headers=as_role("teacher"), json={**body, "overwrite": True})
    assert _daily(2) == 1
    assert client.post("/api/period-attendance/fill-daily", headers=as_role("student"), json=body).status_code == 403

    grid = client.get("/api/period-attendance/day", headers=as_role("teacher"), params={"class_id": 1, "section_id": 1, "date": MONDAY.isoformat()}).json()
    assert len(grid["periods"]) == 2 and grid["rows"][0]["statuses"][str(math)] == "absent"
    summary = client.get(
        "/api/period-attendance/summary", headers=as_role("admin"),
        params={"class_id": 1, "section_id": 1, "date_from": "2026-03-01", "date_to": "2026-03-31"},
    ).json()  # fmt: skip
    assert summary["rows"][0]["subjects"]["1"] == {"present": 0, "total": 1, "percent": 0.0}


# --- cards and kiosk -------------------------------------------------------------------------


def test_cards_and_kiosk_scans(client, as_role, clock):
    admin = as_role("admin")
    assert client.post("/api/id-cards", headers=as_role("teacher"), json={"holder_role": "student", "holder_id": 1}).status_code == 403
    assert client.post("/api/id-cards", headers=admin, json={"holder_role": "student", "holder_id": 1, "card_uid": "S-1"}).status_code == 201
    assert client.post("/api/id-cards", headers=admin, json={"holder_role": "student", "holder_id": 2, "card_uid": "S-1"}).status_code == 409
    assert client.post("/api/id-cards", headers=admin, json={"holder_role": "student", "holder_id": 999}).status_code == 404
    assert client.post("/api/id-cards/bulk", headers=admin, json={"class_id": 1}).json() == {"created": 1}  # only student 2 lacked one
    assert client.post("/api/id-cards/bulk", headers=admin, json={"class_id": 1}).json() == {"created": 0}
    card2 = next(c for c in client.get("/api/id-cards", headers=admin, params={"class_id": 1}).json()["items"] if c["holder_id"] == 2)
    assert client.put("/api/attendance-capture/settings", headers=admin, json={"late_after": "08:00", "duplicate_minutes": 10}).status_code == 200
    assert client.put("/api/attendance-capture/settings", headers=admin, json={"late_after": "8am"}).status_code == 422

    kiosk = as_role("teacher")
    scan = lambda uid: client.post("/api/attendance-kiosk/scan", headers=kiosk, json={"card_uid": uid}).json()  # noqa: E731
    clock(7, 50)
    first = scan("S-1")
    assert first["result"] == "marked_present" and first["name"] == "Kid One"
    assert _daily(1) == 1
    clock(7, 55)
    assert scan("S-1")["result"] == "duplicate"
    clock(9, 0)
    assert scan("S-1")["result"] == "already_marked"
    assert scan("nope")["result"] == "unknown_card"
    clock(8, 30)
    assert scan(card2["card_uid"])["result"] == "marked_late"
    assert _daily(2) == 1  # the legacy daily table has no "late"; it is kept on the punch

    # a reissued card replaces the old one
    client.post("/api/id-cards", headers=admin, json={"holder_role": "student", "holder_id": 1, "card_uid": "S-1B"})
    assert scan("S-1")["result"] == "unknown_card"
    assert client.post("/api/attendance-kiosk/scan", headers=as_role("student"), json={"card_uid": "S-1B"}).status_code == 403
    log = client.get("/api/attendance-punches", headers=admin, params={"date": MONDAY.isoformat()}).json()
    assert log["total"] == 6 and log["items"][0]["result"] == "unknown_card"


def test_staff_card_marks_staff_attendance(client, as_role, clock):
    admin = as_role("admin")
    client.post("/api/id-cards", headers=admin, json={"holder_role": "teacher", "holder_id": 1, "card_uid": "T-1"})
    client.put("/api/attendance-capture/settings", headers=admin, json={"late_after": "08:00", "duplicate_minutes": 5})
    clock(8, 10)
    assert client.post("/api/attendance-kiosk/scan", headers=admin, json={"card_uid": "T-1", "source": "rfid"}).json()["result"] == "marked_late"
    clock(15, 0)
    assert client.post("/api/attendance-kiosk/scan", headers=admin, json={"card_uid": "T-1"}).json()["result"] == "checked_out"
    with SessionLocal() as db:
        row = db.scalars(select(StaffAttendance)).one()
    assert (row.staff_role, row.staff_id, row.status, row.check_in, row.check_out) == ("teacher", 1, "late", "08:10", "15:00")


# --- devices ---------------------------------------------------------------------------------


def test_device_key_auth_and_punches(client, as_role, clock):
    admin = as_role("admin")
    client.post("/api/id-cards", headers=admin, json={"holder_role": "student", "holder_id": 1, "card_uid": "RF-01"})
    created = client.post("/api/attendance-devices", headers=admin, json={"name": "Gate 1", "location": "Main gate"}).json()
    key = created["api_key"]
    assert "api_key" not in client.get("/api/attendance-devices", headers=admin).json()[0]

    url = "/api/attendance-devices/punch"
    one = {"card_uid": "RF-01", "timestamp": "2026-03-09T07:45:00"}
    assert client.post(url, json=one).status_code == 401
    assert client.post(url, json=one, headers={"X-Device-Key": "dev_wrong"}).status_code == 401
    assert client.post(url, json=one, headers=admin).status_code == 401  # a user token is not a device key

    clock(8, 0)
    r = client.post(url, json={"punches": [{"card_uid": "RF-01", "timestamp": "2026-03-09T07:46:00"}, one, {"card_uid": "zzz"}]}, headers={"X-Device-Key": key})
    assert r.status_code == 200, r.text
    assert [x["result"] for x in r.json()["results"]] == ["marked_present", "duplicate", "unknown_card"]
    assert _daily(1) == 1
    future = {"card_uid": "RF-01", "timestamp": "2026-03-09T12:00:00"}
    assert client.post(url, json=future, headers={"X-Device-Key": key}).json()["results"][0]["result"] == "invalid_time"

    rotated = client.post(f"/api/attendance-devices/{created['device_id']}/rotate-key", headers=admin).json()["api_key"]
    assert client.post(url, json=one, headers={"X-Device-Key": key}).status_code == 401
    client.put(f"/api/attendance-devices/{created['device_id']}", headers=admin, json={"name": "Gate 1", "active": False})
    assert client.post(url, json=one, headers={"X-Device-Key": rotated}).status_code == 401
