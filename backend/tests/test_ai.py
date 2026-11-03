import json
from datetime import date, datetime, timezone
from types import SimpleNamespace

import anthropic
import httpx2
import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import (
    AiRequest,
    Mark,
    OnlineExam,
    QuestionBank,
    ReportRemark,
    SchoolClass,
    Setting,
    Student,
    StudentHealth,
    StudentRecord,
    Subject,
    Teacher,
)
from app.services import ai
from app.services.settings import MASK
from tests.conftest import PASSWORD, YEAR, login

# --- a stand-in for the Anthropic client ----------------------------------------------------


class FakeMessages:
    def __init__(self, owner: "FakeClient"):
        self.owner = owner

    def create(self, **kwargs):
        self.owner.calls.append(kwargs)
        reply = self.owner.reply
        if isinstance(reply, Exception):
            raise reply
        return reply(kwargs) if callable(reply) else reply


class FakeClient:
    def __init__(self):
        self.calls: list[dict] = []
        self.reply = None
        self.messages = FakeMessages(self)
        self.beta = SimpleNamespace(messages=FakeMessages(self))


def response(payload, stop_reason="end_turn"):
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return SimpleNamespace(
        stop_reason=stop_reason,
        content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=text)],
        usage=SimpleNamespace(input_tokens=120, output_tokens=80),
    )


@pytest.fixture
def fake(monkeypatch):
    client = FakeClient()
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)  # never reach the real API
    monkeypatch.setattr(ai, "make_client", lambda api_key: client)
    return client


@pytest.fixture
def enabled(client, as_role, fake):
    r = client.put("/api/ai/settings", headers=as_role("admin"), json={"ai_enabled": True, "anthropic_api_key": "sk-test-key"})
    assert r.status_code == 200, r.text
    return fake


@pytest.fixture
def report_data():
    """Marks for Kid One plus data that must never reach the API."""
    with SessionLocal() as db:
        db.add_all(
            [
                Mark(student_id=1, subject_id=1, class_id=1, section_id=1, exam_id=1, mark_obtained=85, year=YEAR),
                Mark(student_id=1, subject_id=2, class_id=1, section_id=1, exam_id=1, mark_obtained=90, year=YEAR),
            ]
        )
        db.get(Student, 1).phone = "+15550199"
        db.add(StudentHealth(student_id=1, conditions="asthma", allergies="peanuts"))
        db.add(
            StudentRecord(
                student_id=1, kind="counselling", date=date(2026, 1, 5), title="Counselling session",
                details="private counselling notes", confidential=True, recorded_by="admin-1",
                created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            )  # fmt: skip
        )
        db.commit()


@pytest.fixture
def other_teacher(client):
    """A teacher with a subject in another class only."""
    from app.core.security import hash_password

    with SessionLocal() as db:
        db.add(Teacher(name="Teacher Three", email="t3@example.com", password=hash_password(PASSWORD)))
        db.add(SchoolClass(name="Nine", name_numeric="9"))
        db.flush()
        db.add(Subject(name="History", class_id=2, teacher_id=3, year=YEAR))
        db.commit()
    return login(client, "t3@example.com")


def sent_text(call: dict) -> str:
    return call["system"] + "\n" + json.dumps(call["messages"])


def ai_rows() -> list[AiRequest]:
    with SessionLocal() as db:
        return list(db.scalars(select(AiRequest).order_by(AiRequest.ai_request_id)))


# --- settings and availability ----------------------------------------------------------------


def test_disabled_until_configured(client, as_role, fake):
    admin = as_role("admin")
    assert client.get("/api/ai/status", headers=as_role("teacher")).json()["enabled"] is False
    r = client.post("/api/ai/report-remark", headers=admin, json={"student_id": 1})
    assert r.status_code == 409 and "not turned on" in r.json()["detail"]
    # enabled without a key (and no ANTHROPIC_API_KEY in the environment) is still off
    client.put("/api/ai/settings", headers=admin, json={"ai_enabled": True})
    assert client.post("/api/ai/report-remark", headers=admin, json={"student_id": 1}).status_code == 409
    assert fake.calls == [] and ai_rows() == []


def test_settings_mask_the_key_and_validate(client, as_role, enabled, monkeypatch):
    admin = as_role("admin")
    body = client.get("/api/ai/settings", headers=admin).json()
    assert body["anthropic_api_key"] == MASK and body["configured"] and body["ai_model"] == "claude-opus-5-5"
    # sending the mask back keeps the stored key
    client.put("/api/ai/settings", headers=admin, json={"anthropic_api_key": MASK, "ai_daily_user_cap": 5})
    with SessionLocal() as db:
        key = db.scalars(select(Setting.description).where(Setting.type == "anthropic_api_key")).first()
    assert key == "sk-test-key"
    assert client.get("/api/settings", headers=admin).json().get("anthropic_api_key") == MASK
    assert client.put("/api/ai/settings", headers=admin, json={"ai_model": "gpt-4"}).status_code == 422
    assert client.get("/api/ai/settings", headers=as_role("teacher")).status_code == 403
    status = client.get("/api/ai/status", headers=as_role("parent")).json()
    assert status["features"] == ["progress_summary"] and "mistakes" in status["label"]
    assert client.get("/api/ai/status", headers=as_role("student")).json()["enabled"] is False


# --- report-card remarks ---------------------------------------------------------------------


def test_remark_draft_sends_minimal_data_and_saves_nothing(client, as_role, enabled, report_data):
    enabled.reply = response({"options": ["Strong term overall.", "Keep reading daily.", "Well done in Physics."]})
    r = client.post("/api/ai/report-remark", headers=as_role("teacher"), json={"student_id": 1, "exam_id": 1, "notes": "Helps classmates"})
    assert r.status_code == 200, r.text
    assert r.json()["options"] == ["Strong term overall.", "Keep reading daily.", "Well done in Physics."]

    (call,) = enabled.calls
    assert call["model"] == "claude-opus-5-5"
    assert call["betas"] == [ai.FALLBACK_BETA] and call["fallbacks"] == "default"
    assert call["output_config"]["format"]["type"] == "json_schema" and call["output_config"]["effort"] == "low"
    text = sent_text(call)
    assert "Math" in text and "85" in text and "Helps classmates" in text
    for secret in ("Kid One", "+15550199", "asthma", "peanuts", "counselling notes", "s1@example.com"):
        assert secret not in text

    with SessionLocal() as db:
        assert db.scalars(select(ReportRemark)).all() == []
    (row,) = ai_rows()
    assert (row.feature, row.status, row.user_role, row.input_tokens, row.output_tokens) == ("report_remark", "ok", "teacher", 120, 80)


def test_remark_permissions(client, as_role, enabled, report_data, other_teacher):
    enabled.reply = response({"options": ["x"]})
    assert client.post("/api/ai/report-remark", headers=other_teacher, json={"student_id": 1, "exam_id": 1}).status_code == 403
    assert client.post("/api/ai/report-remark", headers=as_role("parent"), json={"student_id": 1, "exam_id": 1}).status_code == 403
    assert client.post("/api/ai/report-remark", headers=as_role("student"), json={"student_id": 1}).status_code == 403
    assert enabled.calls == []


def test_caps(client, as_role, enabled, report_data):
    admin = as_role("admin")
    enabled.reply = response({"options": ["Good work."]})
    client.put("/api/ai/settings", headers=admin, json={"ai_daily_user_cap": 1})
    teacher = as_role("teacher")
    assert client.post("/api/ai/report-remark", headers=teacher, json={"student_id": 1, "exam_id": 1}).status_code == 200
    r = client.post("/api/ai/report-remark", headers=teacher, json={"student_id": 1, "exam_id": 1})
    assert r.status_code == 429 and "today" in r.json()["detail"]
    # another user still has their daily allowance, until the school's monthly cap is hit
    assert client.post("/api/ai/report-remark", headers=admin, json={"student_id": 1, "exam_id": 1}).status_code == 200
    client.put("/api/ai/settings", headers=admin, json={"ai_daily_user_cap": 50, "ai_monthly_cap": 2})
    r = client.post("/api/ai/report-remark", headers=teacher, json={"student_id": 1, "exam_id": 1})
    assert r.status_code == 429 and "month" in r.json()["detail"]
    assert len(enabled.calls) == 2


def test_api_failures_are_friendly_and_logged(client, as_role, enabled, report_data):
    teacher = as_role("teacher")
    body = {"student_id": 1, "exam_id": 1}
    enabled.reply = response("this is not json")
    r = client.post("/api/ai/report-remark", headers=teacher, json=body)
    assert r.status_code == 502 and "could not be used" in r.json()["detail"]

    enabled.reply = response({}, stop_reason="refusal")
    assert client.post("/api/ai/report-remark", headers=teacher, json=body).status_code == 422

    enabled.reply = anthropic.APITimeoutError(request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages"))
    r = client.post("/api/ai/report-remark", headers=teacher, json=body)
    assert r.status_code == 503 and "in time" in r.json()["detail"]

    assert [row.status for row in ai_rows()] == ["invalid", "refused", "error"]


def test_haiku_uses_the_plain_messages_endpoint(client, as_role, enabled, report_data):
    client.put("/api/ai/settings", headers=as_role("admin"), json={"ai_model": "claude-haiku-5-5"})
    enabled.reply = response({"options": ["Good work."]})
    assert client.post("/api/ai/report-remark", headers=as_role("teacher"), json={"student_id": 1, "exam_id": 1}).status_code == 200
    (call,) = enabled.calls
    assert call["model"] == "claude-haiku-5-5" and "fallbacks" not in call and "betas" not in call


# --- question drafts -------------------------------------------------------------------------


@pytest.fixture
def online_exam():
    with SessionLocal() as db:
        exam = OnlineExam(
            title="Quiz", class_id=1, section_id=1, subject_id=1, exam_date=int(datetime(2026, 3, 2, tzinfo=timezone.utc).timestamp()),
            time_start="09:00", time_end="10:00", minimum_percentage="50", status="pending", running_year=YEAR,
        )  # fmt: skip
        db.add(exam)
        db.commit()
        return exam.online_exam_id


def test_question_drafts_are_validated_and_not_saved(client, as_role, enabled, online_exam):
    enabled.reply = response(
        {
            "questions": [
                {"type": "multiple_choice", "question_title": "2 + 2 = ?", "options": ["3", "4", "5", "6"], "correct_answers": ["2"]},
                {"type": "fill_in_the_blanks", "question_title": "The ___ is hot and ___.", "options": [], "correct_answers": ["sun"]},
                {"type": "true_false", "question_title": "10 is even.", "options": [], "correct_answers": ["True"]},
            ]
        }
    )
    r = client.post(
        "/api/ai/questions", headers=as_role("teacher"),
        json={"online_exam_id": online_exam, "topic": "Addition and number facts", "count": 3, "types": ["multiple_choice", "fill_in_the_blanks", "true_false"], "mark": 2},
    )  # fmt: skip
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dropped"] == 1  # the fill-in question had two blanks but one answer
    assert body["questions"] == [
        {"type": "multiple_choice", "question_title": "2 + 2 = ?", "mark": 2.0, "options": ["3", "4", "5", "6"], "correct_answers": ["2"]},
        {"type": "true_false", "question_title": "10 is even.", "mark": 2.0, "options": [], "correct_answers": ["true"]},
    ]
    (call,) = enabled.calls
    assert call["output_config"]["effort"] == "medium" and "Math" in sent_text(call) and "Addition" in sent_text(call)
    with SessionLocal() as db:
        assert db.scalars(select(QuestionBank)).all() == []

    # the drafts go through the normal create-question endpoint unchanged
    created = client.post(f"/api/online-exams/{online_exam}/questions", headers=as_role("teacher"), json=body["questions"][0])
    assert created.status_code == 201


def test_question_drafts_permissions_and_bad_output(client, as_role, enabled, online_exam):
    body = {"online_exam_id": online_exam, "topic": "Fractions"}
    assert client.post("/api/ai/questions", headers=as_role("teacher2"), json=body).status_code == 403  # teaches Physics
    assert client.post("/api/ai/questions", headers=as_role("parent"), json=body).status_code == 403
    enabled.reply = response({"questions": [{"type": "multiple_choice", "question_title": "?", "options": ["a"], "correct_answers": ["9"]}]})
    r = client.post("/api/ai/questions", headers=as_role("admin"), json=body)
    assert r.status_code == 502 and "wrong format" in r.json()["detail"]
    enabled.reply = response({"items": []})
    assert client.post("/api/ai/questions", headers=as_role("admin"), json=body).status_code == 502


# --- progress summaries ----------------------------------------------------------------------


def test_progress_summary_for_staff_and_parents(client, as_role, enabled, report_data, other_teacher):
    enabled.reply = response({"summary": "Steady progress this term.", "suggestions": ["Read together nightly.", " "]})
    staff = client.post("/api/ai/progress-summary", headers=as_role("teacher"), json={"student_id": 1})
    assert staff.status_code == 200, staff.text
    assert staff.json()["audience"] == "staff" and staff.json()["suggestions"] == ["Read together nightly."]

    parent = client.post("/api/ai/progress-summary", headers=as_role("parent"), json={"student_id": 1})
    assert parent.status_code == 200 and parent.json()["audience"] == "parent"
    assert "parent" in enabled.calls[1]["system"]

    for call in enabled.calls:
        text = sent_text(call)
        for secret in ("Kid One", "+15550199", "asthma", "counselling notes", "Counselling session"):
            assert secret not in text

    assert client.post("/api/ai/progress-summary", headers=as_role("parent"), json={"student_id": 2}).status_code == 403
    assert client.post("/api/ai/progress-summary", headers=other_teacher, json={"student_id": 1}).status_code == 403
    assert client.post("/api/ai/progress-summary", headers=as_role("student"), json={"student_id": 1}).status_code == 403
    assert len(enabled.calls) == 2


def test_usage_report(client, as_role, enabled, report_data):
    enabled.reply = response({"options": ["Good work."]})
    client.post("/api/ai/report-remark", headers=as_role("teacher"), json={"student_id": 1, "exam_id": 1})
    enabled.reply = response("{")
    client.post("/api/ai/report-remark", headers=as_role("teacher"), json={"student_id": 1, "exam_id": 1})
    rows = client.get("/api/ai/usage", headers=as_role("admin")).json()["rows"]
    assert rows == [
        {"month": datetime.now(timezone.utc).strftime("%Y-%m"), "feature": "report_remark", "requests": 2, "failed": 1, "input_tokens": 240, "output_tokens": 160}
    ]
    assert client.get("/api/ai/usage", headers=as_role("teacher")).status_code == 403
