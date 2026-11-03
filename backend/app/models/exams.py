"""Exams, grades, marks, question papers and online exams."""

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Int, Txt, num, pk, txt


class Exam(Base):
    __tablename__ = "exam"
    exam_id: Mapped[int] = pk()
    name: Txt = txt()
    date: Txt = txt()
    year: Txt = txt()
    comment: Txt = txt()


class Grade(Base):
    __tablename__ = "grade"
    grade_id: Mapped[int] = pk()
    name: Txt = txt()
    grade_point: Txt = txt()
    mark_from: Int = num()
    mark_upto: Int = num()
    comment: Txt = txt()


class Mark(Base):
    __tablename__ = "mark"
    mark_id: Mapped[int] = pk()
    student_id: Int = num()
    subject_id: Int = num()
    class_id: Int = num()
    section_id: Int = num()
    exam_id: Int = num()
    mark_obtained: Int = num()
    mark_total: Int = num()
    comment: Txt = txt()
    year: Txt = txt()


class QuestionPaper(Base):
    __tablename__ = "question_paper"
    question_paper_id: Mapped[int] = pk()
    title: Txt = txt()
    question_paper: Txt = txt()
    class_id: Int = num()
    exam_id: Int = num()
    teacher_id: Int = num()


class OnlineExam(Base):
    __tablename__ = "online_exam"
    online_exam_id: Mapped[int] = pk()
    code: Mapped[str | None] = mapped_column(String(255), nullable=True, default="")
    title: Txt = txt()
    class_id: Int = num()
    section_id: Int = num()
    subject_id: Int = num()
    exam_date: Int = num()
    time_start: Mapped[str | None] = mapped_column(String(255), nullable=True)
    time_end: Mapped[str | None] = mapped_column(String(255), nullable=True)
    duration: Txt = txt()
    minimum_percentage: Txt = txt()
    instruction: Txt = txt()
    status: Mapped[str | None] = mapped_column(String(255), nullable=True, default="pending")
    running_year: Mapped[str | None] = mapped_column(String(255), nullable=True, default="")


class QuestionBank(Base):
    __tablename__ = "question_bank"
    question_bank_id: Mapped[int] = pk()
    online_exam_id: Int = num()
    question_title: Txt = txt()
    type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    number_of_options: Int = num()
    options: Txt = txt()
    correct_answers: Txt = txt()
    mark: Mapped[str | None] = mapped_column(String(255), nullable=True)


class OnlineExamResult(Base):
    __tablename__ = "online_exam_result"
    online_exam_result_id: Mapped[int] = pk()
    online_exam_id: Int = num()
    student_id: Int = num()
    answer_script: Txt = txt()
    obtained_mark: Txt = txt()
    status: Txt = txt()
    exam_started_timestamp: Txt = txt()
    result: Txt = txt()
