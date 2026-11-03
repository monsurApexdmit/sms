"""Features ported from the legacy app: SMS, answer scripts, contact form, PayPal, CSV template, filters."""

import csv
import io
import json
from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy import select

from app.api.routers.students import BULK_COLUMNS
from app.db.session import SessionLocal
from app.models import ClassRoutine, Invoice, OnlineExam, Parent, Payment, QuestionBank, Setting, Student, Teacher
from app.services import jobs, notify
from app.services.settings import MASK


def _set(**values: str) -> None:
    with SessionLocal() as db:
        for key, value in values.items():
            row = db.scalars(select(Setting).where(Setting.type == key)).first()
            if row is None:
                db.add(Setting(type=key, description=value))
            else:
                row.description = value
        db.commit()


def _phones() -> None:
    with SessionLocal() as db:
        db.get(Student, 1).phone = "+111"
        db.get(Student, 2).phone = "+222"
        db.get(Parent, 1).phone = "+333"
        db.get(Teacher, 1).phone = "+444"
        db.commit()


# --- 1-3, 10: small additions -------------------------------------------------


def test_student_list_transport_and_dormitory_filters(client, as_role):
    with SessionLocal() as db:
        db.get(Student, 1).transport_id = 3
        db.get(Student, 2).dormitory_id = 4
        db.commit()
    admin = as_role("admin")
    by_transport = client.get("/api/students?transport_id=3", headers=admin).json()
    assert by_transport["total"] == 1 and by_transport["items"][0]["student_id"] == 1
    by_dorm = client.get("/api/students?dormitory_id=4", headers=admin).json()
    assert [s["student_id"] for s in by_dorm["items"]] == [2]
    assert client.get("/api/students?transport_id=3", headers=as_role("student")).status_code == 403


def test_bulk_csv_template_matches_import(client, as_role):
    assert client.get("/api/students/bulk-csv/template").status_code == 401
    assert client.get("/api/students/bulk-csv/template", headers=as_role("student")).status_code == 403
    assert client.get("/api/students/bulk-csv/template", headers=as_role("teacher")).status_code == 200
    r = client.get("/api/students/bulk-csv/template", headers=as_role("admin"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(r.text)))
    assert tuple(rows[0]) == BULK_COLUMNS and len(rows) == 2
    # the template itself imports cleanly
    up = client.post(
        "/api/students/bulk-csv",
        headers=as_role("admin"),
        data={"class_id": "1", "section_id": "1"},
        files={"file": ("bulk_student.csv", r.content, "text/csv")},
    )
    assert up.json() == {"created": 1, "errors": []}


def test_payments_filter_by_student(client, as_role):
    admin = as_role("admin")
    for sid in (1, 2):
        client.post("/api/invoices", headers=admin, json={"student_id": sid, "title": "Fee", "amount": 100, "amount_paid": 40})
    items = client.get("/api/payments?student_id=2", headers=admin).json()["items"]
    assert len(items) == 1 and items[0]["student_id"] == 2
    assert client.get("/api/payments?student_id=2", headers=as_role("parent")).status_code == 403


def test_teacher_can_view_any_class_routine(client, as_role):
    with SessionLocal() as db:
        db.add(
            ClassRoutine(
                class_id=1, section_id=1, subject_id=2, day="sunday", time_start=9, time_start_min=0,
                time_end=10, time_end_min=0, year="2025-2026",
            )  # fmt: skip
        )
        db.commit()
    r = client.get("/api/class-routines?class_id=1&section_id=1", headers=as_role("teacher"))
    assert r.status_code == 200 and r.json()["total"] == 1
    assert client.post("/api/class-routines", headers=as_role("teacher"), json={}).status_code == 403
    assert client.get("/api/class-routines?class_id=1", headers=as_role("student")).status_code == 403


# --- 4-6: SMS -----------------------------------------------------------------


def test_exam_marks_sms(client, as_role, monkeypatch):
    sent: list[tuple[str, str]] = []
    _phones()
    admin, teacher = as_role("admin"), as_role("teacher")
    sheet = client.get("/api/marks?exam_id=1&class_id=1&section_id=1&subject_id=1", headers=teacher).json()
    client.put(
        "/api/marks",
        headers=teacher,
        json={
            "exam_id": 1, "class_id": 1, "section_id": 1, "subject_id": 1,
            "items": [{"mark_id": sheet[0]["mark_id"], "mark_obtained": 78}],
        },  # fmt: skip
    )
    body = {"class_id": 1, "section_id": 1, "receiver": "student"}
    assert client.post("/api/exams/1/marks-sms", json=body).status_code == 401
    assert client.post("/api/exams/1/marks-sms", headers=teacher, json=body).status_code == 403
    assert client.post("/api/exams/1/marks-sms", headers=admin, json=body).status_code == 400  # SMS disabled

    _set(active_sms_service="twilio")
    monkeypatch.setattr("app.api.routers.exams.send_sms", lambda phone, text: sent.append((phone, text)))
    r = client.post("/api/exams/1/marks-sms", headers=admin, json=body)
    assert r.json() == {"queued": 1}  # Kid Two has no marks
    assert sent == [("+111", "Kid One: Term 1 results – Math 78")]
    sent.clear()
    r = client.post("/api/exams/1/marks-sms", headers=admin, json={**body, "receiver": "parent"})
    assert r.json() == {"queued": 1} and sent[0][0] == "+333"
    assert client.post("/api/exams/1/marks-sms", headers=admin, json={**body, "receiver": "x"}).status_code == 422
    assert client.post("/api/exams/99/marks-sms", headers=admin, json=body).status_code == 404


def test_notice_send_sms(client, as_role, monkeypatch):
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr("app.services.notify.send_sms", lambda phone, text: sent.append((phone, text)))
    _phones()
    _set(active_sms_service="msg91")
    admin = as_role("admin")
    r = client.post("/api/notices", headers=admin, data={"notice_title": "Sports day", "send_sms": "0"})
    assert r.status_code == 201 and sent == []
    r = client.post("/api/notices", headers=admin, data={"notice_title": "Sports day", "send_sms": "1"})
    assert r.status_code == 201
    assert sorted(p for p, _ in sent) == ["+111", "+222", "+333", "+444"]
    assert sent[0][1].startswith("Sports day on ")
    sent.clear()
    nid = r.json()["notice_id"]
    r = client.put(f"/api/notices/{nid}", headers=admin, data={"notice_title": "Moved", "send_sms": "1"})
    assert r.status_code == 200 and len(sent) == 4 and sent[0][1].startswith("Moved on ")
    assert client.post("/api/notices", headers=admin, data={"notice_title": "x", "send_sms": "yes"}).status_code == 422


def test_clickatell_settings_and_delivery(client, as_role, monkeypatch):
    admin = as_role("admin")
    r = client.put(
        "/api/settings",
        headers=admin,
        json={"active_sms_service": "clickatell", "clickatell_user": "u", "clickatell_password": "pw", "clickatell_api_id": "42"},
    )
    assert r.status_code == 200 and r.json()["clickatell_password"] == MASK
    client.put("/api/settings", headers=admin, json={"clickatell_password": MASK})
    assert client.put("/api/settings", headers=admin, json={"active_sms_service": "carrier-pigeon"}).status_code == 422

    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append((url, params))
        return httpx.Response(200, text="ID: abc123", request=httpx.Request("GET", url))

    monkeypatch.setattr(notify.httpx, "get", fake_get)
    notify.send_sms("+15550100", "hello")
    assert calls[0][0] == "https://api.clickatell.com/http/sendmsg"
    assert calls[0][1] == {"user": "u", "password": "pw", "api_id": "42", "to": "+15550100", "text": "hello"}

    def failing_get(url, params=None, timeout=None):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(notify.httpx, "get", failing_get)
    # raised so the job queue retries it; the in-process fallback only logs it
    with pytest.raises(httpx.ConnectError):
        notify.send_sms("+15550100", "hello")
    jobs._run_logged(notify.send_sms, "+15550100", "hello")


# --- 7: online exam answer script ---------------------------------------------


def _exam_with_submission(client, as_role) -> int:
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    with SessionLocal() as db:
        exam = OnlineExam(
            title="Quiz", class_id=1, section_id=1, subject_id=1, exam_date=int(today.timestamp()),
            time_start="00:00", time_end="23:59", minimum_percentage="50", status="published", running_year="2025-2026",
        )  # fmt: skip
        db.add(exam)
        db.flush()
        db.add_all(
            [
                QuestionBank(
                    online_exam_id=exam.online_exam_id, type="multiple_choice", question_title="2+2?", mark="2",
                    options=json.dumps(["3", "4", "5"]), number_of_options=3, correct_answers=json.dumps(["2"]),
                ),
                QuestionBank(online_exam_id=exam.online_exam_id, type="true_false", question_title="Sky is blue", mark="1", correct_answers="true"),
                QuestionBank(
                    online_exam_id=exam.online_exam_id, type="fill_in_the_blanks", question_title="__ and __", mark="1",
                    correct_answers=json.dumps(["salt", "pepper"]),
                ),
            ]
        )  # fmt: skip
        db.commit()
        exam_id = exam.online_exam_id
        qids = [q.question_bank_id for q in db.scalars(select(QuestionBank).order_by(QuestionBank.question_bank_id))]
    student = as_role("student")
    started = client.post(f"/api/online-exams/{exam_id}/start", headers=student)
    assert started.status_code == 200, started.text
    answers = [
        {"question_bank_id": qids[0], "answer": ["1"]},
        {"question_bank_id": qids[1], "answer": ["true"]},
        {"question_bank_id": qids[2], "answer": ["Salt", "pepper"]},
    ]
    r = client.post(f"/api/online-exams/{exam_id}/submit", headers=student, json={"answers": answers})
    assert r.status_code == 200 and r.json()["obtained_mark"] == 2
    return exam_id


def test_answer_script_access_and_content(client, as_role):
    if datetime.now(timezone.utc).strftime("%H:%M") >= "23:58":
        pytest.skip("exam window used by this test closes at 23:59 UTC")
    exam_id = _exam_with_submission(client, as_role)
    url = f"/api/online-exams/{exam_id}/answer-script"
    student = as_role("student")
    assert client.get(url).status_code == 401
    before = client.get(url, headers=student)
    assert before.status_code == 403
    assert before.json()["detail"] == "Answer script is available after the exam closes"

    with SessionLocal() as db:
        db.get(OnlineExam, exam_id).status = "expired"
        db.commit()

    r = client.get(url, headers=student)
    assert r.status_code == 200
    data = r.json()
    assert data["exam"] == {
        "online_exam_id": exam_id, "title": "Quiz", "class_name": "Ten", "subject_name": "Math",
        "total_marks": 4, "minimum_percentage": 50,
    }  # fmt: skip
    assert data["student"] == {"student_id": 1, "name": "Kid One"}
    assert data["obtained_mark"] == 2 and data["result"] == "pass"
    mc, tf, fill = data["questions"]
    assert mc["options"] == ["3", "4", "5"] and mc["correct_answers"] == ["2"]
    assert mc["submitted_answers"] == ["1"] and mc["is_correct"] is False
    assert tf["correct_answers"] == ["true"] and tf["is_correct"] is True and tf["options"] == []
    assert fill["correct_answers"] == ["salt", "pepper"] and fill["submitted_answers"] == ["Salt", "pepper"]
    assert fill["is_correct"] is True

    # student_id is ignored for students
    assert client.get(f"{url}?student_id=2", headers=student).json()["student"]["student_id"] == 1
    # a student who did not submit gets nothing
    assert client.get(url, headers=as_role("student2")).status_code == 403
    parent = as_role("parent")
    assert client.get(f"{url}?student_id=1", headers=parent).status_code == 200
    assert client.get(f"{url}?student_id=2", headers=parent).status_code == 403
    assert client.get(url, headers=parent).status_code == 403
    assert client.get(f"{url}?student_id=1", headers=as_role("teacher")).status_code == 200
    assert client.get(f"{url}?student_id=1", headers=as_role("teacher2")).status_code == 403  # not their subject
    admin = as_role("admin")
    assert client.get(f"{url}?student_id=1", headers=admin).status_code == 200
    assert client.get(url, headers=admin).status_code == 422


def test_answer_script_available_once_end_time_passed(client, as_role):
    if datetime.now(timezone.utc).strftime("%H:%M") >= "23:58":
        pytest.skip("exam window used by this test closes at 23:59 UTC")
    exam_id = _exam_with_submission(client, as_role)
    with SessionLocal() as db:
        exam = db.get(OnlineExam, exam_id)
        exam.exam_date -= 86400  # yesterday: the window is over, status still "published"
        db.commit()
    assert client.get(f"/api/online-exams/{exam_id}/answer-script", headers=as_role("student")).status_code == 200


# --- 8: contact form ----------------------------------------------------------


@pytest.fixture
def outbox(monkeypatch):
    mails: list[tuple[str, str, str]] = []
    monkeypatch.setattr("app.api.routers.cms.send_email", lambda to, subject, body: mails.append((to, subject, body)))
    return mails


MSG = {"name": "Ann Visitor", "email": "ann@example.com", "phone": "555", "message": "Do you have places in class 3?"}


def test_contact_form_sends_email(client, as_role, outbox):
    site = client.get("/api/public/site").json()
    assert site["contact_enabled"] is False and site["recaptcha_site_key"] is None
    assert client.post("/api/public/contact", json=MSG).status_code == 503

    client.put("/api/cms/settings", headers=as_role("admin"), json={"email": "office@school.test", "recaptcha_site_key": "site-k"})
    site = client.get("/api/public/site").json()
    assert site["contact_enabled"] is True and site["recaptcha_site_key"] == "site-k"
    r = client.post("/api/public/contact", json=MSG)
    assert r.status_code == 202 and r.json() == {"status": "sent"}
    to, subject, body = outbox[0]
    assert to == "office@school.test" and subject == "Contact form: Ann Visitor"
    assert "ann@example.com" in body and MSG["message"] in body


def test_contact_falls_back_to_system_email(client, outbox):
    _set(system_email="admin@school.test")
    assert client.get("/api/public/site").json()["contact_enabled"] is True
    assert client.post("/api/public/contact", json=MSG).status_code == 202
    assert outbox[0][0] == "admin@school.test"


def test_contact_validation_and_rate_limit(client, outbox):
    _set(system_email="admin@school.test")
    assert client.post("/api/public/contact", json={**MSG, "name": "x" * 101}).status_code == 422
    assert client.post("/api/public/contact", json={**MSG, "email": "not-an-email"}).status_code == 422
    assert client.post("/api/public/contact", json={**MSG, "message": "x" * 5001}).status_code == 422
    assert client.post("/api/public/contact", json={**MSG, "message": ""}).status_code == 422
    codes = [client.post("/api/public/contact", json=MSG).status_code for _ in range(6)]
    assert codes == [202] * 5 + [429]
    assert len(outbox) == 5


def test_contact_recaptcha(client, as_role, outbox, monkeypatch):
    admin = as_role("admin")
    client.put("/api/cms/settings", headers=admin, json={"email": "office@school.test", "recaptcha_secret_key": "s3cret"})
    cms_settings = client.get("/api/cms/settings", headers=admin).json()
    assert cms_settings["recaptcha_secret_key"] == MASK
    client.put("/api/cms/settings", headers=admin, json={"recaptcha_secret_key": MASK})  # keeps the stored secret
    assert "s3cret" not in client.get("/api/public/site").text
    assert client.get("/api/cms/settings", headers=as_role("teacher")).status_code == 403

    verified = []

    def fake_post(url, data=None, timeout=None):
        verified.append((url, data))
        ok = data["response"] == "good-token"
        return httpx.Response(200, json={"success": ok}, request=httpx.Request("POST", url))

    monkeypatch.setattr("app.api.routers.cms.httpx.post", fake_post)
    r = client.post("/api/public/contact", json=MSG)
    assert r.status_code == 400 and outbox == []
    assert client.post("/api/public/contact", json={**MSG, "recaptcha_token": "bad"}).status_code == 400
    assert client.post("/api/public/contact", json={**MSG, "recaptcha_token": "good-token"}).status_code == 202
    assert verified[-1][0] == "https://www.google.com/recaptcha/api/siteverify"
    assert verified[-1][1]["secret"] == "s3cret"
    assert len(outbox) == 1


# --- 9: PayPal ----------------------------------------------------------------


class FakePayPal:
    """Stands in for api-m.sandbox.paypal.com."""

    def __init__(self):
        self.orders: dict[str, dict] = {}
        self.captures = 0
        self.capture_amount: str | None = None

    def __call__(self, method: str, url: str, **kw) -> httpx.Response:
        req = httpx.Request(method, url)
        assert url.startswith("https://api-m.sandbox.paypal.com/")
        path = url.removeprefix("https://api-m.sandbox.paypal.com")
        if path == "/v1/oauth2/token":
            assert kw["auth"] == ("cid", "sec")
            return httpx.Response(200, json={"access_token": "tok"}, request=req)
        assert kw["headers"]["Authorization"] == "Bearer tok"
        if path == "/v2/checkout/orders" and method == "POST":
            oid = f"ORDER{len(self.orders) + 1}"
            self.orders[oid] = {"id": oid, "status": "APPROVED", "purchase_units": kw["json"]["purchase_units"], "request": kw["json"]}
            return httpx.Response(
                201,
                json={"id": oid, "status": "CREATED", "links": [{"rel": "approve", "href": f"https://paypal.test/approve/{oid}"}]},
                request=req,
            )
        oid = path.split("/")[4]
        order = self.orders.get(oid)
        if order is None:
            return httpx.Response(404, json={"name": "RESOURCE_NOT_FOUND"}, request=req)
        if path.endswith("/capture"):
            self.captures += 1
            unit = order["purchase_units"][0]
            amount = {**unit["amount"], "value": self.capture_amount or unit["amount"]["value"]}
            order["status"] = "COMPLETED"
            order["purchase_units"] = [{**unit, "payments": {"captures": [{"id": f"CAP-{oid}", "status": "COMPLETED", "amount": amount}]}}]
        return httpx.Response(200, json={k: v for k, v in order.items() if k != "request"}, request=req)


@pytest.fixture
def paypal(client, as_role, monkeypatch):
    fake = FakePayPal()
    monkeypatch.setattr("app.services.paypal._call", fake)
    _set(currency="usd")
    r = client.put(
        "/api/settings",
        headers=as_role("admin"),
        json={"paypal": {"active": "1", "mode": "sandbox", "sandbox_client_id": "cid", "sandbox_secret_key": "sec", "production_client_id": "", "production_secret_key": ""}},
    )
    assert r.status_code == 200, r.text
    return fake


def _invoice(client, as_role, student_id=1) -> int:
    inv = client.post(
        "/api/invoices", headers=as_role("admin"), json={"student_id": student_id, "title": "Fee", "amount": 1000, "amount_paid": 300}
    )
    return inv.json()["invoice_id"]


def test_paypal_settings_masked_and_stored_in_legacy_format(client, as_role, paypal):
    admin = as_role("admin")
    got = client.get("/api/settings", headers=admin).json()["paypal"]
    assert got == {
        "active": "1", "mode": "sandbox", "sandbox_client_id": "cid", "sandbox_secret_key": MASK,
        "production_client_id": "", "production_secret_key": "",
    }  # fmt: skip
    client.put("/api/settings", headers=admin, json={"paypal": {**got, "production_client_id": "live-id"}})
    with SessionLocal() as db:
        stored = json.loads(db.scalars(select(Setting).where(Setting.type == "paypal")).first().description)
    assert isinstance(stored, list) and stored[0]["sandbox_secret_key"] == "sec" and stored[0]["production_client_id"] == "live-id"
    assert client.get("/api/settings/public").json()["paypal_enabled"] is True
    assert client.put("/api/settings", headers=admin, json={"paypal": {"mode": "moon"}}).status_code == 422
    assert client.put("/api/settings", headers=admin, json={"paypal": {"bogus": "1"}}).status_code == 422
    client.put("/api/settings", headers=admin, json={"paypal": {"active": "0"}})
    assert client.get("/api/settings/public").json()["paypal_enabled"] is False


def test_paypal_order_and_capture(client, as_role, paypal):
    invoice_id = _invoice(client, as_role)
    student = as_role("student")
    url = f"/api/invoices/{invoice_id}/paypal-order"
    assert client.post(url).status_code == 401
    assert client.post(url, headers=as_role("admin")).status_code == 403
    assert client.post(url, headers=as_role("student2")).status_code == 403
    r = client.post(url, headers=student)
    assert r.status_code == 200 and r.json() == {"approve_url": "https://paypal.test/approve/ORDER1"}
    sent = paypal.orders["ORDER1"]["request"]
    unit = sent["purchase_units"][0]
    assert unit["amount"] == {"currency_code": "USD", "value": "700.00"}
    assert unit["custom_id"] == unit["reference_id"] == str(invoice_id)
    assert sent["application_context"]["return_url"].endswith("/app/my-invoices?paypal=return")
    assert sent["application_context"]["cancel_url"].endswith("/app/my-invoices?paypal=cancel")

    capture = {"order_id": "ORDER1"}
    assert client.post("/api/payments/paypal/capture", json=capture).status_code == 401
    assert client.post("/api/payments/paypal/capture", headers=as_role("student2"), json=capture).status_code == 403
    assert paypal.captures == 0  # nothing captured for a caller who may not pay this invoice
    r = client.post("/api/payments/paypal/capture", headers=student, json=capture)
    assert r.status_code == 200 and r.json() == {"status": "paid", "invoice_id": invoice_id}
    # capturing again does not record a second payment
    r = client.post("/api/payments/paypal/capture", headers=as_role("parent"), json=capture)
    assert r.json() == {"status": "paid", "invoice_id": invoice_id}
    assert paypal.captures == 1
    with SessionLocal() as db:
        inv = db.get(Invoice, invoice_id)
        assert inv.status == "paid" and inv.due == "0" and inv.payment_method == "paypal"
        pp = list(db.scalars(select(Payment).where(Payment.invoice_id == invoice_id, Payment.method == "paypal")))
        assert len(pp) == 1 and pp[0].amount == "700" and pp[0].description == "paypal:CAP-ORDER1"
    assert client.post(url, headers=student).status_code == 400  # already paid


def test_paypal_capture_rejects_wrong_amount(client, as_role, paypal):
    invoice_id = _invoice(client, as_role)
    parent = as_role("parent")
    assert client.post(f"/api/invoices/{invoice_id}/paypal-order", headers=parent).status_code == 200
    paypal.capture_amount = "1.00"
    r = client.post("/api/payments/paypal/capture", headers=parent, json={"order_id": "ORDER1"})
    assert r.status_code == 409
    with SessionLocal() as db:
        assert db.get(Invoice, invoice_id).status == "unpaid"
        assert db.scalars(select(Payment).where(Payment.method == "paypal")).first() is None


def test_paypal_pending_and_unknown_orders(client, as_role, paypal):
    invoice_id = _invoice(client, as_role)
    student = as_role("student")
    client.post(f"/api/invoices/{invoice_id}/paypal-order", headers=student)
    paypal.orders["ORDER1"]["status"] = "PAYER_ACTION_REQUIRED"  # buyer cancelled on paypal.com
    r = client.post("/api/payments/paypal/capture", headers=student, json={"order_id": "ORDER1"})
    assert r.json() == {"status": "pending", "invoice_id": invoice_id} and paypal.captures == 0
    assert client.post("/api/payments/paypal/capture", headers=student, json={"order_id": "NOPE"}).status_code == 502
    assert client.post("/api/payments/paypal/capture", headers=student, json={"order_id": "../x"}).status_code == 422


def test_paypal_disabled(client, as_role):
    invoice_id = _invoice(client, as_role)
    assert client.get("/api/settings/public").json()["paypal_enabled"] is False
    r = client.post(f"/api/invoices/{invoice_id}/paypal-order", headers=as_role("student"))
    assert r.status_code == 400
