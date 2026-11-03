import json
import secrets
import time
from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.crud import get_or_404, out_schema
from app.core.config import get_settings
from app.api.deps import DB, CurrentUser, Me, forbid, require_roles
from app.models import OnlineExam, OnlineExamResult, QuestionBank, SchoolClass, Student, Subject
from app.services.access import children_ids, current_enroll, ensure_teaches_subject
from app.services.settings import running_year

router = APIRouter(prefix="/online-exams", tags=["online exams"])
STAFF = ("admin", "teacher")
GRACE_SECONDS = 60

ExamBase = out_schema(OnlineExam)
QuestionBase = out_schema(QuestionBank)
ResultBase = out_schema(OnlineExamResult)


class ExamIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    class_id: int
    section_id: int
    subject_id: int
    exam_date: date
    time_start: str = Field(pattern=r"^\d{2}:\d{2}$")
    time_end: str = Field(pattern=r"^\d{2}:\d{2}$")
    minimum_percentage: float = Field(ge=0, le=100)
    instruction: str | None = None

    @model_validator(mode="after")
    def check_times(self):
        if self.time_end <= self.time_start:
            raise ValueError("End time must be after start time")
        return self


class StatusIn(BaseModel):
    status: Literal["pending", "published", "expired"]


class QuestionIn(BaseModel):
    type: Literal["multiple_choice", "true_false", "fill_in_the_blanks"]
    question_title: str = Field(min_length=1)
    mark: float = Field(gt=0)
    options: list[str] = Field(default_factory=list)
    # multiple_choice: option numbers ("1".."n"); true_false: ["true"|"false"]; fill_in: words in order
    correct_answers: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def check(self):
        if self.type == "multiple_choice":
            if len(self.options) < 2 or any(not o.strip() for o in self.options):
                raise ValueError("Multiple choice questions need at least two non-empty options")
            valid = {str(i) for i in range(1, len(self.options) + 1)}
            if not set(self.correct_answers) <= valid:
                raise ValueError("Correct answers must be option numbers")
        if self.type == "true_false" and self.correct_answers[0] not in ("true", "false"):
            raise ValueError("Answer must be true or false")
        return self


class ExamOut(ExamBase):  # type: ignore[misc,valid-type]
    question_count: int = 0
    total_mark: float = 0
    subject_name: str | None = None
    my_status: str | None = None


class AnswerIn(BaseModel):
    question_bank_id: int
    answer: list[str] = Field(default_factory=list)


class SubmitIn(BaseModel):
    answers: list[AnswerIn]


# --- helpers ------------------------------------------------------------------


def _parse_clock(value: str | None) -> tuple[int, int]:
    for fmt in ("%H:%M", "%I:%M %p", "%H:%M:%S"):
        try:
            t = datetime.strptime((value or "").strip(), fmt)
            return t.hour, t.minute
        except ValueError:
            continue
    return 0, 0


def exam_window(exam: OnlineExam) -> tuple[int, int]:
    """Unix start/end of the exam. Legacy stores exam_date as a unix day and times as text."""
    tz = ZoneInfo(get_settings().school_timezone)
    day = datetime.fromtimestamp(exam.exam_date or 0, tz).date()
    (sh, sm), (eh, em) = _parse_clock(exam.time_start), _parse_clock(exam.time_end)
    start = datetime(day.year, day.month, day.day, sh, sm, tzinfo=tz)
    end = datetime(day.year, day.month, day.day, eh, em, tzinfo=tz)
    return int(start.timestamp()), int(end.timestamp())


def _exam_date_ts(d: date) -> int:
    tz = ZoneInfo(get_settings().school_timezone)
    return int(datetime(d.year, d.month, d.day, tzinfo=tz).timestamp())


def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def correct_list(q: QuestionBank) -> list[str]:
    if q.type == "true_false":
        return [(q.correct_answers or "").strip().lower()]
    try:
        value = json.loads(q.correct_answers or "[]")
    except ValueError:
        return []
    return [str(v) for v in value] if isinstance(value, list) else [str(value)]


def is_correct(q: QuestionBank, answer: list[str]) -> bool:
    expected = correct_list(q)
    if q.type == "multiple_choice":
        return {a for a in answer if a} == {e for e in expected if e}
    if q.type == "true_false":
        return bool(answer) and answer[0].strip().lower() == expected[0]
    if q.type == "fill_in_the_blanks":
        return [a.strip().lower() for a in answer] == [e.strip().lower() for e in expected]
    return False


def grade(questions: list[QuestionBank], answers: dict[int, list[str]], minimum_percentage: float) -> tuple[float, str]:
    total = sum(_num(q.mark) for q in questions)
    obtained = sum(_num(q.mark) for q in questions if is_correct(q, answers.get(q.question_bank_id, [])))
    result = "pass" if obtained >= total * minimum_percentage / 100 else "fail"
    return obtained, result


def _questions(db: Session, exam_id: int) -> list[QuestionBank]:
    return list(db.scalars(select(QuestionBank).where(QuestionBank.online_exam_id == exam_id).order_by(QuestionBank.question_bank_id)))


def _exam_out(db: Session, exam: OnlineExam, my_status: str | None = None) -> ExamOut:
    qs = _questions(db, exam.online_exam_id)
    subject = db.get(Subject, exam.subject_id) if exam.subject_id else None
    return ExamOut(
        **ExamBase.model_validate(exam).model_dump(),
        question_count=len(qs),
        total_mark=sum(_num(q.mark) for q in qs),
        subject_name=subject.name if subject else None,
        my_status=my_status,
    )


def _staff_exam(db: Session, user: CurrentUser, exam_id: int) -> OnlineExam:
    exam = get_or_404(db, OnlineExam, exam_id, "Online exam")
    if exam.subject_id:
        ensure_teaches_subject(db, user, exam.subject_id)
    return exam


def _apply(exam: OnlineExam, body: ExamIn) -> None:
    exam.title = body.title
    exam.class_id, exam.section_id, exam.subject_id = body.class_id, body.section_id, body.subject_id
    exam.exam_date = _exam_date_ts(body.exam_date)
    exam.time_start, exam.time_end = body.time_start, body.time_end
    start, end = exam_window(exam)
    exam.duration = str(end - start)
    exam.minimum_percentage = f"{body.minimum_percentage:g}"
    exam.instruction = body.instruction


# --- staff --------------------------------------------------------------------


@router.get("", response_model=list[ExamOut])
def list_exams(
    db: DB,
    user: CurrentUser = Depends(require_roles(*STAFF)),
    status_: str | None = Query(None, alias="status"),
    class_id: int | None = None,
):
    stmt = select(OnlineExam).where(OnlineExam.running_year == running_year(db))
    if status_:
        stmt = stmt.where(OnlineExam.status == status_)
    if class_id:
        stmt = stmt.where(OnlineExam.class_id == class_id)
    if user.role == "teacher":
        stmt = stmt.where(OnlineExam.subject_id.in_(select(Subject.subject_id).where(Subject.teacher_id == user.id)))
    return [_exam_out(db, e) for e in db.scalars(stmt.order_by(OnlineExam.exam_date.desc()))]


@router.post("", response_model=ExamOut, status_code=201)
def create_exam(body: ExamIn, db: DB, user: CurrentUser = Depends(require_roles(*STAFF))):
    ensure_teaches_subject(db, user, body.subject_id)
    exam = OnlineExam(code=secrets.token_hex(4)[:7], status="pending", running_year=running_year(db))
    _apply(exam, body)
    db.add(exam)
    db.commit()
    return _exam_out(db, exam)


@router.get("/results/mine")
def my_results(user: Me, db: DB, student_id: int | None = None):
    if user.role == "student":
        sid = user.id
    elif user.role == "parent" and student_id in children_ids(db, user.id):
        sid = student_id
    else:
        raise forbid()
    out = []
    for r in db.scalars(select(OnlineExamResult).where(OnlineExamResult.student_id == sid, OnlineExamResult.status == "submitted")):
        exam = db.get(OnlineExam, r.online_exam_id)
        if exam is None:
            continue
        exam_info = _exam_out(db, exam)
        out.append({"exam": exam_info, "obtained_mark": _num(r.obtained_mark), "result": r.result})
    return out


@router.get("/available", response_model=list[ExamOut])
def available(db: DB, user: CurrentUser = Depends(require_roles("student"))):
    enroll = current_enroll(db, user.id)
    if enroll is None:
        return []
    exams = db.scalars(
        select(OnlineExam)
        .where(
            OnlineExam.running_year == running_year(db),
            OnlineExam.class_id == enroll.class_id,
            OnlineExam.section_id == enroll.section_id,
            OnlineExam.status == "published",
        )
        .order_by(OnlineExam.exam_date.desc())
    )
    statuses = dict(
        db.execute(
            select(OnlineExamResult.online_exam_id, OnlineExamResult.status).where(OnlineExamResult.student_id == user.id)
        ).all()
    )
    return [_exam_out(db, e, statuses.get(e.online_exam_id)) for e in exams]


@router.get("/{exam_id}")
def get_exam(exam_id: int, db: DB, user: CurrentUser = Depends(require_roles(*STAFF))):
    exam = _staff_exam(db, user, exam_id)
    return {
        "exam": _exam_out(db, exam),
        "questions": [QuestionBase.model_validate(q) for q in _questions(db, exam_id)],
    }


@router.put("/{exam_id}", response_model=ExamOut)
def update_exam(exam_id: int, body: ExamIn, db: DB, user: CurrentUser = Depends(require_roles(*STAFF))):
    exam = _staff_exam(db, user, exam_id)
    ensure_teaches_subject(db, user, body.subject_id)
    _apply(exam, body)
    db.commit()
    return _exam_out(db, exam)


@router.put("/{exam_id}/status", response_model=ExamOut)
def set_status(exam_id: int, body: StatusIn, db: DB, user: CurrentUser = Depends(require_roles(*STAFF))):
    exam = _staff_exam(db, user, exam_id)
    if body.status == "published" and not _questions(db, exam_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Add at least one question before publishing")
    exam.status = body.status
    db.commit()
    return _exam_out(db, exam)


@router.delete("/{exam_id}", status_code=204)
def delete_exam(exam_id: int, db: DB, user: CurrentUser = Depends(require_roles(*STAFF))):
    exam = _staff_exam(db, user, exam_id)
    db.execute(delete(QuestionBank).where(QuestionBank.online_exam_id == exam_id))
    db.execute(delete(OnlineExamResult).where(OnlineExamResult.online_exam_id == exam_id))
    db.delete(exam)
    db.commit()


def _store_question(q: QuestionBank, body: QuestionIn) -> None:
    q.type = body.type
    q.question_title = body.question_title
    q.mark = f"{body.mark:g}"
    if body.type == "multiple_choice":
        q.options = json.dumps(body.options)
        q.number_of_options = len(body.options)
        q.correct_answers = json.dumps(body.correct_answers)
    elif body.type == "true_false":
        q.options, q.number_of_options = None, None
        q.correct_answers = body.correct_answers[0]
    else:
        q.options, q.number_of_options = None, None
        q.correct_answers = json.dumps([w.strip().lower() for w in body.correct_answers])


@router.post("/{exam_id}/questions", status_code=201)
def add_question(exam_id: int, body: QuestionIn, db: DB, user: CurrentUser = Depends(require_roles(*STAFF))):
    _staff_exam(db, user, exam_id)
    q = QuestionBank(online_exam_id=exam_id)
    _store_question(q, body)
    db.add(q)
    db.commit()
    return QuestionBase.model_validate(q)


@router.put("/questions/{question_id}")
def update_question(question_id: int, body: QuestionIn, db: DB, user: CurrentUser = Depends(require_roles(*STAFF))):
    q = get_or_404(db, QuestionBank, question_id, "Question")
    _staff_exam(db, user, q.online_exam_id)
    _store_question(q, body)
    db.commit()
    return QuestionBase.model_validate(q)


@router.delete("/questions/{question_id}", status_code=204)
def delete_question(question_id: int, db: DB, user: CurrentUser = Depends(require_roles(*STAFF))):
    q = get_or_404(db, QuestionBank, question_id, "Question")
    _staff_exam(db, user, q.online_exam_id)
    db.delete(q)
    db.commit()


@router.get("/{exam_id}/results")
def exam_results(exam_id: int, db: DB, user: CurrentUser = Depends(require_roles(*STAFF))):
    _staff_exam(db, user, exam_id)
    names = dict(db.execute(select(Student.student_id, Student.name)).all())
    return [
        {**ResultBase.model_validate(r).model_dump(exclude={"answer_script"}), "student_name": names.get(r.student_id)}
        for r in db.scalars(select(OnlineExamResult).where(OnlineExamResult.online_exam_id == exam_id))
    ]


# --- taking an exam -----------------------------------------------------------


def _student_exam(db: Session, user: CurrentUser, exam_id: int) -> OnlineExam:
    exam = get_or_404(db, OnlineExam, exam_id, "Online exam")
    enroll = current_enroll(db, user.id)
    if (
        exam.status != "published"
        or enroll is None
        or (exam.class_id, exam.section_id) != (enroll.class_id, enroll.section_id)
    ):
        raise forbid()
    return exam


@router.post("/{exam_id}/start")
def start_exam(exam_id: int, db: DB, user: CurrentUser = Depends(require_roles("student"))):
    exam = _student_exam(db, user, exam_id)
    start, end = exam_window(exam)
    now = int(time.time())
    if now < start:
        raise HTTPException(status.HTTP_409_CONFLICT, "The exam has not started yet")
    if now > end:
        raise HTTPException(status.HTTP_409_CONFLICT, "The exam has ended")
    result = db.scalars(
        select(OnlineExamResult).where(OnlineExamResult.online_exam_id == exam_id, OnlineExamResult.student_id == user.id)
    ).first()
    if result is not None and result.status == "submitted":
        raise HTTPException(status.HTTP_409_CONFLICT, "You have already submitted this exam")
    if result is None:
        result = OnlineExamResult(
            online_exam_id=exam_id, student_id=user.id, status="attended", exam_started_timestamp=str(now)
        )
        db.add(result)
        db.commit()
    questions = [
        {
            "question_bank_id": q.question_bank_id,
            "type": q.type,
            "question_title": q.question_title,
            "mark": _num(q.mark),
            "options": json.loads(q.options) if q.type == "multiple_choice" and q.options else [],
            # number of blanks, never the words themselves
            "blanks": len(correct_list(q)) if q.type == "fill_in_the_blanks" else 0,
        }
        for q in _questions(db, exam_id)
    ]
    return {"exam": _exam_out(db, exam, result.status), "ends_at": end, "server_time": now, "questions": questions}


@router.post("/{exam_id}/submit")
def submit_exam(exam_id: int, body: SubmitIn, db: DB, user: CurrentUser = Depends(require_roles("student"))):
    exam = _student_exam(db, user, exam_id)
    _, end = exam_window(exam)
    if time.time() > end + GRACE_SECONDS:
        raise HTTPException(status.HTTP_409_CONFLICT, "Time is over; the exam can no longer be submitted")
    result = db.scalars(
        select(OnlineExamResult).where(OnlineExamResult.online_exam_id == exam_id, OnlineExamResult.student_id == user.id)
    ).first()
    if result is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Start the exam first")
    if result.status == "submitted":
        raise HTTPException(status.HTTP_409_CONFLICT, "You have already submitted this exam")
    questions = _questions(db, exam_id)
    answers = {a.question_bank_id: a.answer for a in body.answers}
    obtained, verdict = grade(questions, answers, _num(exam.minimum_percentage))
    # Same answer_script shape the legacy result pages read.
    result.answer_script = json.dumps(
        [
            {
                "question_bank_id": str(q.question_bank_id),
                "submitted_answer": json.dumps(answers.get(q.question_bank_id, [])),
                "correct_answers": q.correct_answers,
            }
            for q in questions
        ]
    )
    result.status = "submitted"
    result.obtained_mark = f"{obtained:g}"
    result.result = verdict
    db.commit()
    return {"obtained_mark": obtained, "total_mark": sum(_num(q.mark) for q in questions), "result": verdict}


# --- answer script (after the exam closes) ------------------------------------


def _submitted_answers(raw: str | None) -> dict[int, list[str]]:
    """Parse the legacy answer_script JSON: [{question_bank_id, submitted_answer (JSON list), ...}]."""
    try:
        items = json.loads(raw or "[]")
    except ValueError:
        return {}
    out: dict[int, list[str]] = {}
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict) or not str(item.get("question_bank_id", "")).isdigit():
            continue
        value = item.get("submitted_answer")
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except ValueError:
                pass
        if isinstance(value, list):
            answers = [str(v) for v in value]
        elif value in (None, ""):
            answers = []
        else:
            answers = [str(value)]
        out[int(item["question_bank_id"])] = answers
    return out


@router.get("/{exam_id}/answer-script")
def answer_script(
    exam_id: int,
    db: DB,
    student_id: int | None = None,
    user: CurrentUser = Depends(require_roles(*STAFF, "student", "parent")),
):
    if user.role == "student":
        exam = get_or_404(db, OnlineExam, exam_id, "Online exam")
        sid = user.id
    elif user.role == "parent":
        exam = get_or_404(db, OnlineExam, exam_id, "Online exam")
        if student_id is None or student_id not in children_ids(db, user.id):
            raise forbid()
        sid = student_id
    else:
        exam = _staff_exam(db, user, exam_id)
        if student_id is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "student_id is required")
        sid = student_id
    result = db.scalars(
        select(OnlineExamResult).where(OnlineExamResult.online_exam_id == exam_id, OnlineExamResult.student_id == sid)
    ).first()
    _, end = exam_window(exam)
    closed = exam.status == "expired" or time.time() > end + GRACE_SECONDS
    if result is None or result.status != "submitted" or not closed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Answer script is available after the exam closes")

    submitted = _submitted_answers(result.answer_script)
    questions = _questions(db, exam_id)
    student = db.get(Student, sid)
    cls = db.get(SchoolClass, exam.class_id) if exam.class_id else None
    subject = db.get(Subject, exam.subject_id) if exam.subject_id else None
    items = []
    for q in questions:
        options: list[str] = []
        if q.type == "multiple_choice" and q.options:
            try:
                parsed = json.loads(q.options)
                options = [str(o) for o in parsed] if isinstance(parsed, list) else []
            except ValueError:
                options = []
        answers = submitted.get(q.question_bank_id, [])
        items.append(
            {
                "question_bank_id": q.question_bank_id,
                "type": q.type,
                "question_title": q.question_title,
                "mark": _num(q.mark),
                "options": options,
                "correct_answers": correct_list(q),
                "submitted_answers": answers,
                "is_correct": is_correct(q, answers),
            }
        )
    return {
        "exam": {
            "online_exam_id": exam.online_exam_id,
            "title": exam.title,
            "class_name": cls.name if cls else None,
            "subject_name": subject.name if subject else None,
            "total_marks": sum(_num(q.mark) for q in questions),
            "minimum_percentage": _num(exam.minimum_percentage),
        },
        "student": {"student_id": sid, "name": student.name if student else None},
        "obtained_mark": _num(result.obtained_mark),
        "result": result.result,
        "questions": items,
    }
