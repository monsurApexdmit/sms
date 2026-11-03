import io

import pytest
from openpyxl import load_workbook
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import Enroll, Mark, Section, Student
from app.services import export
from tests.conftest import YEAR

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _sheet(r) -> list[tuple]:
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == XLSX
    assert r.headers["content-disposition"].startswith("attachment; filename=")
    return [tuple(row) for row in load_workbook(io.BytesIO(r.content)).active.iter_rows(values_only=True)]


# --- exports ----------------------------------------------------------------------


def test_people_exports(client, as_role):
    admin = as_role("admin")
    rows = _sheet(client.get("/api/export/students.xlsx", headers=admin, params={"class_id": 1}))
    assert rows[0][:3] == ("Student ID", "Name", "Class")
    assert {r[1] for r in rows[1:]} == {"Kid One", "Kid Two"}

    rows = _sheet(client.get("/api/export/parents.xlsx", headers=admin))
    assert rows[0][0] == "Name" and rows[1][0] == "Parent"

    full = _sheet(client.get("/api/export/teachers.xlsx", headers=admin))
    assert "Phone" in full[0] and len(full) == 3
    # other roles get the directory columns only, as on the Teachers screen
    directory = _sheet(client.get("/api/export/teachers.xlsx", headers=as_role("student")))
    assert directory[0] == ("Name", "Email", "Designation")

    assert client.get("/api/export/parents.xlsx", headers=as_role("teacher")).status_code == 403
    assert client.get("/api/export/students.xlsx", headers=as_role("student")).status_code == 403


def test_finance_exports_keep_types(client, as_role):
    admin = as_role("admin")
    client.post("/api/invoices", headers=admin, json={"student_id": 1, "title": "=HYPERLINK(\"x\")", "amount": 1000, "amount_paid": 250.5})
    client.post("/api/expenses", headers=admin, json={"title": "Chalk", "amount": 12.5, "date": "2026-02-10"})

    rows = _sheet(client.get("/api/export/invoices.xlsx", headers=admin, params={"status": "unpaid"}))
    header, inv = rows[0], rows[1]
    assert inv[header.index("Total")] == 1000 and inv[header.index("Paid")] == 250.5
    assert inv[header.index("Title")] == '=HYPERLINK("x")'  # stored as text, not a formula
    assert inv[header.index("Created")].year >= 2026  # a real date cell

    rows = _sheet(client.get("/api/export/payments.xlsx", headers=admin, params={"payment_type": "expense"}))
    assert rows[1][rows[0].index("Amount")] == 12.5
    assert rows[1][0].date().isoformat() == "2026-02-10"

    for path in ("/api/export/invoices.xlsx", "/api/export/payments.xlsx"):
        assert client.get(path, headers=as_role("teacher")).status_code == 403


def test_attendance_tabulation_and_marks_exports(client, as_role):
    admin = as_role("admin")
    client.post("/api/calendar", headers=admin, json={"title": "Eid", "start_date": "2026-03-20", "kind": "holiday"})
    with SessionLocal() as db:
        db.add(Mark(student_id=1, exam_id=1, class_id=1, section_id=1, subject_id=1, year=YEAR, mark_obtained=88))
        db.commit()

    rows = _sheet(client.get("/api/export/attendance.xlsx", headers=as_role("teacher"), params={"class_id": 1, "section_id": 1, "month": "2026-03"}))
    header = rows[0]
    assert header[:2] == ("Roll", "Student") and header[-3:] == ("Present", "Absent", "Working days")
    assert rows[1][header.index("20")] == "H"

    rows = _sheet(client.get("/api/export/tabulation.xlsx", headers=admin, params={"class_id": 1, "exam_id": 1}))
    assert rows[0][2:4] == ("Math", "Physics")
    assert rows[1][1] == "Kid One" and rows[1][2] == 88

    params = {"exam_id": 1, "class_id": 1, "section_id": 1, "subject_id": 1}
    rows = _sheet(client.get("/api/export/marks.xlsx", headers=as_role("teacher"), params=params))
    assert rows[1][1:3] == ("Kid One", 88)
    # Physics belongs to the other teacher
    assert client.get("/api/export/marks.xlsx", headers=as_role("teacher"), params={**params, "subject_id": 2}).status_code == 403
    assert client.get("/api/export/tabulation.xlsx", headers=as_role("parent"), params={"class_id": 1, "exam_id": 1}).status_code == 403


def test_audit_log_export(client, as_role):
    admin = as_role("admin")
    client.put("/api/settings", headers=admin, json={"system_name": "New Name"})
    rows = _sheet(client.get("/api/export/audit-log.xlsx", headers=admin, params={"table_name": "settings"}))
    assert rows[0][0] == "When (UTC)"
    assert any("Test School → New Name" in (r[6] or "") for r in rows[1:])
    assert client.get("/api/export/audit-log.xlsx", headers=as_role("teacher")).status_code == 403


def test_export_refuses_too_many_rows(client, as_role, monkeypatch):
    monkeypatch.setattr(export, "MAX_ROWS", 1)
    r = client.get("/api/export/teachers.xlsx", headers=as_role("admin"))
    assert r.status_code == 422 and "limited to 1" in r.json()["detail"]


# --- marks import -----------------------------------------------------------------

SHEET = {"exam_id": "1", "class_id": "1", "section_id": "1", "subject_id": "1"}


def _import(client, headers, text: str, form=SHEET):
    return client.post("/api/marks/import", headers=headers, data=form, files={"file": ("marks.csv", text.encode(), "text/csv")})


def _marks() -> dict[int, tuple]:
    with SessionLocal() as db:
        return {m.student_id: (m.mark_obtained, m.comment) for m in db.scalars(select(Mark).where(Mark.subject_id == 1))}


def test_marks_template_and_import(client, as_role):
    teacher = as_role("teacher")
    r = client.get("/api/marks/import-template", headers=teacher, params=SHEET)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.text.strip().splitlines()
    assert lines[0] == "student_id,roll,name,mark_obtained,comment"
    assert lines[1].startswith("1,1,Kid One,")

    r = _import(client, teacher, "student_id,roll,name,mark_obtained,comment\r\n1,1,Kid One,91,Great\r\n2,2,Kid Two,75,\r\n")
    assert r.status_code == 200, r.text
    assert r.json() == {"updated": 2}
    assert _marks() == {1: (91, "Great"), 2: (75, None)}

    # without a comment column existing comments are kept; a blank mark clears it
    assert _import(client, teacher, "﻿student_id,mark_obtained\n1,\n").status_code == 200
    assert _marks()[1] == (None, "Great")


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ("student_id,mark_obtained\n1,80\n2,1001\n", "Line 3: mark_obtained"),
        ("student_id,mark_obtained\n1,80\n2,-5\n", "Line 3: mark_obtained"),
        ("student_id,mark_obtained\n1,80\n2,abc\n", "Line 3: mark 'abc' is not a number"),
        ("student_id,mark_obtained\n1,80\n2,70.5\n", "must be a whole number"),
        ("student_id,mark_obtained\n1,80\n1,70\n", "appears more than once"),
        ("student_id,mark_obtained\n1,80\nx,70\n", "is not a number"),
        ("name,mark\nKid,1\n", "needs the columns"),
    ],
)
def test_marks_import_is_all_or_nothing(client, as_role, body, message):
    before = _marks()
    r = _import(client, as_role("admin"), body)
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["message"].startswith("Nothing was imported")
    assert any(message in e for e in detail["errors"]), detail["errors"]
    assert {sid: v for sid, v in _marks().items() if v != (None, None)} == {sid: v for sid, v in before.items() if v != (None, None)}


def test_marks_import_rejects_student_from_another_section(client, as_role):
    with SessionLocal() as db:
        db.add(Section(name="B", class_id=1))
        db.add(Student(name="Kid Three", email="s3@example.com"))
        db.flush()
        db.add(Enroll(student_id=3, class_id=1, section_id=2, roll=1, year=YEAR))
        db.commit()
    r = _import(client, as_role("admin"), "student_id,mark_obtained\n1,80\n3,90\n")
    assert r.status_code == 422
    assert r.json()["detail"]["errors"] == ["Line 3: student 3 is not enrolled in this class section"]
    assert _marks().get(1, (None, None))[0] is None


def test_marks_import_permissions(client, as_role):
    body = "student_id,mark_obtained\n1,80\n"
    # teacher 1 teaches Math (subject 1), not Physics (subject 2)
    assert _import(client, as_role("teacher"), body, {**SHEET, "subject_id": "2"}).status_code == 403
    assert client.get("/api/marks/import-template", headers=as_role("teacher"), params={**SHEET, "subject_id": "2"}).status_code == 403
    assert _import(client, as_role("student"), body).status_code == 403
    assert _import(client, as_role("teacher2"), body, {**SHEET, "subject_id": "2"}).status_code == 200
