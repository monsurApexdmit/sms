from datetime import timedelta

import pytest

from app.api.v1.endpoints.homework import school_today
from app.db.session import SessionLocal
from app.models import Enroll, Homework, SchoolClass, Section, Student
from tests.conftest import PASSWORD, YEAR, login


def _due(days: int = 7) -> str:
    return (school_today() + timedelta(days=days)).isoformat()


def _create(client, headers, **overrides):
    data = {"title": "Algebra sheet", "class_id": "1", "subject_id": "1", "due_date": _due(), "max_marks": "10", **overrides}
    return client.post("/api/homework", headers=headers, data=data)


@pytest.fixture
def homework_id(client, as_role) -> int:
    r = _create(client, as_role("teacher"))
    assert r.status_code == 201, r.text
    return r.json()["homework_id"]


def _set_due(homework_id: int, days: int, allow_late: bool = False) -> None:
    with SessionLocal() as db:
        hw = db.get(Homework, homework_id)
        hw.due_date = school_today() + timedelta(days=days)
        hw.allow_late = allow_late
        db.commit()


def _other_class_student(client) -> dict:
    """A student enrolled in another class, logged in."""
    from app.core.security import hash_password

    with SessionLocal() as db:
        db.add(SchoolClass(name="Nine", name_numeric="9"))
        db.flush()
        db.add(Section(name="B", class_id=2))
        db.add(Student(name="Other Kid", email="s3@example.com", password=hash_password(PASSWORD)))
        db.flush()
        db.add(Enroll(student_id=3, class_id=2, section_id=2, roll=1, year=YEAR))
        db.commit()
    return login(client, "s3@example.com")


# --- setting homework -------------------------------------------------------------


def test_teacher_sets_homework_only_for_own_subject(client, as_role):
    assert _create(client, as_role("teacher2")).status_code == 403  # Math belongs to teacher 1
    assert _create(client, as_role("teacher"), subject_id="2").status_code == 403
    assert _create(client, as_role("student")).status_code == 403
    assert _create(client, as_role("teacher"), due_date=_due(-1)).status_code == 422
    assert _create(client, as_role("teacher"), section_id="99").status_code == 422
    r = _create(client, as_role("admin"), subject_id="2")
    assert r.status_code == 201 and r.json()["teacher_id"] is None and r.json()["subject_name"] == "Physics"


def test_lists_are_scoped(client, as_role, homework_id):
    _create(client, as_role("admin"), subject_id="2", title="Optics")
    titles = lambda headers, **p: [h["title"] for h in client.get("/api/homework", headers=headers, params=p).json()["items"]]  # noqa: E731
    assert titles(as_role("teacher")) == ["Algebra sheet"]
    assert sorted(titles(as_role("admin"))) == ["Algebra sheet", "Optics"]
    assert sorted(titles(as_role("student"))) == ["Algebra sheet", "Optics"]
    assert sorted(titles(as_role("parent"), student_id=1)) == ["Algebra sheet", "Optics"]
    assert client.get("/api/homework", headers=as_role("parent"), params={"student_id": 2}).status_code == 403
    assert titles(as_role("admin"), status="closed") == []

    other = _other_class_student(client)
    assert titles(other) == []
    assert client.get(f"/api/homework/{homework_id}", headers=other).status_code == 403
    assert client.get(f"/api/homework/{homework_id}", headers=as_role("teacher2")).status_code == 403

    staff_view = client.get("/api/homework", headers=as_role("teacher")).json()["items"][0]
    assert (staff_view["students"], staff_view["submitted"], staff_view["graded"]) == (2, 0, 0)


def test_only_author_subject_teacher_edits_and_deletes(client, as_role, homework_id):
    data = {"title": "Renamed", "due_date": _due(3), "max_marks": "20"}
    assert client.put(f"/api/homework/{homework_id}", headers=as_role("teacher2"), data=data).status_code == 403
    r = client.put(f"/api/homework/{homework_id}", headers=as_role("teacher"), data=data)
    assert r.status_code == 200 and r.json()["title"] == "Renamed" and r.json()["max_marks"] == 20
    assert client.delete(f"/api/homework/{homework_id}", headers=as_role("teacher2")).status_code == 403
    assert client.delete(f"/api/homework/{homework_id}", headers=as_role("teacher")).status_code == 204


# --- submitting -----------------------------------------------------------------------


def test_submit_resubmit_and_lock_after_grading(client, as_role, homework_id):
    student = as_role("student")
    url = f"/api/homework/{homework_id}/submission"
    assert client.post(url, headers=student, data={"text": "  "}).status_code == 422
    assert client.post(url, headers=as_role("parent"), data={"text": "x"}).status_code == 403
    assert client.post(url, headers=_other_class_student(client), data={"text": "x"}).status_code == 403

    first = client.post(url, headers=student, data={"text": "x = 2"})
    assert first.status_code == 200 and first.json()["is_late"] is False
    second = client.post(url, headers=student, files={"file": ("answer.pdf", b"%PDF-1.4", "application/pdf")})
    assert second.status_code == 200
    assert second.json()["submission_id"] == first.json()["submission_id"]
    assert second.json()["text"] is None and second.json()["file_url"]

    teacher = as_role("teacher")
    sub_id = second.json()["submission_id"]
    assert client.put(f"/api/homework/submissions/{sub_id}/grade", headers=teacher, json={"marks": 11}).status_code == 422
    assert client.put(f"/api/homework/submissions/{sub_id}/grade", headers=as_role("teacher2"), json={"marks": 5}).status_code == 403
    graded = client.put(f"/api/homework/submissions/{sub_id}/grade", headers=teacher, json={"marks": 8.5, "feedback": "Good"})
    assert graded.status_code == 200 and graded.json()["marks"] == 8.5 and graded.json()["graded_at"]

    assert client.post(url, headers=student, data={"text": "changed"}).status_code == 409
    # max marks cannot drop below an existing grade
    data = {"title": "Algebra sheet", "due_date": _due(), "max_marks": "5"}
    assert client.put(f"/api/homework/{homework_id}", headers=teacher, data=data).status_code == 422

    mine = client.get("/api/homework", headers=as_role("parent"), params={"student_id": 1}).json()["items"][0]["submission"]
    assert mine["marks"] == 8.5 and mine["feedback"] == "Good"


def test_late_submissions(client, as_role, homework_id):
    student = as_role("student")
    url = f"/api/homework/{homework_id}/submission"
    _set_due(homework_id, -1)
    assert client.post(url, headers=student, data={"text": "late"}).status_code == 409
    _set_due(homework_id, -1, allow_late=True)
    r = client.post(url, headers=student, data={"text": "late"})
    assert r.status_code == 200 and r.json()["is_late"] is True


def test_submission_file_type_is_checked(client, as_role, homework_id):
    r = client.post(
        f"/api/homework/{homework_id}/submission", headers=as_role("student"),
        files={"file": ("shell.php", b"<?php echo 1;", "application/x-php")},
    )  # fmt: skip
    assert r.status_code == 400
    assert _create(client, as_role("teacher"), title="With sheet").status_code == 201
    bad = client.post(
        "/api/homework", headers=as_role("teacher"),
        data={"title": "Bad", "class_id": "1", "subject_id": "1", "due_date": _due()},
        files={"file": ("x.exe", b"MZ", "application/octet-stream")},
    )  # fmt: skip
    assert bad.status_code == 400


def test_roster_lists_students_who_have_not_submitted(client, as_role, homework_id):
    client.post(f"/api/homework/{homework_id}/submission", headers=as_role("student"), data={"text": "done"})
    roster = client.get(f"/api/homework/{homework_id}/submissions", headers=as_role("teacher")).json()
    assert [(r["name"], r["submission"] is not None) for r in roster] == [("Kid One", True), ("Kid Two", False)]
    assert client.get(f"/api/homework/{homework_id}/submissions", headers=as_role("teacher2")).status_code == 403
    assert client.get(f"/api/homework/{homework_id}/submissions", headers=as_role("student")).status_code == 403
