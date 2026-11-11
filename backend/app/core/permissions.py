"""Modules for role permissions, and which API paths belong to each.

Every role's access is stored as data (tables `access_role` and `access_role_permission`):
one level per module, `full`, `view` or `none`. The six built-in roles are seeded with what
they could always do; administrators then narrow them, or create custom roles for admin-type
staff ("Office staff", "Exam controller"). A level can never go beyond the role's defaults
below: the endpoints themselves still check the role, so granting more would not work anyway.

A request is matched to a module by the first segment of its path (`/api/<segment>/...`).
"""

from dataclasses import dataclass

FULL, VIEW, NONE = "full", "view", "none"
LEVELS = (FULL, VIEW, NONE)
RANK = {NONE: 0, VIEW: 1, FULL: 2}

ROLES = ("admin", "teacher", "accountant", "librarian", "student", "parent")
STAFF = ("admin", "teacher", "accountant", "librarian")
_A, _T, _AC, _L, _S, _P = ROLES
EVERYONE = ROLES


@dataclass(frozen=True)
class Module:
    key: str
    group: str
    label: str
    prefixes: tuple[str, ...]
    roles: tuple[str, ...]  # roles that have this module by default (at `full`)


MODULES: tuple[Module, ...] = (
    # people
    Module("students", "People", "Students & promotion", ("students", "student-records"), (_A, _T)),
    Module("student_profile", "People", "Student profiles & health", ("student-profile",), (_A, _T, _S, _P)),
    Module("teachers", "People", "Teachers", ("teachers",), (_A, _T, _S, _P)),
    Module("parents", "People", "Parents", ("parents",), (_A,)),
    Module("staff", "People", "Staff accounts", ("admins", "librarians", "accountants"), (_A,)),
    Module("id_cards", "People", "ID cards & devices", ("id-cards", "attendance-devices"), (_A,)),
    Module("certificates", "People", "Certificates", ("certificates", "certificate-templates"), (_A, _S, _P)),
    Module("admissions", "People", "Admissions & enquiries", ("admissions", "enquiries"), (_A, _AC)),
    # academic
    Module("classes", "Academic", "School years, classes & sections", ("classes", "sections", "school-years", "academic-years"), (_A,)),
    Module("subjects", "Academic", "Subjects", ("subjects",), (_A, _T, _S, _P)),
    Module("routine", "Academic", "Class routine", ("class-routines",), (_A, _T, _S, _P)),
    Module("syllabus", "Academic", "Syllabus & study material", ("syllabus", "study-materials"), (_A, _T, _S, _P)),
    Module("homework", "Academic", "Homework", ("homework",), (_A, _T, _S, _P)),
    Module("calendar", "Academic", "Academic calendar", ("calendar",), EVERYONE),
    # exams
    Module("exams", "Exams", "Exams, grades & timetable", ("exams", "grades", "terms", "exam-schedule", "exam-weights", "admit-cards"), EVERYONE),
    Module("marks", "Exams", "Marks, marksheets & report cards", ("marks", "marksheet", "tabulation", "report-cards"), EVERYONE),
    Module("online_exams", "Exams", "Online exams & question papers", ("online-exams", "question-papers"), (_A, _T, _S, _P)),
    # attendance
    Module("attendance", "Attendance", "Student attendance", ("attendance", "period-attendance"), (_A, _T, _S, _P)),
    Module("kiosk", "Attendance", "Check-in kiosk", ("attendance-kiosk", "attendance-capture", "attendance-punches"), STAFF),
    Module("leave", "Attendance", "Leave", ("leave",), EVERYONE),
    # finance
    Module("invoices", "Finance", "Invoices & payments", ("invoices", "payments"), (_A, _AC, _S, _P)),
    Module("accounting", "Finance", "Income & expenses", ("expenses", "expense-categories", "finance"), (_A, _AC)),
    Module("fee_setup", "Finance", "Fee setup", ("fee-plans", "fee-discounts", "fee-heads", "fees"), (_A, _AC)),
    # hr
    Module("hr", "HR", "Staff attendance & payroll", ("hr",), STAFF),
    # campus
    Module("library", "Campus", "Library", ("books", "book-requests"), EVERYONE),
    Module("transport", "Campus", "Transport & dormitory", ("transport", "transports", "drivers", "dormitories"), (_A, _T, _S, _P)),
    Module("notices", "Campus", "Noticeboard", ("notices",), EVERYONE),
    Module("messages", "Campus", "Messages", ("messages", "groups"), EVERYONE),
    Module("meetings", "Campus", "Parent-teacher meetings", ("meetings",), (_A, _T, _P)),
    # reports and settings
    Module("analytics", "Settings", "Analytics", ("analytics",), (_A, _T, _AC)),
    Module("ai", "Settings", "AI assistant", ("ai",), EVERYONE),
    Module("website", "Settings", "Public website", ("cms",), (_A,)),
    Module("settings", "Settings", "System settings", ("settings", "payment-gateways"), (_A,)),
    Module("audit_log", "Settings", "Audit log", ("audit-log",), (_A,)),
)
BY_KEY = {m.key: m for m in MODULES}
_BY_PREFIX = {p: m.key for m in MODULES for p in m.prefixes}

# Never checked: sign-in, the public website, files, the dashboard, a user's own things, and
# the permission screens (which only full administrators may use).
EXEMPT = frozenset({"auth", "public", "health", "media", "dashboard", "my", "notifications", "permissions", "docs", "openapi.json", "redoc"})
EXEMPT_PATHS = frozenset({"settings/public"})
# A user's own records inside a module ("/hr/payslips/mine", "/students/children").
PERSONAL = frozenset({"mine", "children", "available", "unread-count"})
# Lists other screens look things up in (student pickers, class lists): reading them is
# always allowed; changing them still needs the module.
SHARED_READ = frozenset(
    {"students", "teachers", "parents", "admins", "librarians", "accountants", "classes", "sections", "subjects",
     "school-years", "academic-years", "exams", "grades", "terms", "calendar", "class-routines", "transports", "dormitories"}
)  # fmt: skip
# Spreadsheet exports follow the module of what they export.
EXPORTS = {
    "students": "students", "teachers": "teachers", "parents": "parents", "invoices": "invoices", "payments": "invoices",
    "attendance": "attendance", "marks": "marks", "tabulation": "marks", "audit-log": "audit_log",
}  # fmt: skip


@dataclass(frozen=True)
class Target:
    module: str | None  # None: no module (exempt, or a path the registry does not know)
    shared_read: bool = False
    exempt: bool = False


def resolve(path: str) -> Target:
    """Module for an API path such as "/api/students/5" (or "students/5")."""
    parts = [p for p in path.split("?")[0].split("/") if p]
    if parts and parts[0] == "api":
        parts = parts[1:]
    if not parts or parts[0] in EXEMPT or "/".join(parts[:2]) in EXEMPT_PATHS or PERSONAL.intersection(parts[1:]):
        return Target(None, exempt=True)
    head = parts[0]
    if head == "export":
        name = parts[1].removesuffix(".xlsx") if len(parts) > 1 else ""
        return Target(EXPORTS.get(name))
    return Target(_BY_PREFIX.get(head), shared_read=head in SHARED_READ)


def default_level(role: str, module: str) -> str:
    return FULL if role in BY_KEY[module].roles else NONE


def available(role: str, module: str) -> bool:
    """Can this role be given the module at all? (Custom roles are admin-based.)"""
    return role in BY_KEY[module].roles
