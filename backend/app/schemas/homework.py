"""Request and response models for app/api/v1/endpoints/homework.py."""

from datetime import date, datetime

from pydantic import BaseModel, Field

from app.schemas.common import Page


class SubmissionOut(BaseModel):
    submission_id: int
    student_id: int
    text: str | None
    file_url: str | None
    submitted_at: datetime
    is_late: bool
    marks: float | None
    feedback: str | None
    graded_at: datetime | None


class HomeworkOut(BaseModel):
    homework_id: int
    class_id: int
    class_name: str | None
    section_id: int | None
    section_name: str | None
    subject_id: int
    subject_name: str | None
    teacher_id: int | None
    teacher_name: str | None
    title: str
    description: str | None
    file_url: str | None
    assigned_on: date
    due_date: date
    max_marks: float | None
    allow_late: bool
    year: str
    # staff view
    students: int | None = None
    submitted: int | None = None
    graded: int | None = None
    # student / parent view
    submission: SubmissionOut | None = None


class HomeworkPage(Page):
    items: list[HomeworkOut]


class RosterRow(BaseModel):
    student_id: int
    name: str | None
    roll: int | None
    submission: SubmissionOut | None


class GradeIn(BaseModel):
    marks: float | None = Field(default=None, ge=0)
    feedback: str | None = Field(default=None, max_length=5000)
