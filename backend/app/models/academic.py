"""Classes, sections, subjects, enrolments, routine, syllabus and study material."""

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Int, Txt, num, pk, txt


class SchoolClass(Base):
    __tablename__ = "class"
    class_id: Mapped[int] = pk()
    name: Mapped[str | None] = mapped_column(String(11), nullable=True, default="")
    name_numeric: Mapped[str | None] = mapped_column(String(3), nullable=True, default="")
    teacher_id: Int = num()


class Section(Base):
    __tablename__ = "section"
    section_id: Mapped[int] = pk()
    name: Txt = txt()
    nick_name: Txt = txt()
    class_id: Int = num()
    teacher_id: Int = num()


class Subject(Base):
    __tablename__ = "subject"
    subject_id: Mapped[int] = pk()
    name: Txt = txt()
    class_id: Int = num()
    teacher_id: Int = num()
    year: Txt = txt()


class Enroll(Base):
    __tablename__ = "enroll"
    enroll_id: Mapped[int] = pk()
    enroll_code: Txt = txt()
    student_id: Int = num()
    class_id: Int = num()
    section_id: Int = num()
    roll: Int = num()
    date_added: Txt = txt()
    year: Txt = txt()


class ClassRoutine(Base):
    __tablename__ = "class_routine"
    class_routine_id: Mapped[int] = pk()
    class_id: Int = num()
    section_id: Int = num()
    subject_id: Int = num()
    time_start: Int = num()
    time_end: Int = num()
    time_start_min: Int = num()
    time_end_min: Int = num()
    day: Txt = txt()
    year: Txt = txt()


class AcademicSyllabus(Base):
    __tablename__ = "academic_syllabus"
    academic_syllabus_id: Mapped[int] = pk()
    academic_syllabus_code: Txt = txt()
    title: Txt = txt()
    description: Txt = txt()
    class_id: Int = num()
    uploader_type: Txt = txt()
    uploader_id: Int = num()
    year: Txt = txt()
    timestamp: Txt = txt()
    file_name: Txt = txt()
    subject_id: Int = num()


class Document(Base):
    """Study material."""

    __tablename__ = "document"
    document_id: Mapped[int] = pk()
    title: Txt = txt()
    description: Txt = txt()
    file_name: Txt = txt()
    file_type: Txt = txt()
    class_id: Txt = txt()
    teacher_id: Int = num()
    timestamp: Txt = txt()
    subject_id: Int = num()
