"""AI assistant: report-card remark drafts, question drafts for online exams and student
progress summaries, written with the Claude API (app/services/ai.py).

Nothing here saves school data: remarks are saved through PUT /report-cards/.../remark and
questions through POST /online-exams/{id}/questions after a person has reviewed them.

Data sent to the API, per feature (never names, contact details, health or counselling data):
- report_remark: exam name, each subject's mark / full marks / grade, total %, GPA, result,
  position, attendance %, the previous exam's % (or the annual per-exam %), the teacher's notes.
- questions: subject name, class name, the teacher's topic text, count, types, difficulty.
- progress_summary: attendance % over the last 30 days, latest and previous exam %, failing
  subject count, the latest exam's subject grades, homework handed-in rate, approved leave days.
"""

import json
import os
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from app.api.routers.online_exams import QuestionIn, _staff_exam
from app.api.routers.report_cards import _cards, _exam_and_year
from app.core.deps import DB, Me, forbid, not_found, require_roles
from app.models import Exam, Mark, SchoolClass, Student, Subject
from app.services import ai
from app.services.access import children_ids, current_enroll
from app.services.analytics import RiskParams, at_risk
from app.services.results import exam_results, teaches_class
from app.services.settings import MASK, running_year, set_setting

router = APIRouter(prefix="/ai", tags=["ai assistant"])
admin_only = [Depends(require_roles("admin"))]
STAFF_WRITERS = ("admin", "teacher")

LABEL = "AI-generated, may contain mistakes"


# --- status and settings -----------------------------------------------------------------


@router.get("/status")
def ai_status(user: Me, db: DB):
    """Which AI features the signed-in user can use (the screens hide the rest)."""
    cfg = ai.config(db)
    features: list[str] = []
    if cfg.configured:
        if user.role in STAFF_WRITERS:
            features = ["report_remark", "questions", "progress_summary"]
        elif user.role == "parent":
            features = ["progress_summary"]
    return {"enabled": bool(features), "features": features, "label": LABEL}


def _settings_out(db: DB) -> dict:
    cfg = ai.config(db)
    return {
        "ai_enabled": cfg.enabled,
        "anthropic_api_key": MASK if cfg.api_key else "",
        "uses_environment_key": not cfg.api_key and bool(os.environ.get("ANTHROPIC_API_KEY")),
        "ai_model": cfg.model,
        "models": list(ai.MODELS),
        "ai_monthly_cap": cfg.monthly_cap,
        "ai_daily_user_cap": cfg.daily_cap,
        "configured": cfg.configured,
        "requests_this_month": ai.month_count(db),
    }


@router.get("/settings", dependencies=admin_only)
def get_ai_settings(db: DB):
    return _settings_out(db)


class AiSettingsIn(BaseModel):
    ai_enabled: bool | None = None
    anthropic_api_key: str | None = Field(default=None, max_length=300)
    ai_model: str | None = None
    ai_monthly_cap: int | None = Field(default=None, ge=0, le=1_000_000)
    ai_daily_user_cap: int | None = Field(default=None, ge=0, le=10_000)

    @field_validator("ai_model")
    @classmethod
    def known_model(cls, v: str | None) -> str | None:
        if v is not None and v not in ai.MODELS:
            raise ValueError(f"Model must be one of {', '.join(ai.MODELS)}")
        return v


@router.put("/settings", dependencies=admin_only)
def save_ai_settings(body: AiSettingsIn, db: DB):
    for key, value in body.model_dump(exclude_unset=True).items():
        if key == "anthropic_api_key" and value == MASK:
            continue  # unchanged secret
        if key == "ai_enabled":
            value = "1" if value else "0"
        set_setting(db, key, "" if value is None else str(value).strip())
    db.commit()
    return _settings_out(db)


@router.get("/usage", dependencies=admin_only)
def ai_usage(db: DB, months: int = 6):
    return {"rows": ai.usage_report(db, max(1, min(months, 24)))}


# --- report-card remarks -------------------------------------------------------------------


class RemarkDraftIn(BaseModel):
    student_id: int
    exam_id: int | None = None
    year: str | None = None
    tone: Literal["encouraging", "formal", "brief"] = "encouraging"
    notes: str | None = Field(default=None, max_length=500)


class RemarkOptions(BaseModel):
    options: list[str] = Field(min_length=1, max_length=5)

    @field_validator("options")
    @classmethod
    def clean(cls, v: list[str]) -> list[str]:
        out = [o.strip() for o in v if o and o.strip()]
        if not out or any(len(o) > 2000 for o in out):
            raise ValueError("unusable remarks")
        return out


REMARK_SCHEMA = {
    "type": "object",
    "properties": {"options": {"type": "array", "items": {"type": "string"}}},
    "required": ["options"],
    "additionalProperties": False,
}
TONES = {
    "encouraging": "warm and encouraging, still honest about what needs work",
    "formal": "formal and measured",
    "brief": "short and to the point (one or two sentences)",
}


def _previous_exam_pct(db: DB, exam: Exam, class_id: int, year: str, student_id: int) -> float | None:
    prev = db.scalars(select(Exam).where(Exam.year == year, Exam.exam_id < exam.exam_id).order_by(Exam.exam_id.desc())).first()
    if prev is None:
        return None
    r = exam_results(db, prev.exam_id, class_id, year).get(student_id)
    return r.percentage if r else None


def _remark_facts(db: DB, card: dict, exam: Exam | None, class_id: int, year: str, student_id: int) -> dict:
    """The report card without the student's name, code, photo or teacher comments."""
    attendance = card.get("attendance") or {}
    facts: dict = {
        "report": f"{exam.name} examination" if exam else f"annual report {year}",
        "result": card.get("result"),
        "percentage": card.get("percentage"),
        "gpa": card.get("gpa"),
        "position_in_class": card.get("position_class") or None,
        "class_size": card.get("class_size"),
        "attendance_percent": attendance.get("percent"),
    }
    if exam:
        facts["subjects"] = [
            {"subject": s.get("subject"), "mark": s.get("mark_obtained"), "full_marks": s.get("full_marks"), "grade": s.get("grade")}
            for s in card.get("subjects", [])
        ]
        facts["previous_exam_percentage"] = _previous_exam_pct(db, exam, class_id, year, student_id)
    else:
        facts["subjects"] = [{"subject": s.get("subject"), "weighted_percentage": s.get("weighted_percentage")} for s in card.get("subjects", [])]
        facts["exams"] = [{"exam": e.get("name"), "percentage": e.get("percentage"), "result": e.get("result")} for e in card.get("exams", [])]
    return facts


@router.post("/report-remark", dependencies=[Depends(require_roles(*STAFF_WRITERS))])
def draft_report_remark(body: RemarkDraftIn, user: Me, db: DB):
    """2-3 remark options for one student's report card. Same access as writing the remark."""
    exam, year = _exam_and_year(db, body.exam_id, body.year)
    enroll = current_enroll(db, body.student_id, year)
    if enroll is None or not enroll.class_id:
        raise not_found(f"Enrolment in {year}")
    if not teaches_class(db, user, enroll.class_id, enroll.section_id):
        raise forbid()
    student = db.get(Student, body.student_id)
    if student is None:
        raise not_found("Student")
    cards = _cards(db, enroll.class_id, year, exam, [(student, enroll)])
    if not cards:
        raise not_found("Report card")
    facts = _remark_facts(db, cards[0], exam, enroll.class_id, year, body.student_id)
    notes = (body.notes or "").strip()
    prompt = (
        f"<facts>\n{json.dumps(facts, ensure_ascii=False)}\n</facts>\n"
        + (f"<teacher_notes>\n{notes}\n</teacher_notes>\n" if notes else "")
        + f"Write 3 different report-card remarks for this student, each 2-4 sentences, in a {TONES[body.tone]} tone. "
        "Mention a strength and one concrete next step. Return them in `options`."
    )
    out = ai.generate(
        db, user, "report_remark",
        instructions="You draft the teacher's remark printed on a student's report card.",
        prompt=prompt, json_schema=REMARK_SCHEMA, output=RemarkOptions, effort="low", max_tokens=8000,
    )  # fmt: skip
    return {"options": out.options[:3], "label": LABEL}


# --- question drafts -----------------------------------------------------------------------


QuestionType = Literal["multiple_choice", "true_false", "fill_in_the_blanks"]


class QuestionDraftIn(BaseModel):
    online_exam_id: int
    topic: str = Field(min_length=3, max_length=2000)
    count: int = Field(default=5, ge=1, le=10)
    types: list[QuestionType] = Field(default_factory=lambda: ["multiple_choice"], min_length=1)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    mark: float = Field(default=1, gt=0, le=100)


class DraftQuestion(BaseModel):
    type: QuestionType
    question_title: str
    options: list[str]
    correct_answers: list[str]


class DraftQuestions(BaseModel):
    questions: list[DraftQuestion]


QUESTION_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["multiple_choice", "true_false", "fill_in_the_blanks"]},
                    "question_title": {"type": "string"},
                    "options": {"type": "array", "items": {"type": "string"}},
                    "correct_answers": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["type", "question_title", "options", "correct_answers"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["questions"],
    "additionalProperties": False,
}
QUESTION_FORMATS = (
    "Question formats (follow exactly):\n"
    '- multiple_choice: 4 options in `options`; `correct_answers` lists the 1-based numbers of the correct options as strings, e.g. ["2"].\n'
    '- true_false: `options` is empty; `correct_answers` is ["true"] or ["false"].\n'
    "- fill_in_the_blanks: write ___ (three underscores) in `question_title` where each blank goes; `options` is empty; "
    "`correct_answers` lists the missing words in order, one per blank."
)


def _valid_question(q: DraftQuestion, mark: float, allowed: set[str]) -> QuestionIn | None:
    """The draft as the create-question body, or None when it doesn't fit the format."""
    if q.type not in allowed:
        return None
    options = [o.strip() for o in q.options] if q.type == "multiple_choice" else []
    answers = [a.strip().lower() if q.type == "true_false" else a.strip() for a in q.correct_answers if a.strip()]
    if q.type == "fill_in_the_blanks" and q.question_title.count("___") != len(answers):
        return None
    try:
        return QuestionIn(type=q.type, question_title=q.question_title.strip(), mark=mark, options=options, correct_answers=answers)
    except ValueError:
        return None


@router.post("/questions", dependencies=[Depends(require_roles(*STAFF_WRITERS))])
def draft_questions(body: QuestionDraftIn, user: Me, db: DB):
    """Draft questions for an online exam. Teachers of the exam's subject, or admins."""
    exam = _staff_exam(db, user, body.online_exam_id)
    subject = db.get(Subject, exam.subject_id) if exam.subject_id else None
    klass = db.get(SchoolClass, exam.class_id) if exam.class_id else None
    allowed = set(body.types)
    facts = {
        "subject": subject.name if subject else None,
        "class": klass.name if klass else None,
        "difficulty": body.difficulty,
        "count": body.count,
        "types": sorted(allowed),
    }
    prompt = (
        f"<facts>\n{json.dumps(facts, ensure_ascii=False)}\n</facts>\n"
        f"<teacher_notes>\n{body.topic.strip()}\n</teacher_notes>\n"
        f"Write {body.count} exam questions on the topic in the teacher's notes, using only the listed types, "
        "suitable for the class level and difficulty. Each must have exactly one defensible answer "
        "(multiple choice may have more than one correct option only when the question says so)."
    )
    out = ai.generate(
        db, user, "questions",
        instructions="You write school exam questions for a teacher to review.\n" + QUESTION_FORMATS,
        prompt=prompt, json_schema=QUESTION_SCHEMA, output=DraftQuestions, effort="medium", max_tokens=16000,
    )  # fmt: skip
    questions = [q for q in (_valid_question(d, body.mark, allowed) for d in out.questions[: body.count]) if q is not None]
    if not questions:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The AI returned questions in the wrong format. Please try again.")
    return {"questions": [q.model_dump() for q in questions], "dropped": len(out.questions[: body.count]) - len(questions), "label": LABEL}


# --- progress summaries --------------------------------------------------------------------


class SummaryIn(BaseModel):
    student_id: int


class Summary(BaseModel):
    summary: str = Field(min_length=1, max_length=3000)
    suggestions: list[str] = Field(default_factory=list, max_length=5)


SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {"summary": {"type": "string"}, "suggestions": {"type": "array", "items": {"type": "string"}}},
    "required": ["summary", "suggestions"],
    "additionalProperties": False,
}
AUDIENCE = {
    "staff": (
        "You write a short progress summary of one student for a teacher or school administrator. "
        "Be factual and specific; point out what needs attention and what is going well."
    ),
    "parent": (
        "You write a short, gentle progress note about a child for their parent. Lead with something positive, "
        "explain anything that needs attention calmly, and suggest simple ways to help at home. Avoid school jargon."
    ),
}


def _latest_exam_subjects(db: DB, student_id: int, class_id: int, year: str) -> tuple[str | None, list[dict]]:
    exam_id = db.scalar(select(func.max(Mark.exam_id)).where(Mark.student_id == student_id, Mark.year == year, Mark.mark_obtained.is_not(None)))
    exam = db.get(Exam, exam_id) if exam_id else None
    if exam is None:
        return None, []
    r = exam_results(db, exam.exam_id, class_id, year).get(student_id)
    if r is None:
        return exam.name, []
    return exam.name, [{"subject": s.subject, "grade": s.grade} for s in r.subjects if s.mark_obtained is not None]


@router.post("/progress-summary", dependencies=[Depends(require_roles("admin", "teacher", "parent"))])
def progress_summary(body: SummaryIn, user: Me, db: DB):
    """Staff (admin, teachers of the student's class) get a staff summary; parents a gentler one for their own child."""
    year = running_year(db)
    enroll = current_enroll(db, body.student_id, year)
    if user.role == "parent":
        if body.student_id not in children_ids(db, user.id):
            raise forbid()
        audience = "parent"
    else:
        if enroll is not None and enroll.class_id and not teaches_class(db, user, enroll.class_id, enroll.section_id):
            raise forbid()
        if enroll is None and user.role != "admin":
            raise forbid()
        audience = "staff"
    if enroll is None or not enroll.class_id:
        raise not_found(f"Enrolment in {year}")
    risk = next(
        (r for r in at_risk(db, year, None, RiskParams(min_score=0), enroll.class_id, enroll.section_id) if r.student_id == body.student_id),
        None,
    )
    exam_name, subjects = _latest_exam_subjects(db, body.student_id, enroll.class_id, year)
    facts = {
        "attendance_percent_last_30_days": risk.attendance_pct if risk else None,
        "attendance_days_marked": risk.marked_days if risk else 0,
        "latest_exam": exam_name,
        "latest_exam_percentage": risk.latest_exam_pct if risk else None,
        "previous_exam_percentage": risk.previous_exam_pct if risk else None,
        "failing_subjects_in_latest_exam": risk.failing_subjects if risk else 0,
        "latest_exam_subject_grades": subjects,
        "homework_handed_in_percent": risk.homework_rate if risk else None,
        "homework_due_so_far": risk.homework_due if risk else 0,
        "approved_leave_days_this_year": risk.leave_days if risk else 0,
    }
    prompt = (
        f"<facts>\n{json.dumps(facts, ensure_ascii=False)}\n</facts>\n"
        "Write `summary` (one paragraph, at most 120 words) and 2-3 short, practical `suggestions`."
    )
    out = ai.generate(
        db, user, "progress_summary", instructions=AUDIENCE[audience],
        prompt=prompt, json_schema=SUMMARY_SCHEMA, output=Summary, effort="low", max_tokens=8000,
    )  # fmt: skip
    return {
        "summary": out.summary.strip(),
        "suggestions": [s.strip() for s in out.suggestions if s.strip()][:3],
        "audience": audience,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "label": LABEL,
    }
