"""Request and response models for app/api/v1/endpoints/ai.py."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.services import ai


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


class SummaryIn(BaseModel):
    student_id: int


class Summary(BaseModel):
    summary: str = Field(min_length=1, max_length=3000)
    suggestions: list[str] = Field(default_factory=list, max_length=5)
