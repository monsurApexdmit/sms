import calendar
from datetime import date

import pytest
from sqlalchemy import update

from app.core.security import hash_password
from app.db import SessionLocal
from app.models import AcademicYear, Attendance, Enroll, Exam, Grade, Mark, Section, Student, Teacher
from app.services.results import rank
from tests.conftest import PASSWORD, YEAR, login


@pytest.fixture(autouse=True)
def grades():
    """Grades A (80-100, 5), B (40-79, 4), F (0-39, 0) instead of the fixture's A/F split."""
    with SessionLocal() as db:
        db.execute(update(Grade).where(Grade.name == "F").values(mark_upto=39))
        db.add(Grade(name="B", grade_point="4", mark_from=40, mark_upto=79))
        db.commit()


def _marks(exam_id: int, rows: dict[int, tuple[int | None, int | None]]) -> None:
    """rows: student_id -> (Math, Physics); subjects 1 and 2 of class 1."""
    with SessionLocal() as db:
        for sid, (math, physics) in rows.items():
            for subject_id, mark in ((1, math), (2, physics)):
                db.add(Mark(student_id=sid, subject_id=subject_id, class_id=1, section_id=1, exam_id=exam_id, mark_obtained=mark, year=YEAR))
        db.commit()


def _card(client, headers, student_id, **params):
    return client.get(f"/api/report-cards/student/{student_id}", headers=headers, params=params)


def test_rank_ties_share_a_position():
    assert rank({1: 90, 2: 95, 3: 90, 4: 70}) == {2: 1, 1: 2, 3: 2, 4: 4}


def test_exam_report_card_gpa_and_fail_rule(client, as_role):
    _marks(1, {1: (90, 85), 2: (95, 30)})
    admin = as_role("admin")

    one = _card(client, admin, 1, exam_id=1).json()
    assert one["result"] == "Pass" and one["gpa"] == 5.0
    assert one["total"] == 175 and one["full_total"] == 200 and one["percentage"] == 87.5
    assert [(s["subject"], s["grade"]) for s in one["subjects"]] == [("Math", "A"), ("Physics", "A")]

    two = _card(client, admin, 2, exam_id=1).json()
    assert two["result"] == "Fail" and two["gpa"] == 0.0  # Physics 30 is an F
    # positions rank by total even when failing: 175 > 125
    assert (one["position_class"], two["position_class"]) == (1, 2)
    assert one["class_size"] == 2


def test_missing_mark_is_incomplete(client, as_role):
    _marks(1, {1: (90, None), 2: (50, 60)})
    card = _card(client, as_role("admin"), 1, exam_id=1).json()
    assert card["result"] == "Incomplete" and card["gpa"] is None
    assert _card(client, as_role("admin"), 2, exam_id=1).json()["gpa"] == 4.0


def test_positions_in_class_and_section_with_ties(client, as_role):
    with SessionLocal() as db:
        db.add(Section(name="B", class_id=1))
        db.add(Student(name="Kid Three", email="s3@example.com", password=hash_password(PASSWORD)))
        db.flush()
        db.add(Enroll(student_id=3, class_id=1, section_id=2, roll=1, year=YEAR))
        db.commit()
    _marks(1, {1: (80, 80), 2: (90, 70), 3: (50, 50)})

    cards = client.get("/api/report-cards", headers=as_role("admin"), params={"class_id": 1, "exam_id": 1}).json()
    pos = {c["student"]["student_id"]: (c["position_class"], c["position_section"], c["section_size"]) for c in cards}
    assert pos == {1: (1, 1, 2), 2: (1, 1, 2), 3: (3, 1, 1)}

    only_a = client.get("/api/report-cards", headers=as_role("teacher"), params={"class_id": 1, "section_id": 1, "exam_id": 1}).json()
    assert {c["student"]["student_id"] for c in only_a} == {1, 2}
    assert only_a[0]["class_size"] == 3  # positions still over the whole class


def test_attendance_percent_uses_working_days(client, as_role):
    admin = as_role("admin")
    with SessionLocal() as db:
        db.add(AcademicYear(name=YEAR, start_date=date(2026, 3, 2), end_date=date(2026, 3, 8), is_current=True))
        for day, status in ((2, 1), (3, 1), (5, 2), (6, 1)):
            ts = calendar.timegm(date(2026, 3, day).timetuple())
            db.add(Attendance(student_id=1, class_id=1, section_id=1, year=YEAR, timestamp=str(ts), status=status))
        db.commit()
    client.put("/api/settings", headers=admin, json={"weekly_off_days": "5,6"})  # Sat, Sun
    client.post("/api/calendar", headers=admin, json={"title": "Holiday", "start_date": "2026-03-04", "kind": "holiday"})
    _marks(1, {1: (90, 90)})

    att = _card(client, admin, 1, exam_id=1).json()["attendance"]
    # Mon 2 - Sun 8: 5 weekdays minus the Wednesday holiday = 4 working days, present on 3
    assert att["working_days"] == 4 and att["present"] == 3 and att["absent"] == 1
    assert att["percent"] == 75.0


def test_annual_result_is_weighted(client, as_role):
    admin = as_role("admin")
    with SessionLocal() as db:
        db.add(Exam(name="Final", year=YEAR))
        db.commit()
    _marks(1, {1: (90, 85), 2: (60, 60)})  # 87.5%, GPA 5 / 60%, GPA 4
    _marks(2, {1: (95, 95), 2: (50, 70)})  # 95%, GPA 5 / 60%, GPA 4

    r = client.put("/api/exam-weights", headers=admin, json={"year": YEAR, "weights": [{"exam_id": 1, "weight": 40}, {"exam_id": 2, "weight": 50}]})
    assert r.json()["total"] == 90 and "not 100%" in r.json()["warnings"][0]
    r = client.put("/api/exam-weights", headers=admin, json={"year": YEAR, "weights": [{"exam_id": 2, "weight": 60}]})
    assert r.json()["total"] == 100 and r.json()["warnings"] == []
    assert client.put("/api/exam-weights", headers=as_role("teacher"), json={"year": YEAR, "weights": []}).status_code == 403

    annual = _card(client, admin, 1).json()
    assert annual["kind"] == "annual" and annual["result"] == "Pass"
    assert annual["percentage"] == 92.0  # 0.4 * 87.5 + 0.6 * 95
    assert annual["gpa"] == 5.0 and annual["position_class"] == 1
    math = next(s for s in annual["subjects"] if s["subject"] == "Math")
    assert math["marks"] == {"1": 90, "2": 95} and math["weighted_percentage"] == 93.0
    assert _card(client, admin, 2).json()["gpa"] == 4.0



def test_incomplete_annual_result_has_no_percentage_or_position(client, as_role):
    admin = as_role("admin")
    with SessionLocal() as db:
        db.add(Exam(name="Final", year=YEAR))
        db.commit()
    _marks(1, {1: (90, 85), 2: (60, 60)})
    _marks(2, {1: (95, 95), 2: (50, None)})  # student 2 has no Physics mark in the final
    client.put("/api/exam-weights", headers=admin, json={"year": YEAR, "weights": [{"exam_id": 1, "weight": 40}, {"exam_id": 2, "weight": 60}]})

    complete, incomplete = _card(client, admin, 1).json(), _card(client, admin, 2).json()
    assert complete["percentage"] == 92.0 and complete["position_class"] == 1
    assert incomplete["result"] == "Incomplete" and incomplete["gpa"] is None
    # not 0.4 * 60 + 0.6 * 25 with the missing mark counted as 0
    assert incomplete["percentage"] is None
    assert incomplete["position_class"] is None and incomplete["position_section"] is None

def test_timetable_clashes_and_access(client, as_role):
    admin = as_role("admin")
    paper = {"exam_id": 1, "class_id": 1, "exam_date": "2026-04-01"}
    a = client.post("/api/exam-schedule", headers=admin, json={**paper, "subject_id": 1, "start_time": "09:00", "end_time": "11:00", "room": "101"})
    assert a.status_code == 201 and a.json()["clashes"] == []
    b = client.post("/api/exam-schedule", headers=admin, json={**paper, "subject_id": 2, "start_time": "10:30", "end_time": "12:00"})
    assert b.json()["clashes"] == [a.json()["exam_schedule_id"]]
    client.post("/api/exam-schedule", headers=admin, json={**paper, "subject_id": 2, "start_time": "11:00", "end_time": "12:00", "exam_date": "2026-04-02"})

    rows = client.get("/api/exam-schedule", headers=as_role("teacher"), params={"exam_id": 1, "class_id": 1}).json()
    assert [len(r["clashes"]) for r in rows] == [1, 1, 0]

    assert client.post("/api/exam-schedule", headers=admin, json={**paper, "subject_id": 1, "start_time": "12:00", "end_time": "11:00"}).status_code == 422
    assert client.post("/api/exam-schedule", headers=as_role("teacher"), json={**paper, "subject_id": 1, "start_time": "13:00", "end_time": "14:00"}).status_code == 403

    student = as_role("student")
    assert client.get("/api/exam-schedule", headers=student, params={"exam_id": 1, "class_id": 1}).status_code == 403
    assert len(client.get("/api/exam-schedule/student/1", headers=student, params={"exam_id": 1}).json()) == 3
    card = client.get("/api/admit-cards/student/1", headers=student, params={"exam_id": 1}).json()
    assert card["student"]["roll"] == 1 and [p["subject"] for p in card["schedule"]] == ["Math", "Physics", "Physics"]
    assert client.get("/api/admit-cards/student/2", headers=student, params={"exam_id": 1}).status_code == 403
    assert len(client.get("/api/admit-cards", headers=admin, params={"exam_id": 1, "class_id": 1}).json()) == 2


def test_report_card_access_and_remarks(client, as_role):
    _marks(1, {1: (90, 85), 2: (95, 30)})
    student, parent = as_role("student"), as_role("parent")
    assert _card(client, student, 1, exam_id=1).status_code == 200
    assert _card(client, student, 2, exam_id=1).status_code == 403
    assert _card(client, parent, 1, exam_id=1).status_code == 200
    assert _card(client, parent, 2, exam_id=1).status_code == 403
    assert client.get("/api/report-cards", headers=student, params={"class_id": 1, "exam_id": 1}).status_code == 403

    with SessionLocal() as db:
        db.add(Teacher(name="Other Teacher", email="t3@example.com", password=hash_password(PASSWORD)))
        db.commit()
    outsider = login(client, "t3@example.com")
    remark = {"exam_id": 1, "remark": "Excellent work"}
    assert client.put("/api/report-cards/student/1/remark", headers=outsider, json=remark).status_code == 403
    assert client.put("/api/report-cards/student/1/remark", headers=student, json=remark).status_code == 403
    assert client.put("/api/report-cards/student/1/remark", headers=as_role("teacher"), json=remark).status_code == 200
    assert _card(client, parent, 1, exam_id=1).json()["remark"] == "Excellent work"
    # the annual remark is separate
    assert _card(client, parent, 1).json()["remark"] is None
    client.put("/api/report-cards/student/1/remark", headers=as_role("admin"), json={"exam_id": 1, "remark": "  "})
    assert _card(client, parent, 1, exam_id=1).json()["remark"] is None
