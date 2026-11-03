import json
import time
from datetime import date

from app.api.routers.online_exams import grade, is_correct
from app.db.session import SessionLocal
from app.models import OnlineExam, QuestionBank


def test_marks_entry_and_marksheet(client, as_role):
    teacher = as_role("teacher")
    sheet = client.get("/api/marks?exam_id=1&class_id=1&section_id=1&subject_id=1", headers=teacher)
    assert sheet.status_code == 200
    rows = sheet.json()
    assert [r["student_name"] for r in rows] == ["Kid One", "Kid Two"]
    saved = client.put(
        "/api/marks",
        headers=teacher,
        json={
            "exam_id": 1, "class_id": 1, "section_id": 1, "subject_id": 1,
            "items": [{"mark_id": rows[0]["mark_id"], "mark_obtained": 85}, {"mark_id": rows[1]["mark_id"], "mark_obtained": 40}],
        },  # fmt: skip
    )
    assert saved.status_code == 200
    # teacher one does not teach physics
    assert client.get("/api/marks?exam_id=1&class_id=1&section_id=1&subject_id=2", headers=teacher).status_code == 403

    sheet = client.get("/api/marksheet/1", headers=as_role("student")).json()
    math = next(s for s in sheet["exams"][0]["subjects"] if s["subject"] == "Math")
    assert math["mark_obtained"] == 85 and math["grade"] == "A" and math["highest"] == 85

    tab = client.get("/api/tabulation?class_id=1&exam_id=1", headers=teacher).json()
    assert [r["total"] for r in tab["rows"]] == [85, 40]


def test_attendance_sheet_and_report(client, as_role):
    teacher = as_role("teacher")
    day = date(2025, 9, 14)
    rows = client.get(f"/api/attendance/sheet?class_id=1&section_id=1&date={day}", headers=teacher).json()
    assert len(rows) == 2 and all(r["status"] == 0 for r in rows)
    items = [{"attendance_id": rows[0]["attendance_id"], "status": 1}, {"attendance_id": rows[1]["attendance_id"], "status": 2}]
    r = client.put("/api/attendance/sheet", headers=teacher, json={"class_id": 1, "section_id": 1, "date": str(day), "items": items})
    assert [x["status"] for x in r.json()] == [1, 2]
    report = client.get("/api/attendance/report?class_id=1&section_id=1&month=2025-09", headers=teacher).json()
    assert report["rows"][0]["days"] == {"14": 1}
    own = client.get("/api/attendance/student/2?month=2025-09", headers=as_role("student2")).json()
    assert own["absent"] == 1


def test_invoice_partial_payments(client, as_role):
    admin = as_role("admin")
    inv = client.post(
        "/api/invoices", headers=admin, json={"student_id": 1, "title": "Fee", "amount": 1000, "amount_paid": 300}
    ).json()
    assert inv["status"] == "unpaid" and inv["due"] == "700"
    assert client.post(f"/api/invoices/{inv['invoice_id']}/payments", headers=admin, json={"amount": 800}).status_code == 422
    paid = client.post(f"/api/invoices/{inv['invoice_id']}/payments", headers=admin, json={"amount": 700}).json()
    assert paid["status"] == "paid" and paid["due"] == "0"
    detail = client.get(f"/api/invoices/{inv['invoice_id']}", headers=as_role("parent")).json()
    assert len(detail["payments"]) == 2
    assert client.get(f"/api/invoices/{inv['invoice_id']}", headers=as_role("student2")).status_code == 403
    summary = client.get("/api/finance/summary", headers=admin).json()
    assert summary["income"] == 1000


def test_student_crud_with_enrolment(client, as_role):
    admin = as_role("admin")
    r = client.post(
        "/api/students",
        headers=admin,
        json={"name": "New Kid", "email": "new@example.com", "password": "Password1!", "class_id": 1, "section_id": 1, "roll": 3},
    )
    assert r.status_code == 201, r.text
    sid = r.json()["student_id"]
    assert r.json()["class_name"] == "Ten" and r.json()["roll"] == 3
    r = client.put(
        f"/api/students/{sid}",
        headers=admin,
        json={"name": "New Kid", "email": "new@example.com", "class_id": 1, "section_id": 1, "roll": 9},
    )
    assert r.json()["roll"] == 9
    assert client.delete(f"/api/students/{sid}", headers=admin).status_code == 204
    assert client.get(f"/api/students/{sid}", headers=admin).status_code == 404


def test_messaging_rules(client, as_role):
    student = as_role("student")
    r = client.post("/api/messages", headers=student, data={"receiver": "teacher-1", "message": "Hello"})
    assert r.status_code == 201
    # students may not message other students
    assert client.post("/api/messages", headers=student, data={"receiver": "student-2", "message": "hi"}).status_code == 403
    teacher = as_role("teacher")
    threads = client.get("/api/messages/threads", headers=teacher).json()
    assert threads[0]["unread"] == 1 and threads[0]["other_name"] == "Kid One"
    code = threads[0]["code"]
    client.get(f"/api/messages/threads/{code}", headers=teacher)
    assert client.get("/api/messages/unread-count", headers=teacher).json()["unread"] == 0
    assert client.get(f"/api/messages/threads/{code}", headers=as_role("student2")).status_code == 403


def _question(qtype, correct, mark="1", options=None):
    return QuestionBank(
        question_bank_id=1, type=qtype, mark=mark, correct_answers=correct,
        options=json.dumps(options) if options else None,
    )  # fmt: skip


def test_online_exam_grading_rules():
    mc = _question("multiple_choice", json.dumps(["1", "3"]), options=["a", "b", "c"])
    assert is_correct(mc, ["3", "1"]) and not is_correct(mc, ["1"])
    tf = _question("true_false", "true")
    assert is_correct(tf, ["True"]) and not is_correct(tf, ["false"])
    fb = _question("fill_in_the_blanks", json.dumps(["dhaka", "river"]))
    assert is_correct(fb, [" Dhaka", "RIVER "]) and not is_correct(fb, ["river", "dhaka"])
    q2 = _question("true_false", "false", mark="3")
    q2.question_bank_id = 2
    assert grade([tf, q2], {1: ["true"], 2: ["true"]}, 50) == (1, "fail")
    assert grade([tf, q2], {1: ["true"], 2: ["false"]}, 50) == (4, "pass")


def test_online_exam_full_flow(client, as_role):
    teacher = as_role("teacher")
    today = date.today().isoformat()
    exam = client.post(
        "/api/online-exams",
        headers=teacher,
        json={
            "title": "Quiz", "class_id": 1, "section_id": 1, "subject_id": 1, "exam_date": today,
            "time_start": "00:00", "time_end": "23:59", "minimum_percentage": 50,
        },  # fmt: skip
    ).json()
    eid = exam["online_exam_id"]
    q = client.post(
        f"/api/online-exams/{eid}/questions",
        headers=teacher,
        json={"type": "true_false", "question_title": "Sky is blue", "mark": 2, "correct_answers": ["true"]},
    ).json()
    assert client.put(f"/api/online-exams/{eid}/status", headers=teacher, json={"status": "published"}).status_code == 200

    student = as_role("student")
    started = client.post(f"/api/online-exams/{eid}/start", headers=student).json()
    assert "correct_answers" not in json.dumps(started["questions"])
    result = client.post(
        f"/api/online-exams/{eid}/submit",
        headers=student,
        json={"answers": [{"question_bank_id": q["question_bank_id"], "answer": ["true"]}]},
    ).json()
    assert result == {"obtained_mark": 2, "total_mark": 2, "result": "pass"}
    assert client.post(f"/api/online-exams/{eid}/start", headers=student).status_code == 409


def test_online_exam_closed_outside_window(client, as_role):
    with SessionLocal() as db:
        db.add(
            OnlineExam(
                title="Old", class_id=1, section_id=1, subject_id=1, status="published", running_year="2025-2026",
                exam_date=int(time.time()) - 10 * 86400, time_start="09:00", time_end="10:00",
            )  # fmt: skip
        )
        db.commit()
    assert client.post("/api/online-exams/1/start", headers=as_role("student")).status_code == 409
