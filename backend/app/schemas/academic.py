"""Request and response models for app/api/v1/endpoints/academic.py."""

from pydantic import BaseModel, Field

from app.models import AcademicSyllabus, Document
from app.schemas.common import out_schema


class ClassIn(BaseModel):
    name: str = Field(min_length=1, max_length=11)
    name_numeric: str | None = Field(default=None, max_length=3)
    teacher_id: int | None = None


class SectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    nick_name: str | None = None
    class_id: int
    teacher_id: int | None = None


class SubjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    class_id: int
    teacher_id: int | None = None
    year: str | None = None


class RoutineIn(BaseModel):
    class_id: int
    section_id: int
    subject_id: int
    day: str = Field(pattern=r"^(saturday|sunday|monday|tuesday|wednesday|thursday|friday)$")
    time_start: int = Field(ge=0, le=23)
    time_start_min: int = Field(ge=0, le=59)
    time_end: int = Field(ge=0, le=23)
    time_end_min: int = Field(ge=0, le=59)
    year: str | None = None


SyllabusBase = out_schema(AcademicSyllabus)


class SyllabusOut(SyllabusBase):  # type: ignore[misc,valid-type]
    download_url: str | None = None


DocumentBase = out_schema(Document)


class DocumentOut(DocumentBase):  # type: ignore[misc,valid-type]
    download_url: str | None = None
