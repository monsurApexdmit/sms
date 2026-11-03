"""Request and response models for app/api/v1/endpoints/exams.py."""

from typing import Literal

from pydantic import BaseModel, Field


class ExamIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    date: str | None = None
    comment: str | None = None
    year: str | None = None


class GradeIn(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    grade_point: str
    mark_from: int = Field(ge=0)
    mark_upto: int = Field(ge=0)
    comment: str | None = None


class QuestionPaperIn(BaseModel):
    title: str = Field(min_length=1)
    question_paper: str | None = None
    class_id: int | None = None
    exam_id: int | None = None
    teacher_id: int | None = None


class MarkRow(BaseModel):
    mark_id: int
    student_id: int
    student_name: str | None
    roll: int | None
    mark_obtained: int | None
    comment: str | None


class MarkUpdate(BaseModel):
    mark_id: int
    mark_obtained: int | None = Field(default=None, ge=0, le=1000)
    comment: str | None = Field(default=None, max_length=500)


class MarksSave(BaseModel):
    exam_id: int
    class_id: int
    section_id: int
    subject_id: int
    items: list[MarkUpdate]


class ImportResult(BaseModel):
    updated: int


class MarksSmsIn(BaseModel):
    class_id: int
    section_id: int | None = None
    receiver: Literal["student", "parent"]
