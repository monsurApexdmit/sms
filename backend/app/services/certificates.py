"""Certificate templates, placeholder rendering and serial numbers."""

import re
from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import CertificateIssue, CertificateTemplate, Enroll, Parent, SchoolClass, Section, Student
from app.services.access import current_enroll
from app.services.settings import get_setting, running_year

KINDS = ("transfer", "bonafide", "character", "custom")
SERIAL_PREFIX = {"transfer": "TC", "bonafide": "BC", "character": "CC", "custom": "CERT"}

PLACEHOLDERS: dict[str, str] = {
    "student_name": "Student's full name",
    "father_name": "Parent / guardian name (the legacy data has one parent per student)",
    "guardian_name": "Parent / guardian name",
    "class": "Class in the running year",
    "section": "Section in the running year",
    "roll": "Roll number in the running year",
    "year": "Running academic year, e.g. 2025-2026",
    "date_of_birth": "Date of birth",
    "admission_date": "Date of the student's first enrolment",
    "issue_date": "Date the certificate is issued",
    "serial": "Certificate serial number, e.g. TC-2026-0001",
    "school_name": "School name from the settings",
    "reason": "Reason entered when issuing (e.g. for a transfer)",
    "conduct": "Conduct entered when issuing (e.g. Good)",
}

DEFAULT_TEMPLATES: list[dict[str, str]] = [
    {
        "kind": "transfer",
        "name": "Transfer certificate",
        "body": (
            "This is to certify that {student_name}, son/daughter of {father_name}, was a bona fide student of "
            "{school_name} from {admission_date}. At the time of leaving, {student_name} was studying in class "
            "{class}, section {section} (roll {roll}) in the academic year {year}. Date of birth according to "
            "the school records: {date_of_birth}.\n\n"
            "Reason for leaving: {reason}\nConduct and character: {conduct}\n\n"
            "All dues to the school have been cleared. We wish {student_name} every success."
        ),
    },
    {
        "kind": "bonafide",
        "name": "Bonafide certificate",
        "body": (
            "This is to certify that {student_name}, son/daughter of {father_name}, is a bona fide student of "
            "{school_name}, studying in class {class}, section {section} (roll {roll}) in the academic year {year}. "
            "Date of birth according to the school records: {date_of_birth}.\n\n"
            "This certificate is issued on request for the purpose of {reason}."
        ),
    },
    {
        "kind": "character",
        "name": "Character certificate",
        "body": (
            "This is to certify that {student_name}, son/daughter of {father_name}, has been a student of "
            "{school_name} since {admission_date} and is studying in class {class} in the academic year {year}.\n\n"
            "To the best of our knowledge, {student_name} bears a {conduct} moral character and has not taken "
            "part in any activity against the school or the state."
        ),
    },
]

_PLACEHOLDER = re.compile(r"\{(\w+)\}")


def ensure_default_templates(db: Session) -> int:
    """Add the default templates when there are none. Returns how many were added; the caller commits."""
    if db.scalar(select(func.count()).select_from(CertificateTemplate)):
        return 0
    db.add_all(CertificateTemplate(active=True, **t) for t in DEFAULT_TEMPLATES)
    return len(DEFAULT_TEMPLATES)


BLANK = "________"


def render(body: str, values: dict[str, str]) -> str:
    """Fill known {placeholders}. Unknown ones are left as typed so mistakes stay visible, and
    known ones without a value print as a blank line to fill in by hand."""

    def fill(m: re.Match) -> str:
        name = m.group(1)
        if name not in values:
            return m.group(0)
        return values[name].strip() or BLANK

    return _PLACEHOLDER.sub(fill, body)


def unknown_placeholders(body: str) -> list[str]:
    return sorted({m for m in _PLACEHOLDER.findall(body) if m not in PLACEHOLDERS})


def fmt_date(d: date) -> str:
    return d.strftime("%d %B %Y")


def _legacy_date(raw: str | None) -> str:
    """Legacy dates are unix timestamps or free text; show timestamps as dates and anything else as typed."""
    if not raw:
        return ""
    raw = raw.strip()
    if raw.isdigit():
        return fmt_date(datetime.fromtimestamp(int(raw), timezone.utc).date())
    return raw


def student_values(
    db: Session, student: Student, *, issued_on: date, serial: str = "", reason: str | None = None, conduct: str | None = None
) -> dict[str, str]:
    year = running_year(db)
    enroll = current_enroll(db, student.student_id, year)
    first = db.scalars(
        select(Enroll).where(Enroll.student_id == student.student_id).order_by(Enroll.year, Enroll.enroll_id)
    ).first()
    klass = db.get(SchoolClass, enroll.class_id) if enroll and enroll.class_id else None
    section = db.get(Section, enroll.section_id) if enroll and enroll.section_id else None
    parent = db.get(Parent, student.parent_id) if student.parent_id else None
    guardian = (parent.name if parent else None) or ""
    return {
        "student_name": student.name or "",
        "father_name": guardian,
        "guardian_name": guardian,
        "class": (klass.name if klass else None) or "",
        "section": (section.name if section else None) or "",
        "roll": str(enroll.roll) if enroll and enroll.roll is not None else "",
        "year": year,
        "date_of_birth": _legacy_date(student.birthday),
        "admission_date": _legacy_date(first.date_added) if first else "",
        "issue_date": fmt_date(issued_on),
        "serial": serial,
        "school_name": get_setting(db, "system_name"),
        "reason": reason or "",
        "conduct": conduct or "",
    }


def next_serial(db: Session, kind: str, issued_on: date) -> str:
    prefix = f"{SERIAL_PREFIX[kind]}-{issued_on.year}-"
    last = db.scalars(
        select(CertificateIssue.serial_no).where(CertificateIssue.serial_no.like(f"{prefix}%"))
    ).all()
    seq = max((int(s[len(prefix):]) for s in last if s[len(prefix):].isdigit()), default=0) + 1
    return f"{prefix}{seq:04d}"


def initials(name: str | None) -> str:
    return "".join(f"{part[0].upper()}." for part in (name or "").split() if part[:1].isalpha())
