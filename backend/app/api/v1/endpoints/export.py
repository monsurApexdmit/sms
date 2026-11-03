"""Excel downloads of the list screens. Each endpoint reuses the screen's own list
function, so filters and access rules match what the user sees."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select

from app.api.deps import DB, CurrentUser, Me, require_roles
from app.api.v1.endpoints import attendance, audit, exams, finance, students
from app.models import Exam, Parent, SchoolClass, Section, Subject, Teacher
from app.services.access import STAFF, ensure_teaches_subject
from app.services.export import MAX_ROWS, check_size, number, unix_date, xlsx_response

router = APIRouter(prefix="/export", tags=["export"])
ALL = (*STAFF, "student", "parent")
FIN = [Depends(require_roles("admin", "accountant"))]
TEACHING = [Depends(require_roles("admin", "teacher"))]


def _name(db: DB, model, obj_id: int | None) -> str:
    row = db.get(model, obj_id) if obj_id else None
    return (row.name or "") if row is not None else ""


# --- people ---------------------------------------------------------------------


@router.get("/students.xlsx", dependencies=[Depends(require_roles(*STAFF))])
def export_students(
    db: DB,
    class_id: int | None = None,
    section_id: int | None = None,
    transport_id: int | None = None,
    dormitory_id: int | None = None,
    year: str | None = None,
    q: str | None = None,
):
    page = students.list_students(
        db=db, class_id=class_id, section_id=section_id, transport_id=transport_id, dormitory_id=dormitory_id,
        year=year, q=q, limit=MAX_ROWS, offset=0,
    )  # fmt: skip
    check_size(page.total)
    headers = ["Student ID", "Name", "Class", "Section", "Roll", "Year", "Email", "Phone", "Gender", "Birthday", "Address", "Parent"]
    rows = [
        [s.student_code, s.name, s.class_name, s.section_name, s.roll, s.year, s.email, s.phone, s.sex, s.birthday, s.address, s.parent_name]
        for s in page.items
    ]
    label = "-".join(p for p in ("students", _name(db, SchoolClass, class_id), _name(db, Section, section_id)) if p)
    return xlsx_response(label, headers, rows, sheet="Students")


def _accounts(db: DB, model, q: str | None):
    stmt = select(model)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(model.name.like(like), model.email.like(like)))
    check_size(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    return db.scalars(stmt.order_by(model.name))


@router.get("/teachers.xlsx", dependencies=[Depends(require_roles(*ALL))])
def export_teachers(db: DB, viewer: Me, q: str | None = None):
    """Admins get every field; other roles the same directory fields the Teachers screen shows them."""
    rows = _accounts(db, Teacher, q)
    if viewer.role != "admin":
        return xlsx_response("teachers", ["Name", "Email", "Designation"], ([t.name, t.email, t.designation] for t in rows), "Teachers")
    headers = ["Name", "Email", "Designation", "Phone", "Gender", "Birthday", "Blood group", "Religion", "Address"]
    data = ([t.name, t.email, t.designation, t.phone, t.sex, t.birthday, t.blood_group, t.religion, t.address] for t in rows)
    return xlsx_response("teachers", headers, data, "Teachers")


@router.get("/parents.xlsx", dependencies=[Depends(require_roles("admin"))])
def export_parents(db: DB, q: str | None = None):
    rows = _accounts(db, Parent, q)
    data = ([p.name, p.email, p.phone, p.profession, p.address] for p in rows)
    return xlsx_response("parents", ["Name", "Email", "Phone", "Profession", "Address"], data, "Parents")


# --- finance --------------------------------------------------------------------


@router.get("/invoices.xlsx", dependencies=FIN)
def export_invoices(
    db: DB,
    student_id: int | None = None,
    status_: str | None = Query(None, alias="status"),
    year: str | None = None,
    q: str | None = Query(None, max_length=100),
):
    page = finance.list_invoices(db=db, student_id=student_id, status_=status_, year=year, q=q, limit=MAX_ROWS, offset=0)
    check_size(page.total)
    headers = ["Invoice", "Student", "Title", "Description", "Total", "Paid", "Due", "Status", "Created", "Last payment", "Method", "Year"]
    rows = [
        [
            i.invoice_id, i.student_name, i.title, i.description, number(i.amount), number(i.amount_paid), number(i.due),
            i.status, unix_date(i.creation_timestamp), unix_date(i.payment_timestamp), i.payment_method, i.year,
        ]  # fmt: skip
        for i in page.items
    ]
    return xlsx_response(f"invoices-{status_ or 'all'}", headers, rows, "Invoices")


@router.get("/payments.xlsx", dependencies=FIN)
def export_payments(
    db: DB,
    payment_type: str | None = Query(None, pattern="^(income|expense)$"),
    year: str | None = None,
    student_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
):
    page = finance.list_payments(
        db=db, payment_type=payment_type, year=year, student_id=student_id,
        date_from=date_from, date_to=date_to, limit=MAX_ROWS, offset=0,
    )  # fmt: skip
    check_size(page.total)
    headers = ["Date", "Type", "Title", "Student", "Category", "Method", "Amount", "Invoice", "Description", "Year"]
    rows = [
        [
            unix_date(p.timestamp), p.payment_type, p.title, p.student_name, p.category_name, p.method,
            number(p.amount), p.invoice_id, p.description, p.year,
        ]  # fmt: skip
        for p in page.items
    ]
    return xlsx_response(f"{payment_type or 'payments'}", headers, rows, "Payments")


# --- attendance and exams ---------------------------------------------------------


@router.get("/attendance.xlsx", dependencies=TEACHING)
def export_attendance(class_id: int, section_id: int, month: str, db: DB):
    """Monthly grid: P / A per day, H on holidays and weekly days off with no record."""
    report = attendance.class_report(class_id, section_id, month, db)
    days, holidays, off = report["days"], report["holidays"], set(report["off_days"])
    headers = ["Roll", "Student", *[str(d) for d in range(1, days + 1)], "Present", "Absent", "Working days"]
    rows = []
    for r in report["rows"]:
        cells = []
        for d in range(1, days + 1):
            status_ = r["days"].get(d)
            cells.append("P" if status_ == 1 else "A" if status_ == 2 else "H" if (d in holidays or d in off) else "")
        rows.append([r["roll"], r["name"], *cells, r["present"], r["absent"], report["working_days"]])
    label = f"attendance-{_name(db, SchoolClass, class_id)}-{_name(db, Section, section_id)}-{month}"
    return xlsx_response(label, headers, rows, f"Attendance {month}")


@router.get("/tabulation.xlsx", dependencies=TEACHING)
def export_tabulation(class_id: int, exam_id: int, db: DB, section_id: int | None = None):
    sheet = exams.tabulation(class_id, exam_id, db, section_id)
    subjects = sheet["subjects"]
    headers = ["Roll", "Student", *[s["name"] for s in subjects], "Total", "Average GP"]
    rows = [
        [r["roll"], r["name"], *[r["marks"].get(s["subject_id"]) for s in subjects], r["total"], r["average_grade_point"]]
        for r in sheet["rows"]
    ]
    label = f"tabulation-{_name(db, Exam, exam_id)}-{_name(db, SchoolClass, class_id)}"
    return xlsx_response(label, headers, rows, "Tabulation")


@router.get("/marks.xlsx")
def export_marks(
    exam_id: int, class_id: int, section_id: int, subject_id: int, db: DB,
    user: CurrentUser = Depends(require_roles("admin", "teacher")),
):  # fmt: skip
    ensure_teaches_subject(db, user, subject_id)
    sheet = exams._mark_sheet(db, exam_id, class_id, section_id, subject_id)
    rows = [[m.roll, m.student_name, m.mark_obtained, m.comment] for m in sheet]
    label = f"marks-{_name(db, Exam, exam_id)}-{_name(db, Subject, subject_id)}"
    return xlsx_response(label, ["Roll", "Student", "Mark", "Comment"], rows, "Marks")


# --- audit log ------------------------------------------------------------------


@router.get("/audit-log.xlsx", dependencies=[Depends(require_roles("admin"))])
def export_audit_log(
    db: DB,
    table_name: str | None = None,
    row_id: str | None = None,
    actor: str | None = None,
    action: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
):
    page = audit.list_audit_log(
        db=db, table_name=table_name, row_id=row_id, actor=actor, action=action,
        date_from=date_from, date_to=date_to, limit=MAX_ROWS, offset=0,
    )  # fmt: skip
    check_size(page.total)
    headers = ["When (UTC)", "By", "User", "Action", "Table", "Record", "Changes"]
    rows = [
        [
            e.created_at, e.actor_name, e.actor, e.action, e.table_name, e.row_id,
            "; ".join(f"{k}: {v[0]} → {v[1]}" if e.action == "update" and isinstance(v, list) else f"{k}: {v}" for k, v in e.changes.items()),
        ]  # fmt: skip
        for e in page.items
    ]
    return xlsx_response("audit-log", headers, rows, "Audit log")
