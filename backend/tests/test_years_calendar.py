from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import AcademicYear, Attendance
from app.services.settings import running_year
from tests.conftest import YEAR

# --- academic years ---------------------------------------------------------------


def test_years_and_terms(client, as_role):
    admin = as_role("admin")
    r = client.post("/api/school-years", headers=admin, json={"name": "2026-2027", "start_date": "2026-07-01", "end_date": "2027-06-30"})
    assert r.status_code == 201, r.text
    new_id = r.json()["academic_year_id"]
    assert client.post("/api/school-years", headers=admin, json={"name": "2026-2027"}).status_code == 409
    assert client.post("/api/school-years", headers=admin, json={"name": "2026-2028"}).status_code == 422
    assert client.put(f"/api/school-years/{new_id}", headers=admin, json={"start_date": "2027-01-01", "end_date": "2026-01-01"}).status_code == 422

    r = client.post("/api/terms", headers=admin, json={"academic_year_id": new_id, "name": "Term 1", "start_date": "2026-07-01", "end_date": "2026-12-20"})
    assert r.status_code == 201, r.text
    years = client.get("/api/school-years", headers=as_role("student")).json()
    assert [t["name"] for t in next(y for y in years if y["name"] == "2026-2027")["terms"]] == ["Term 1"]
    assert client.post("/api/terms", headers=as_role("teacher"), json={"academic_year_id": new_id, "name": "X"}).status_code == 403


def test_make_current_keeps_legacy_setting_in_step(client, as_role):
    admin = as_role("admin")
    new_id = client.post("/api/school-years", headers=admin, json={"name": "2026-2027"}).json()["academic_year_id"]
    r = client.post(f"/api/school-years/{new_id}/make-current", headers=admin)
    assert r.status_code == 200 and r.json()["is_current"]
    with SessionLocal() as db:
        assert running_year(db) == "2026-2027"
        assert [y.name for y in db.scalars(select(AcademicYear).where(AcademicYear.is_current))] == ["2026-2027"]
    assert client.delete(f"/api/school-years/{new_id}", headers=admin).status_code == 409

    # changing running_year on the settings screen moves the flag too, creating the year if needed
    assert client.put("/api/settings", headers=admin, json={"running_year": YEAR}).status_code == 200
    with SessionLocal() as db:
        assert [y.name for y in db.scalars(select(AcademicYear).where(AcademicYear.is_current))] == [YEAR]
    assert client.put("/api/settings", headers=admin, json={"running_year": "2025-2027"}).status_code == 422


# --- calendar -----------------------------------------------------------------------


def test_calendar_audience_and_range(client, as_role):
    admin = as_role("admin")
    for body in (
        {"title": "Eid holiday", "start_date": "2026-03-20", "end_date": "2026-03-22", "kind": "holiday"},
        {"title": "Staff meeting", "start_date": "2026-03-10", "kind": "meeting", "audience": "staff"},
        {"title": "Parents day", "start_date": "2026-03-12", "audience": "parents"},
        {"title": "April event", "start_date": "2026-04-05"},
    ):
        assert client.post("/api/calendar", headers=admin, json=body).status_code == 201
    assert client.post("/api/calendar", headers=admin, json={"title": "x", "start_date": "2026-03-05", "end_date": "2026-03-01"}).status_code == 422
    assert client.post("/api/calendar", headers=as_role("teacher"), json={"title": "x", "start_date": "2026-03-05"}).status_code == 403

    march = {"from": "2026-03-01", "to": "2026-03-31"}
    titles = lambda role: {e["title"] for e in client.get("/api/calendar", headers=as_role(role), params=march).json()}  # noqa: E731
    assert titles("admin") == {"Eid holiday", "Staff meeting", "Parents day"}
    assert titles("teacher") == {"Eid holiday", "Staff meeting"}
    assert titles("parent") == {"Eid holiday", "Parents day"}
    assert titles("student") == {"Eid holiday"}

    day = client.get("/api/calendar/day", headers=as_role("teacher"), params={"date": "2026-03-21"}).json()
    assert day["holiday"] == "Eid holiday" and day["weekly_off"] is False


def test_attendance_report_counts_working_days(client, as_role):
    admin = as_role("admin")
    # Fridays off; 2026-03-20..22 holiday (Fri 20 is both)
    client.put("/api/settings", headers=admin, json={"weekly_off_days": "4"})
    client.post("/api/calendar", headers=admin, json={"title": "Eid", "start_date": "2026-03-20", "end_date": "2026-03-22", "kind": "holiday"})
    assert client.put("/api/settings", headers=admin, json={"weekly_off_days": "4,9"}).status_code == 422

    report = client.get("/api/attendance/report", headers=admin, params={"class_id": 1, "section_id": 1, "month": "2026-03"}).json()
    assert report["holidays"] == {"20": "Eid", "21": "Eid", "22": "Eid"}
    assert report["off_days"] == [6, 13, 20, 27]
    assert report["working_days"] == 31 - 4 - 2  # 4 Fridays, plus Sat 21 and Sun 22

    with SessionLocal() as db:
        db.add(Attendance(student_id=1, class_id=1, section_id=1, year=YEAR, timestamp="1772582400", status=1))  # 2026-03-04
        db.commit()
    mine = client.get("/api/attendance/student/1", headers=as_role("student"), params={"month": "2026-03"}).json()
    assert mine["present"] == 1 and mine["working_days"] == 25
