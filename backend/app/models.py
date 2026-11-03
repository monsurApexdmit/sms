"""ORM mapping of the existing `sms` database (sqldatabase/sms.sql).

The schema is used as-is so the legacy CodeIgniter app and this API can share one
database during migration. Column names (including typos such as `reciever`) and
types (unix timestamps stored as text, `year` as "2020-2021") are kept verbatim.
Tables added by this system are at the end of the file and are created by the
Alembic migrations in `migrations/`; the legacy app ignores them.
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, LargeBinary, Numeric, String, Text, UniqueConstraint


from datetime import date, datetime, time

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, LargeBinary, String, Text, Time


from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, LargeBinary, Numeric, String, Text, UniqueConstraint


from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

Txt = Mapped[str | None]
Int = Mapped[int | None]


def pk() -> Mapped[int]:
    return mapped_column(Integer, primary_key=True, autoincrement=True)


def txt() -> Txt:
    return mapped_column(Text, nullable=True)


def num() -> Int:
    return mapped_column(Integer, nullable=True)


# --- accounts -----------------------------------------------------------------


class Admin(Base):
    __tablename__ = "admin"
    admin_id: Mapped[int] = pk()
    name: Txt = txt()
    email: Txt = txt()
    password: Txt = txt()
    level: Txt = txt()
    authentication_key: Txt = txt()
    phone: Txt = txt()
    address: Txt = txt()


class Teacher(Base):
    __tablename__ = "teacher"
    teacher_id: Mapped[int] = pk()
    name: Txt = txt()
    birthday: Txt = txt()
    sex: Txt = txt()
    religion: Txt = txt()
    blood_group: Txt = txt()
    address: Txt = txt()
    phone: Txt = txt()
    email: Txt = txt()
    password: Txt = txt()
    authentication_key: Txt = txt()
    designation: Mapped[str | None] = mapped_column(String(255), nullable=True)
    social_links: Txt = txt()
    about: Txt = txt()
    show_on_website: Int = mapped_column(Integer, nullable=True, default=0)


class Student(Base):
    __tablename__ = "student"
    student_id: Mapped[int] = pk()
    student_code: Txt = txt()
    name: Txt = txt()
    birthday: Txt = txt()
    sex: Txt = txt()
    religion: Txt = txt()
    blood_group: Txt = txt()
    address: Txt = txt()
    phone: Txt = txt()
    email: Txt = txt()
    password: Txt = txt()
    parent_id: Int = num()
    dormitory_id: Int = num()
    transport_id: Int = num()
    dormitory_room_number: Txt = txt()
    authentication_key: Txt = txt()


class Parent(Base):
    __tablename__ = "parent"
    parent_id: Mapped[int] = pk()
    name: Txt = txt()
    email: Txt = txt()
    password: Txt = txt()
    phone: Txt = txt()
    address: Txt = txt()
    profession: Txt = txt()
    authentication_key: Txt = txt()


class Librarian(Base):
    __tablename__ = "librarian"
    librarian_id: Mapped[int] = pk()
    name: Txt = txt()
    email: Txt = txt()
    password: Txt = txt()


class Accountant(Base):
    __tablename__ = "accountant"
    accountant_id: Mapped[int] = pk()
    name: Txt = txt()
    email: Txt = txt()
    password: Txt = txt()


# --- academic -----------------------------------------------------------------


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


# --- exams --------------------------------------------------------------------


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


# --- attendance ---------------------------------------------------------------


class Attendance(Base):
    __tablename__ = "attendance"
    attendance_id: Mapped[int] = pk()
    timestamp: Txt = txt()
    year: Txt = txt()
    class_id: Int = num()
    section_id: Int = num()
    student_id: Int = num()
    class_routine_id: Int = num()
    # 0/NULL = not taken, 1 = present, 2 = absent
    status: Int = num()


# --- finance ------------------------------------------------------------------


class Invoice(Base):
    __tablename__ = "invoice"
    invoice_id: Mapped[int] = pk()
    student_id: Int = num()
    title: Txt = txt()
    description: Txt = txt()
    amount: Int = num()
    amount_paid: Txt = txt()
    due: Txt = txt()
    creation_timestamp: Int = num()
    payment_timestamp: Txt = txt()
    payment_method: Txt = txt()
    payment_details: Txt = txt()
    status: Txt = txt()  # "paid" | "unpaid"
    year: Txt = txt()


class Payment(Base):
    __tablename__ = "payment"
    payment_id: Mapped[int] = pk()
    expense_category_id: Int = num()
    title: Txt = txt()
    payment_type: Txt = txt()  # "income" | "expense"
    invoice_id: Int = num()
    student_id: Int = num()
    method: Txt = txt()
    description: Txt = txt()
    amount: Txt = txt()
    timestamp: Txt = txt()
    year: Txt = txt()


class ExpenseCategory(Base):
    __tablename__ = "expense_category"
    expense_category_id: Mapped[int] = pk()
    name: Txt = txt()


# --- library / facilities -----------------------------------------------------


class Book(Base):
    __tablename__ = "book"
    book_id: Mapped[int] = pk()
    name: Txt = txt()
    description: Txt = txt()
    author: Txt = txt()
    class_id: Txt = txt()
    price: Txt = txt()
    total_copies: Int = num()
    issued_copies: Int = num()
    status: Txt = txt()
    file_name: Txt = txt()


class BookRequest(Base):
    __tablename__ = "book_request"
    book_request_id: Mapped[int] = pk()
    book_id: Int = num()
    student_id: Int = num()
    issue_start_date: Txt = txt()
    issue_end_date: Txt = txt()
    # 0 = pending, 1 = issued, 2 = rejected
    status: Int = num()


class Transport(Base):
    __tablename__ = "transport"
    transport_id: Mapped[int] = pk()
    route_name: Txt = txt()
    number_of_vehicle: Txt = txt()
    description: Txt = txt()
    route_fare: Txt = txt()


class Dormitory(Base):
    __tablename__ = "dormitory"
    dormitory_id: Mapped[int] = pk()
    name: Txt = txt()
    number_of_room: Txt = txt()
    description: Txt = txt()


# --- communication ------------------------------------------------------------


class Noticeboard(Base):
    __tablename__ = "noticeboard"
    notice_id: Mapped[int] = pk()
    notice_title: Txt = txt()
    notice: Txt = txt()
    create_timestamp: Txt = txt()
    status: Int = mapped_column(Integer, nullable=True, default=1)
    show_on_website: Int = mapped_column(Integer, nullable=True, default=0)
    image: Txt = txt()


class MessageThread(Base):
    __tablename__ = "message_thread"
    message_thread_id: Mapped[int] = pk()
    message_thread_code: Txt = txt()
    sender: Txt = txt()  # "role-id"
    reciever: Txt = txt()  # "role-id" (legacy spelling)
    last_message_timestamp: Txt = txt()


class Message(Base):
    __tablename__ = "message"
    message_id: Mapped[int] = pk()
    message_thread_code: Txt = txt()
    message: Txt = txt()
    sender: Txt = txt()
    timestamp: Txt = txt()
    read_status: Int = num()
    attached_file_name: Txt = txt()


class GroupMessageThread(Base):
    __tablename__ = "group_message_thread"
    group_message_thread_id: Mapped[int] = pk()
    group_message_thread_code: Txt = txt()
    members: Txt = txt()  # JSON list of "role_id" (underscore, legacy format)
    group_name: Txt = txt()
    last_message_timestamp: Txt = txt()
    created_timestamp: Txt = txt()


class GroupMessage(Base):
    __tablename__ = "group_message"
    group_message_id: Mapped[int] = pk()
    group_message_thread_code: Txt = txt()
    sender: Txt = txt()
    message: Txt = txt()
    timestamp: Txt = txt()
    read_status: Int = num()
    attached_file_name: Txt = txt()


# --- settings / website -------------------------------------------------------


class Setting(Base):
    __tablename__ = "settings"
    settings_id: Mapped[int] = pk()
    type: Txt = txt()
    description: Txt = txt()


class FrontendGeneralSetting(Base):
    __tablename__ = "frontend_general_settings"
    frontend_general_settings_id: Mapped[int] = pk()
    type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Txt = txt()


class FrontendNews(Base):
    __tablename__ = "frontend_news"
    frontend_news_id: Mapped[int] = pk()
    title: Txt = txt()
    description: Txt = txt()
    date_added: Int = num()
    image: Txt = txt()


class FrontendEvent(Base):
    __tablename__ = "frontend_events"
    frontend_events_id: Mapped[int] = pk()
    title: Txt = txt()
    timestamp: Int = num()
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class FrontendGallery(Base):
    __tablename__ = "frontend_gallery"
    frontend_gallery_id: Mapped[int] = pk()
    title: Txt = txt()
    description: Txt = txt()
    date_added: Int = num()
    image: Txt = txt()
    show_on_website: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class FrontendGalleryImage(Base):
    __tablename__ = "frontend_gallery_image"
    frontend_gallery_image_id: Mapped[int] = pk()
    frontend_gallery_id: Int = num()
    title: Txt = txt()
    image: Txt = txt()


class Language(Base):
    __tablename__ = "language"
    id: Mapped[int] = pk()
    english: Mapped[str] = mapped_column(String(255))
    bangali: Mapped[str] = mapped_column(String(255))


class CiSession(Base):
    """Legacy CodeIgniter sessions; not used by the new API."""

    __tablename__ = "ci_sessions"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    ip_address: Mapped[str] = mapped_column(String(45))
    timestamp: Mapped[int] = mapped_column(Integer, default=0)
    data: Mapped[bytes] = mapped_column(LargeBinary)


# --- added by this system (Alembic migrations) ----------------------------------


class AuditLog(Base):
    """One row per insert/update/delete of an audited table (see app/services/audit.py)."""

    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_record", "table_name", "row_id"),
        Index("ix_audit_log_created_at", "created_at"),
    )
    audit_id: Mapped[int] = pk()
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    # "role-id" of the signed-in user; NULL for changes without one (webhooks, password reset, scripts)
    actor: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str] = mapped_column(String(10), nullable=False)
    table_name: Mapped[str] = mapped_column(String(64), nullable=False)
    row_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # JSON: {column: value} for insert/delete, {column: [old, new]} for update
    changes: Txt = txt()


class AcademicYear(Base):
    """School years. `name` matches the legacy `year` columns ("2025-2026"); the current
    one mirrors the legacy `running_year` setting (app/services/years.py keeps them in step)."""

    __tablename__ = "academic_year"
    academic_year_id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(9), unique=True, nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Term(Base):
    __tablename__ = "term"
    term_id: Mapped[int] = pk()
    academic_year_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("academic_year.academic_year_id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)


class CalendarEvent(Base):
    """Academic calendar. `kind` = holiday | exam | event | meeting | other; holidays are
    excluded from attendance working days. `audience` = all | staff | students | parents."""

    __tablename__ = "calendar_event"
    __table_args__ = (Index("ix_calendar_event_dates", "start_date", "end_date"),)
    event_id: Mapped[int] = pk()
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Txt = txt()
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="event")
    audience: Mapped[str] = mapped_column(String(20), nullable=False, default="all")


# --- homework ---------------------------------------------------------------------


class Homework(Base):
    """Homework for a class (section_id NULL = every section) and subject. `year` matches
    the legacy year columns; `teacher_id` is the author (NULL when an admin set it)."""

    __tablename__ = "homework"
    __table_args__ = (Index("ix_homework_class", "year", "class_id", "section_id"),)
    homework_id: Mapped[int] = pk()
    class_id: Mapped[int] = mapped_column(Integer, nullable=False)
    section_id: Int = num()
    subject_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    teacher_id: Int = num()
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Txt = txt()
    file: Mapped[str | None] = mapped_column(String(200), nullable=True)
    assigned_on: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    max_marks: Mapped[float | None] = mapped_column(Float, nullable=True)
    year: Mapped[str] = mapped_column(String(9), nullable=False)
    allow_late: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class HomeworkSubmission(Base):
    """A student's answer. Resubmitting before it is graded replaces it."""

    __tablename__ = "homework_submission"
    __table_args__ = (UniqueConstraint("homework_id", "student_id", name="uq_homework_submission_student"),)
    submission_id: Mapped[int] = pk()
    homework_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("homework.homework_id", ondelete="CASCADE"), nullable=False, index=True
    )
    student_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    text: Txt = txt()
    file: Mapped[str | None] = mapped_column(String(200), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    is_late: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    marks: Mapped[float | None] = mapped_column(Float, nullable=True)
    feedback: Txt = txt()
    # "role-id" of the grader
    graded_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# --- leave ----------------------------------------------------------------------


class LeaveRequest(Base):
    """Leave for a student (student_id set; applied by the student, a parent or an admin) or
    for a member of staff (student_id NULL; staff_role/staff_id is the person on leave).
    status = pending | approved | rejected | cancelled."""

    __tablename__ = "leave_request"
    __table_args__ = (
        Index("ix_leave_request_student", "student_id", "from_date"),
        Index("ix_leave_request_staff", "staff_role", "staff_id"),
    )
    leave_id: Mapped[int] = pk()
    applicant_role: Mapped[str] = mapped_column(String(20), nullable=False)
    applicant_id: Mapped[int] = mapped_column(Integer, nullable=False)
    student_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    staff_role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    staff_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="other")
    from_date: Mapped[date] = mapped_column(Date, nullable=False)
    to_date: Mapped[date] = mapped_column(Date, nullable=False)
    # school days in the range (holidays and weekly days off excluded), fixed when applied
    days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reason: Txt = txt()
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending")
    decided_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decision_note: Txt = txt()
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    year: Mapped[str | None] = mapped_column(String(9), nullable=True)


# --- fees -----------------------------------------------------------------------
# Amounts are whole currency units because the legacy invoice.amount column is an integer.


class FeeHead(Base):
    """A kind of fee, e.g. Tuition, Bus, Lab."""

    __tablename__ = "fee_head"
    fee_head_id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Txt = txt()


class FeePlan(Base):
    """Fees for one class in one year. `late_fine_type` = none | flat | per_day."""

    __tablename__ = "fee_plan"
    __table_args__ = (Index("ix_fee_plan_class_year", "class_id", "year"),)
    fee_plan_id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    class_id: Mapped[int] = mapped_column(Integer, nullable=False)
    year: Mapped[str] = mapped_column(String(9), nullable=False)
    late_fine_type: Mapped[str] = mapped_column(String(10), nullable=False, default="none")
    late_fine_amount: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    grace_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class FeePlanItem(Base):
    __tablename__ = "fee_plan_item"
    fee_plan_item_id: Mapped[int] = pk()
    fee_plan_id: Mapped[int] = mapped_column(Integer, ForeignKey("fee_plan.fee_plan_id", ondelete="CASCADE"), nullable=False, index=True)
    fee_head_id: Mapped[int] = mapped_column(Integer, ForeignKey("fee_head.fee_head_id"), nullable=False, index=True)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)


class FeeInstalment(Base):
    """Part of a plan billed on one due date; the shares of a plan's instalments add up to 100."""

    __tablename__ = "fee_instalment"
    fee_instalment_id: Mapped[int] = pk()
    fee_plan_id: Mapped[int] = mapped_column(Integer, ForeignKey("fee_plan.fee_plan_id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    share_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)


class FeeDiscount(Base):
    """Scholarship or discount for one student in one year, on one plan (or every plan when
    fee_plan_id is NULL). `kind` = percent | amount; an amount is for the whole plan and is
    spread over its instalments by their shares."""

    __tablename__ = "fee_discount"
    fee_discount_id: Mapped[int] = pk()
    student_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    fee_plan_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("fee_plan.fee_plan_id", ondelete="CASCADE"), nullable=True)
    year: Mapped[str] = mapped_column(String(9), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    value: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(200), nullable=True)


class FeeInvoice(Base):
    """Links a legacy invoice to the plan instalment it bills. invoice.amount = base_amount + fine_amount."""

    __tablename__ = "fee_invoice"
    __table_args__ = (UniqueConstraint("fee_instalment_id", "student_id", name="uq_fee_invoice_instalment_student"),)
    fee_invoice_id: Mapped[int] = pk()
    invoice_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    fee_plan_id: Mapped[int] = mapped_column(Integer, ForeignKey("fee_plan.fee_plan_id"), nullable=False, index=True)
    fee_instalment_id: Mapped[int] = mapped_column(Integer, ForeignKey("fee_instalment.fee_instalment_id"), nullable=False)
    student_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    base_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    fine_amount: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_reminded_on: Mapped[date | None] = mapped_column(Date, nullable=True)


# --- report cards -----------------------------------------------------------------


class ExamSchedule(Base):
    """Exam timetable: one paper of one exam for one class. Times are "HH:MM" in the school's time zone."""

    __tablename__ = "exam_schedule"
    __table_args__ = (Index("ix_exam_schedule_exam_class", "exam_id", "class_id"),)
    exam_schedule_id: Mapped[int] = pk()
    exam_id: Mapped[int] = mapped_column(Integer, nullable=False)
    class_id: Mapped[int] = mapped_column(Integer, nullable=False)
    subject_id: Mapped[int] = mapped_column(Integer, nullable=False)
    exam_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[str] = mapped_column(String(5), nullable=False)
    end_time: Mapped[str] = mapped_column(String(5), nullable=False)
    room: Mapped[str | None] = mapped_column(String(50), nullable=True)


class ExamWeight(Base):
    """Share (percent) of an exam in the annual result; a year's weights should add up to 100."""

    __tablename__ = "exam_weight"
    exam_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    weight: Mapped[float] = mapped_column(Float, nullable=False)


class ReportRemark(Base):
    """Teacher's remark on a report card. `exam_id` 0 = the annual report (0, not NULL, so the
    unique key also holds for annual remarks: MySQL allows repeated NULLs in unique keys)."""

    __tablename__ = "report_remark"
    __table_args__ = (UniqueConstraint("student_id", "exam_id", "year", name="uq_report_remark"),)
    report_remark_id: Mapped[int] = pk()
    student_id: Mapped[int] = mapped_column(Integer, nullable=False)
    exam_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    year: Mapped[str] = mapped_column(String(9), nullable=False)
    remark: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


# --- PTM ---


class MeetingSession(Base):
    """A parent-teacher meeting day. Slots are generated per teacher between start_time and
    end_time; a calendar_event (kind "meeting", audience "parents") mirrors the session."""

    __tablename__ = "meeting_session"
    session_id: Mapped[int] = pk()
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    slot_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    location: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # NULL: open to parents of every class
    class_id: Int = num()
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    calendar_event_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("calendar_event.event_id", ondelete="SET NULL"), nullable=True
    )


class MeetingSlot(Base):
    __tablename__ = "meeting_slot"
    __table_args__ = (Index("ix_meeting_slot_session_teacher", "session_id", "teacher_id"),)
    slot_id: Mapped[int] = pk()
    session_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("meeting_session.session_id", ondelete="CASCADE"), nullable=False
    )
    teacher_id: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    # open | booked | blocked
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open")


class MeetingBooking(Base):
    """`active_slot_id` and `active_key` are set only while the booking is active (status
    booked, done or no_show) and are unique, so the database itself refuses a second booking
    of a slot, or a second booking of the same child with the same teacher in one session."""

    __tablename__ = "meeting_booking"
    booking_id: Mapped[int] = pk()
    slot_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("meeting_slot.slot_id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Txt = txt()
    # booked | cancelled | done | no_show
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="booked")
    teacher_note: Txt = txt()
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    active_slot_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True)
    # "<session_id>:<teacher_id>:<student_id>"
    active_key: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)


# --- staff HR -----------------------------------------------------------------
# Staff are teachers, librarians and accountants, identified by (staff_role, staff_id)
# like the legacy "role-id" references. Money columns of these new tables are decimals.


class StaffAttendance(Base):
    """One row per staff member per day. status = present | absent | late | half_day | leave;
    no row means attendance was not taken that day."""

    __tablename__ = "staff_attendance"
    __table_args__ = (UniqueConstraint("staff_role", "staff_id", "date", name="uq_staff_attendance_day"),)
    staff_attendance_id: Mapped[int] = pk()
    staff_role: Mapped[str] = mapped_column(String(20), nullable=False)
    staff_id: Mapped[int] = mapped_column(Integer, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    check_in: Mapped[str | None] = mapped_column(String(5), nullable=True)
    check_out: Mapped[str | None] = mapped_column(String(5), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    recorded_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


class SalaryStructure(Base):
    """Pay of one staff member from `effective_from`; the latest row in effect for a month applies.
    allowances / deductions: JSON lists of {"name": str, "amount": number}."""

    __tablename__ = "salary_structure"
    __table_args__ = (Index("ix_salary_structure_staff", "staff_role", "staff_id"),)
    salary_structure_id: Mapped[int] = pk()
    staff_role: Mapped[str] = mapped_column(String(20), nullable=False)
    staff_id: Mapped[int] = mapped_column(Integer, nullable=False)
    basic: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    allowances: Txt = txt()
    deductions: Txt = txt()
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)


class PayrollRun(Base):
    """Payroll for one month. status = draft (payslips can be recalculated) | finalized | paid."""

    __tablename__ = "payroll_run"
    payroll_run_id: Mapped[int] = pk()
    month: Mapped[str] = mapped_column(String(7), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="draft")
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Payslip(Base):
    __tablename__ = "payslip"
    __table_args__ = (UniqueConstraint("payroll_run_id", "staff_role", "staff_id", name="uq_payslip_staff"),)
    payslip_id: Mapped[int] = pk()
    payroll_run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("payroll_run.payroll_run_id", ondelete="CASCADE"), nullable=False, index=True
    )
    staff_role: Mapped[str] = mapped_column(String(20), nullable=False)
    staff_id: Mapped[int] = mapped_column(Integer, nullable=False)
    staff_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    basic: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    allowances: Txt = txt()
    deductions: Txt = txt()
    absence_deduction: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    gross: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    net: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    working_days: Mapped[int] = mapped_column(Integer, nullable=False)
    present_days: Mapped[float] = mapped_column(Numeric(5, 1), nullable=False)
    absent_days: Mapped[float] = mapped_column(Numeric(5, 1), nullable=False, default=0)
    leave_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    paid_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # legacy `payment` row (payment_type "expense") recorded when the payslip was paid
    payment_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


# --- transport ---------------------------------------------------------------------
# A legacy `transport` row is a route. It (and `student`) is MyISAM in sms.sql, so
# route_id / student_id below are plain indexed columns, not foreign keys.


class Driver(Base):
    """Driver contact record (not a login account)."""

    __tablename__ = "driver"
    driver_id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    licence_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    licence_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    address: Txt = txt()
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Vehicle(Base):
    __tablename__ = "vehicle"
    vehicle_id: Mapped[int] = pk()
    registration_no: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    route_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    driver_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("driver.driver_id", ondelete="SET NULL"), nullable=True)
    insurance_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    fitness_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Txt = txt()
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class RouteStop(Base):
    __tablename__ = "route_stop"
    stop_id: Mapped[int] = pk()
    route_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # "HH:MM", like the legacy class routine times
    pickup_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    drop_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    # overrides the route's fare when set (text, like transport.route_fare)
    fare: Mapped[str | None] = mapped_column(String(20), nullable=True)


class StudentTransport(Base):
    """A student's stop on their route. `student.transport_id` stays the record of the route itself."""

    __tablename__ = "student_transport"
    student_transport_id: Mapped[int] = pk()
    student_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    route_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    stop_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("route_stop.stop_id", ondelete="SET NULL"), nullable=True)
    pickup: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    drop: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    since: Mapped[date | None] = mapped_column(Date, nullable=True)


# --- student records ----------------------------------------------------------------


class StudentHealth(Base):
    """One health profile per student (the legacy `student.blood_group` is used until one is saved)."""

    __tablename__ = "student_health"
    health_id: Mapped[int] = pk()
    student_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    blood_group: Mapped[str | None] = mapped_column(String(10), nullable=True)
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    allergies: Txt = txt()
    conditions: Txt = txt()
    medications: Txt = txt()
    emergency_contact_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    emergency_contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    doctor: Mapped[str | None] = mapped_column(String(200), nullable=True)
    notes: Txt = txt()
    updated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class StudentRecord(Base):
    """Health, discipline, counselling and achievement notes. Counselling notes are always confidential."""

    __tablename__ = "student_record"
    record_id: Mapped[int] = pk()
    student_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    details: Txt = txt()
    action_taken: Txt = txt()
    confidential: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # "role-id" of the author
    recorded_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class CertificateTemplate(Base):
    """`kind` = transfer | bonafide | character | custom; `body` uses {placeholders} (app/services/certificates.py)."""

    __tablename__ = "certificate_template"
    template_id: Mapped[int] = pk()
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class CertificateIssue(Base):
    """An issued certificate. `rendered_body` is a snapshot, so later template edits don't change it."""

    __tablename__ = "certificate_issue"
    certificate_id: Mapped[int] = pk()
    # e.g. TC-2026-0001, numbered per kind and calendar year of issue
    serial_no: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    template_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    student_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    issued_on: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Txt = txt()
    conduct: Mapped[str | None] = mapped_column(String(200), nullable=True)
    rendered_body: Mapped[str] = mapped_column(Text, nullable=False)
    issued_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    cancelled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cancel_reason: Txt = txt()


# --- admissions ---------------------------------------------------------------------


class AdmissionApplication(Base):
    """Online or office admission application. `status` = new | reviewing | accepted |
    rejected | enrolled | withdrawn; enrolling sets student_id and parent_id."""

    __tablename__ = "admission_application"
    __table_args__ = (Index("ix_admission_application_status", "status", "year"),)
    application_id: Mapped[int] = pk()
    reference: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    year: Mapped[str] = mapped_column(String(9), nullable=False)
    class_id: Mapped[int] = mapped_column(Integer, nullable=False)
    student_name: Mapped[str] = mapped_column(String(200), nullable=False)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    previous_school: Mapped[str | None] = mapped_column(String(200), nullable=True)
    guardian_name: Mapped[str] = mapped_column(String(200), nullable=False)
    guardian_relation: Mapped[str | None] = mapped_column(String(50), nullable=True)
    guardian_phone: Mapped[str] = mapped_column(String(50), nullable=False)
    guardian_email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    address: Txt = txt()
    notes: Txt = txt()
    # online (public form) | office (entered by staff) | enquiry (converted lead)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="online")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="new")
    status_note: Txt = txt()
    reviewed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    student_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parent_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class AdmissionDocument(Base):
    __tablename__ = "admission_document"
    document_id: Mapped[int] = pk()
    application_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("admission_application.application_id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    file_name: Mapped[str] = mapped_column(String(200), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class Enquiry(Base):
    """Admission lead. `source` = walk-in | phone | website | other; `status` = open | converted | closed."""

    __tablename__ = "enquiry"
    __table_args__ = (Index("ix_enquiry_follow_up", "status", "follow_up_on"),)
    enquiry_id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    class_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="walk-in")
    follow_up_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    notes: Txt = txt()
    assigned_to: Mapped[str | None] = mapped_column(String(64), nullable=True)
    application_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


# --- attendance devices ---------------------------------------------------------


class PeriodAttendance(Base):
    """Attendance for one timetable period (a legacy class_routine row) on one date.
    status = present | absent | late | excused. Daily attendance stays the official record."""

    __tablename__ = "period_attendance"
    __table_args__ = (
        UniqueConstraint("date", "class_routine_id", "student_id", name="uq_period_attendance"),
        Index("ix_period_attendance_section_day", "class_id", "section_id", "date"),
    )
    period_attendance_id: Mapped[int] = pk()
    date: Mapped[date] = mapped_column(Date, nullable=False)
    class_id: Mapped[int] = mapped_column(Integer, nullable=False)
    section_id: Mapped[int] = mapped_column(Integer, nullable=False)
    class_routine_id: Mapped[int] = mapped_column(Integer, nullable=False)
    subject_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    marked_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    marked_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class IdCard(Base):
    """A card a student or staff member scans to check in. `card_uid` is the RFID UID or
    the code printed on the card (barcode). One active card per holder."""

    __tablename__ = "id_card"
    __table_args__ = (Index("ix_id_card_holder", "holder_role", "holder_id"),)
    card_id: Mapped[int] = pk()
    holder_role: Mapped[str] = mapped_column(String(20), nullable=False)
    holder_id: Mapped[int] = mapped_column(Integer, nullable=False)
    card_uid: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    issued_on: Mapped[date] = mapped_column(Date, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class AttendanceDevice(Base):
    """RFID / biometric terminal (or middleware) that pushes punches with its own key.
    Only the SHA-256 of the key is stored."""

    __tablename__ = "attendance_device"
    device_id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    api_key_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class AttendancePunch(Base):
    """Every scan, from the kiosk or a device, and what it did. `punched_at` is school-local time.
    source = qr | rfid | device | manual; result = marked_present | marked_late | checked_out |
    already_marked | duplicate | unknown_card | not_enrolled | invalid_time."""

    __tablename__ = "attendance_punch"
    __table_args__ = (
        Index("ix_attendance_punch_holder", "holder_role", "holder_id", "punched_at"),
        Index("ix_attendance_punch_time", "punched_at"),
    )
    punch_id: Mapped[int] = pk()
    device_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    card_uid: Mapped[str] = mapped_column(String(100), nullable=False)
    holder_role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    holder_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    punched_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    source: Mapped[str] = mapped_column(String(10), nullable=False)
    result: Mapped[str] = mapped_column(String(20), nullable=False)
    recorded_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
