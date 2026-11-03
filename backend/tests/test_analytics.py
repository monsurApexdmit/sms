import calendar
import io
from datetime import date, datetime, timedelta

import pytest
from openpyxl import load_workbook

from app.api.routers import analytics as analytics_router
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import (
    Accountant,
    Attendance,
    ClassRoutine,
    Exam,
    FeeInstalment,
    FeeInvoice,
    FeePlan,
    Homework,
    HomeworkSubmission,
    Invoice,
    LeaveRequest,
    Mark,
    Payment,
    SchoolClass,
    StaffAttendance,
    Subject,
    Teacher,
)
from app.services import analytics
from tests.conftest import PASSWORD, YEAR, login

TODAY = date(2026, 3, 20)


def ts(d: date) -> int:
    return calendar.timegm(d.timetuple())


@pytest.fixture(autouse=True)
def seeded(monkeypatch):
    """Student 1 (Kid One) is struggling on every signal; student 2 only owes fees.

    Class 1 / section 1 has both students, Math (teacher 1) and Physics (teacher 2);
    grades: A 80-100 (5), F 0-79 (0). Teacher 3 teaches only class 2.
    """
    monkeypatch.setattr(analytics, "school_today", lambda: TODAY)
    monkeypatch.setattr(analytics_router, "school_today", lambda: TODAY)
    with SessionLocal() as db:
        pw = hash_password(PASSWORD)
        db.add(Accountant(name="Acc", email="acc@example.com", password=pw))
        db.add(Teacher(name="Teacher Three", email="t3@example.com", password=pw))
        db.add(SchoolClass(name="Nine", name_numeric="9"))
        db.flush()
        db.add(Subject(name="Biology", class_id=2, teacher_id=3, year=YEAR))
        db.add(Exam(name="Term 2", year=YEAR))

        # attendance Mon 16 - Thu 19 March: student 1 present once, student 2 every day
        for i, day in enumerate(TODAY - timedelta(days=k) for k in (4, 3, 2, 1)):
            db.add(Attendance(student_id=1, class_id=1, section_id=1, year=YEAR, timestamp=str(ts(day)), status=1 if i == 0 else 2))
            db.add(Attendance(student_id=2, class_id=1, section_id=1, year=YEAR, timestamp=str(ts(day)), status=1))

        # marks: student 1 falls from 87.5 % to 55 % and fails both subjects; student 2 improves
        for sid, exam_id, math, physics in ((1, 1, 90, 85), (1, 2, 50, 60), (2, 1, 70, 75), (2, 2, 95, 90)):
            for subject_id, mark in ((1, math), (2, physics)):
                db.add(Mark(student_id=sid, subject_id=subject_id, class_id=1, section_id=1, exam_id=exam_id, mark_obtained=mark, mark_total=100, year=YEAR))

        # invoices: s1 owes 100 (legacy, created 40 days ago -> 10 days late); s2 owes 150 (70 days late)
        # and paid a fee-plan instalment of 300 in full
        db.add(Invoice(student_id=1, title="Books", amount=100, amount_paid="0", due="100", status="unpaid", creation_timestamp=ts(TODAY - timedelta(days=40)), year=YEAR))
        db.add(Invoice(student_id=2, title="Trip", amount=200, amount_paid="50", due="150", status="unpaid", creation_timestamp=ts(TODAY - timedelta(days=100)), year=YEAR))
        db.add(Invoice(student_id=2, title="Tuition", amount=300, amount_paid="300", due="0", status="paid", creation_timestamp=ts(date(2026, 3, 15)), year=YEAR))
        db.flush()
        plan = FeePlan(name="Class Ten fees", class_id=1, year=YEAR)
        db.add(plan)
        db.flush()
        inst = FeeInstalment(fee_plan_id=plan.fee_plan_id, name="March", due_date=date(2026, 3, 15), share_percent=100)
        db.add(inst)
        db.flush()
        db.add(FeeInvoice(invoice_id=3, fee_plan_id=plan.fee_plan_id, fee_instalment_id=inst.fee_instalment_id, student_id=2, base_amount=300))
        db.add(Payment(payment_type="income", invoice_id=2, student_id=2, amount="50", timestamp=str(ts(date(2026, 3, 18))), year=YEAR))
        db.add(Payment(payment_type="income", invoice_id=3, student_id=2, amount="300", timestamp=str(ts(date(2026, 3, 15))), year=YEAR))

        # homework: 3 due; student 2 handed all in (one late), student 1 none; one is graded
        for n, due in enumerate((date(2026, 3, 1), date(2026, 3, 5), date(2026, 3, 10)), start=1):
            db.add(Homework(class_id=1, subject_id=1, teacher_id=1, title=f"HW {n}", assigned_on=due - timedelta(days=3), due_date=due, year=YEAR, allow_late=True))
        db.add(Homework(class_id=1, subject_id=1, teacher_id=1, title="Not due yet", assigned_on=TODAY, due_date=TODAY + timedelta(days=5), year=YEAR, allow_late=False))
        db.flush()
        for hw in (1, 2, 3):
            db.add(HomeworkSubmission(homework_id=hw, student_id=2, submitted_at=datetime(2026, 3, hw * 3), is_late=hw == 3, graded_at=datetime(2026, 3, 12) if hw == 1 else None))

        db.add(LeaveRequest(applicant_role="parent", applicant_id=1, student_id=1, kind="sick", from_date=date(2026, 2, 2), to_date=date(2026, 2, 13), days=10, status="approved", created_at=datetime(2026, 2, 1), year=YEAR))
        db.add(LeaveRequest(staff_role="teacher", staff_id=1, applicant_role="teacher", applicant_id=1, kind="casual", from_date=date(2026, 3, 2), to_date=date(2026, 3, 3), days=2, status="approved", created_at=datetime(2026, 3, 1), year=YEAR))
        db.add_all([ClassRoutine(class_id=1, section_id=1, subject_id=1, day=d, year=YEAR) for d in ("monday", "tuesday")])
        for k, status in enumerate(("present", "present", "absent", "leave")):
            db.add(StaffAttendance(staff_role="teacher", staff_id=1, date=date(2026, 3, 2 + k), status=status))
        db.commit()


# --- at risk ----------------------------------------------------------------------------


def test_at_risk_scores_and_reasons(client, as_role):
    body = client.get("/api/analytics/at-risk", headers=as_role("admin")).json()
    assert body["total"] == 2 and body["counts"] == {"high": 1, "medium": 0, "low": 1}
    first, second = body["items"]
    assert first["name"] == "Kid One" and first["score"] == 100 and first["level"] == "high"
    assert first["attendance_pct"] == 25.0 and first["marked_days"] == 4
    assert (first["previous_exam_pct"], first["latest_exam_pct"], first["failing_subjects"]) == (87.5, 55.0, 2)
    assert first["overdue_amount"] == 100 and first["homework_rate"] == 0 and first["leave_days"] == 10
    reasons = " | ".join(first["reasons"])
    for text in ("Attendance 25%", "Failing 2 subjects", "fell from 87.5% to 55%", "Overdue fees of 100", "0% of 3 homework", "10 school days"):
        assert text in reasons

    assert second["name"] == "Kid Two" and second["score"] == 10 and second["level"] == "low"
    assert second["reasons"] == ["Overdue fees of 150"] and second["homework_rate"] == 100

    # thresholds come from the query: a lower attendance bar and a high minimum score
    loose = client.get("/api/analytics/at-risk", headers=as_role("admin"), params={"min_attendance": 20, "min_score": 50}).json()
    assert loose["total"] == 1 and not any("Attendance" in r for r in loose["items"][0]["reasons"])


def test_at_risk_export(client, as_role):
    r = client.get("/api/analytics/at-risk.xlsx", headers=as_role("admin"))
    assert r.status_code == 200
    rows = list(load_workbook(io.BytesIO(r.content)).active.values)
    assert rows[0][:5] == ("Student", "Class", "Section", "Roll", "Score") and rows[1][0] == "Kid One" and rows[1][4] == 100


# --- fees -----------------------------------------------------------------------------------


def test_fee_overview(client, as_role):
    body = client.get("/api/analytics/fees", headers=login(client, "acc@example.com")).json()
    assert (body["billed"], body["collected"], body["outstanding"]) == (600, 350, 250)
    assert body["collection_rate"] == 58.3
    assert body["monthly"][-1] == {"month": "2026-03", "billed": 300, "collected": 350}
    assert len(body["monthly"]) == 12 and body["monthly"][0]["month"] == "2025-04"
    assert {b["bucket"]: (b["amount"], b["invoices"]) for b in body["ageing"]} == {"1-30": (100, 1), "31-60": (0, 0), "61-90": (150, 1), "90+": (0, 0)}
    assert body["overdue"] == 250
    assert body["by_class"] == [{"class_id": 1, "class_name": "Ten", "outstanding": 250, "students": 2}]
    (inst,) = body["instalments"]
    assert (inst["instalment"], inst["invoices"], inst["billed"], inst["collected"], inst["rate"]) == ("March", 1, 300, 300, 100.0)


def test_defaulters_and_export(client, as_role):
    body = client.get("/api/analytics/fees/defaulters", headers=as_role("admin"), params={"limit": 1}).json()
    assert body["total"] == 2 and body["amount"] == 250 and len(body["items"]) == 1
    top = body["items"][0]
    assert (top["name"], top["amount"], top["days_overdue"], top["oldest_due"]) == ("Kid Two", 150, 70, "2026-01-09")
    r = client.get("/api/analytics/fees/defaulters.xlsx", headers=as_role("admin"))
    rows = list(load_workbook(io.BytesIO(r.content)).active.values)
    assert [row[0] for row in rows] == ["Student", "Kid Two", "Kid One"]


# --- attendance and exams ---------------------------------------------------------------------


def test_attendance_overview(client, as_role):
    body = client.get("/api/analytics/attendance", headers=as_role("teacher"), params={"month": "2026-03"}).json()
    (section,) = body["sections"]
    assert (section["present"], section["absent"], section["rate"]) == (5, 3, 62.5)
    assert body["rate"] == 62.5
    assert body["today"] == {"present": 0, "absent": 0, "not_marked": 2, "enrolled": 2}
    assert body["trend"][-1] == {"month": "2026-03", "rate": 62.5} and len(body["trend"]) == 6
    assert [(c["name"], c["rate"]) for c in body["chronic"]] == [("Kid One", 25.0)]
    # this month (default) has the same data
    assert client.get("/api/analytics/attendance", headers=as_role("admin")).json()["month"] == "2026-03"
    assert client.get("/api/analytics/attendance", headers=as_role("admin"), params={"month": "2026-13"}).status_code == 422


def test_exam_overview(client, as_role):
    body = client.get("/api/analytics/exams", headers=as_role("admin")).json()
    assert [e["name"] for e in body["exams"]] == ["Term 1", "Term 2"] and body["exam_id"] == 2
    (cls,) = body["classes"]
    assert (cls["complete"], cls["pass_rate"]) == (2, 50.0) and cls["average"] == pytest.approx(73.75, abs=0.06)
    math = next(s for s in body["subjects"] if s["subject"] == "Math")
    assert (math["marks"], math["pass_rate"], math["average"]) == (2, 50.0, 72.5)
    assert body["grades"] == [{"grade": "A", "count": 2}, {"grade": "F", "count": 2}]
    assert body["top"][0]["name"] == "Kid Two" and body["top"][0]["result"] == "Pass"

    first = client.get("/api/analytics/exams", headers=as_role("admin"), params={"exam_id": 1}).json()
    assert first["classes"][0]["pass_rate"] == 50.0  # Kid Two failed both subjects in Term 1


# --- workload ------------------------------------------------------------------------------------


def test_workload(client, as_role):
    rows = {r["name"]: r for r in client.get("/api/analytics/workload", headers=as_role("admin")).json()}
    one = rows["Teacher One"]
    assert (one["periods_per_week"], one["subjects"], one["classes"]) == (2, 1, 1)
    assert (one["homework_set"], one["ungraded"], one["meetings"], one["leave_days"]) == (4, 2, 0, 2)
    assert one["attendance_rate"] == pytest.approx(66.7)
    assert rows["Teacher Three"]["subjects"] == 1 and rows["Teacher Three"]["attendance_rate"] is None
    mine = client.get("/api/analytics/workload", headers=as_role("teacher2")).json()
    assert [r["name"] for r in mine] == ["Teacher Two"]


# --- access ---------------------------------------------------------------------------------------


def test_access_rules(client, as_role):
    student, parent, teacher = as_role("student"), as_role("parent"), as_role("teacher")
    accountant = login(client, "acc@example.com")
    outsider = login(client, "t3@example.com")
    for path in ("summary", "at-risk", "fees", "fees/defaulters", "attendance", "exams", "workload"):
        assert client.get(f"/api/analytics/{path}", headers=student).status_code == 403
        assert client.get(f"/api/analytics/{path}", headers=parent).status_code == 403
    for path in ("at-risk", "attendance", "exams", "workload", "summary"):
        assert client.get(f"/api/analytics/{path}", headers=accountant).status_code == 403
    assert client.get("/api/analytics/fees", headers=accountant).status_code == 200
    for path in ("fees", "fees/defaulters", "fees/defaulters.xlsx", "summary"):
        assert client.get(f"/api/analytics/{path}", headers=teacher).status_code == 403

    # a teacher only sees classes they teach
    assert client.get("/api/analytics/at-risk", headers=teacher, params={"class_id": 1}).json()["total"] == 2
    assert client.get("/api/analytics/at-risk", headers=outsider, params={"class_id": 1}).status_code == 403
    assert client.get("/api/analytics/at-risk.xlsx", headers=outsider, params={"class_id": 1}).status_code == 403
    assert client.get("/api/analytics/at-risk", headers=outsider).json()["total"] == 0
    assert client.get("/api/analytics/attendance", headers=outsider, params={"month": "2026-03"}).json()["sections"] == []
    assert client.get("/api/analytics/exams", headers=outsider).json()["classes"] == []


def test_dashboard_summary(client, as_role):
    body = client.get("/api/analytics/summary", headers=as_role("admin")).json()
    assert body == {"at_risk_high": 1, "at_risk_medium": 0, "billed_this_month": 300, "collected_this_month": 350}
