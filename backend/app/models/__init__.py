"""ORM mapping of the existing `sms` database (sqldatabase/sms.sql).

The schema is used as-is so the legacy CodeIgniter app and this API can share one
database during migration. Column names (including typos such as `reciever`) and
types (unix timestamps stored as text, `year` as "2020-2021") are kept verbatim.
Models are grouped by area, one module each; tables added by this system are created
by the Alembic migrations in `alembic/` and the legacy app ignores them. Everything
is re-exported here, so `from app.models import Student` works and Alembic sees every table.
"""

from app.models.academic import AcademicSyllabus, ClassRoutine, Document, Enroll, SchoolClass, Section, Subject
from app.models.accounts import Accountant, Admin, Librarian, Parent, Student, Teacher
from app.models.admissions import AdmissionApplication, AdmissionDocument, Enquiry
from app.models.ai import AiRequest
from app.models.attendance import Attendance
from app.models.attendance_capture import AttendanceDevice, AttendancePunch, IdCard, PeriodAttendance
from app.models.audit import AuditLog
from app.models.calendar import AcademicYear, CalendarEvent, Term
from app.models.communication import GroupMessage, GroupMessageThread, Message, MessageThread, Noticeboard
from app.models.exams import Exam, Grade, Mark, OnlineExam, OnlineExamResult, QuestionBank, QuestionPaper
from app.models.facilities import Dormitory, Transport
from app.models.fees import FeeDiscount, FeeHead, FeeInstalment, FeeInvoice, FeePlan, FeePlanItem
from app.models.finance import ExpenseCategory, Invoice, Payment
from app.models.gateways import GatewayTransaction
from app.models.homework import Homework, HomeworkSubmission
from app.models.hr import PayrollRun, Payslip, SalaryStructure, StaffAttendance
from app.models.leave import LeaveRequest
from app.models.library import Book, BookRequest
from app.models.meetings import MeetingBooking, MeetingSession, MeetingSlot
from app.models.notifications import Notification, NotificationPreference, PushSubscription
from app.models.permissions import AccessRole, AccessRolePermission
from app.models.records import CertificateIssue, CertificateTemplate, StudentHealth, StudentRecord
from app.models.report_cards import ExamSchedule, ExamWeight, ReportRemark
from app.models.settings import (
    CiSession,
    FrontendEvent,
    FrontendGallery,
    FrontendGalleryImage,
    FrontendGeneralSetting,
    FrontendNews,
    Language,
    Setting,
)
from app.models.transport import Driver, RouteStop, StudentTransport, Vehicle
from app.models.two_factor import UserTotp

__all__ = [
    "AcademicSyllabus",
    "AcademicYear",
    "AccessRole",
    "AccessRolePermission",
    "Accountant",
    "Admin",
    "AdmissionApplication",
    "AdmissionDocument",
    "AiRequest",
    "Attendance",
    "AttendanceDevice",
    "AttendancePunch",
    "AuditLog",
    "Book",
    "BookRequest",
    "CalendarEvent",
    "CertificateIssue",
    "CertificateTemplate",
    "CiSession",
    "ClassRoutine",
    "Document",
    "Dormitory",
    "Driver",
    "Enquiry",
    "Enroll",
    "Exam",
    "ExamSchedule",
    "ExamWeight",
    "ExpenseCategory",
    "FeeDiscount",
    "FeeHead",
    "FeeInstalment",
    "FeeInvoice",
    "FeePlan",
    "FeePlanItem",
    "FrontendEvent",
    "FrontendGallery",
    "FrontendGalleryImage",
    "FrontendGeneralSetting",
    "FrontendNews",
    "GatewayTransaction",
    "Grade",
    "GroupMessage",
    "GroupMessageThread",
    "Homework",
    "HomeworkSubmission",
    "IdCard",
    "Invoice",
    "Language",
    "LeaveRequest",
    "Librarian",
    "Mark",
    "MeetingBooking",
    "MeetingSession",
    "MeetingSlot",
    "Message",
    "MessageThread",
    "Noticeboard",
    "Notification",
    "NotificationPreference",
    "OnlineExam",
    "OnlineExamResult",
    "Parent",
    "Payment",
    "PayrollRun",
    "Payslip",
    "PeriodAttendance",
    "PushSubscription",
    "QuestionBank",
    "QuestionPaper",
    "ReportRemark",
    "RouteStop",
    "SalaryStructure",
    "SchoolClass",
    "Section",
    "Setting",
    "StaffAttendance",
    "Student",
    "StudentHealth",
    "StudentRecord",
    "StudentTransport",
    "Subject",
    "Teacher",
    "Term",
    "Transport",
    "UserTotp",
    "Vehicle",
]
