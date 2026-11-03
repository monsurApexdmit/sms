"""Request and response models for app/api/v1/endpoints/online_exams.py."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.models import OnlineExam
from app.schemas.common import out_schema

ExamBase = out_schema(OnlineExam)


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
