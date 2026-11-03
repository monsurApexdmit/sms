"""Fill an empty `sms` database with demo data for local development.

    python -m scripts.seed_demo --yes

Creates one account per role (password for all: Demo@12345), a class with two
sections, subjects, an exam, grades, a timetable, invoices, a notice and books.
Safe to re-run: it stops if the demo admin already exists. Never run it against
production data.
"""

import argparse
import calendar
import secrets
import sys
import time
from datetime import date, timedelta

from sqlalchemy import select

from app.core.security import hash_password
from app.core.tenancy import multi_tenant, tenant_by_slug, use_tenant
from app.db.session import new_session
from app.models import (
    Accountant,
    Admin,
    Book,
    ClassRoutine,
    Dormitory,
    Enroll,
    Exam,
    ExpenseCategory,
    Grade,
    Invoice,
    Librarian,
    Noticeboard,
    Parent,
    Payment,
    SchoolClass,
    Section,
    Student,
    Subject,
    Teacher,
    Transport,
)
from app.services.settings import running_year

PASSWORD = "Demo@12345"
DEMO_ADMIN = "admin@demo.school"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", action="store_true", help="confirm writing demo rows")
    parser.add_argument("--school", help="school slug, on a multi-school install (see scripts.tenants)")
    args = parser.parse_args()
    if not args.yes:
        sys.exit("Refusing to write demo data without --yes")
    if multi_tenant():
        tenant = tenant_by_slug(args.school or "", refresh=True)
        if tenant is None:
            sys.exit("Several schools are configured: pass --school <slug> (python -m scripts.tenants list)")
        with use_tenant(tenant):
            seed()
    else:
        seed()


def seed() -> None:
    db = new_session()
    if db.scalars(select(Admin).where(Admin.email == DEMO_ADMIN)).first():
        print("Demo data already present; nothing to do.")
        return

    pw = hash_password(PASSWORD)
    year = running_year(db)
    now = str(int(time.time()))

    db.add_all(
        [
            Admin(name="Demo Admin", email=DEMO_ADMIN, password=pw, level="1"),
            Librarian(name="Demo Librarian", email="librarian@demo.school", password=pw),
            Accountant(name="Demo Accountant", email="accountant@demo.school", password=pw),
        ]
    )
    t1 = Teacher(name="Ayesha Rahman", email="teacher@demo.school", password=pw, designation="Senior Teacher",
                 sex="female", phone="01700000001", show_on_website=1, about="Teaches mathematics.")
    t2 = Teacher(name="Karim Hossain", email="teacher2@demo.school", password=pw, designation="Teacher",
                 sex="male", phone="01700000002", show_on_website=1, about="Teaches science.")
    parent = Parent(name="Demo Parent", email="parent@demo.school", password=pw, phone="01800000000",
                    profession="Engineer")
    transport = Transport(route_name="Route 1 - City Centre", number_of_vehicle="2", route_fare="20")
    dorm = Dormitory(name="North Hall", number_of_room="30")
    db.add_all([t1, t2, parent, transport, dorm])
    db.flush()

    cls = SchoolClass(name="Ten", name_numeric="10", teacher_id=t1.teacher_id)
    db.add(cls)
    db.flush()
    sec_a = Section(name="A", nick_name="Rose", class_id=cls.class_id, teacher_id=t1.teacher_id)
    sec_b = Section(name="B", nick_name="Lily", class_id=cls.class_id, teacher_id=t2.teacher_id)
    db.add_all([sec_a, sec_b])
    db.flush()

    subjects = [
        Subject(name="Mathematics", class_id=cls.class_id, teacher_id=t1.teacher_id, year=year),
        Subject(name="English", class_id=cls.class_id, teacher_id=t1.teacher_id, year=year),
        Subject(name="Physics", class_id=cls.class_id, teacher_id=t2.teacher_id, year=year),
    ]
    db.add_all(subjects)
    db.flush()

    names = ["Rahim Uddin", "Nadia Islam", "Tanvir Ahmed", "Sadia Karim", "Fahim Chowdhury", "Mitu Akter"]
    students = []
    for i, name in enumerate(names, start=1):
        s = Student(
            name=name,
            email="student@demo.school" if i == 1 else f"student{i}@demo.school",
            password=pw,
            student_code=f"S{1000 + i}",
            sex="male" if i % 2 else "female",
            phone=f"0190000000{i}",
            parent_id=parent.parent_id if i <= 2 else None,
            transport_id=transport.transport_id if i % 3 == 0 else None,
        )
        db.add(s)
        db.flush()
        db.add(
            Enroll(
                student_id=s.student_id,
                class_id=cls.class_id,
                section_id=sec_a.section_id if i <= 4 else sec_b.section_id,
                roll=i,
                enroll_code=secrets.token_hex(4)[:7],
                date_added=now,
                year=year,
            )
        )
        students.append(s)

    db.add(Exam(name="First Term", date=date.today().isoformat(), year=year, comment="Demo exam"))
    db.add_all(
        [
            Grade(name="A+", grade_point="5.00", mark_from=80, mark_upto=100),
            Grade(name="A", grade_point="4.00", mark_from=70, mark_upto=79),
            Grade(name="A-", grade_point="3.50", mark_from=60, mark_upto=69),
            Grade(name="B", grade_point="3.00", mark_from=50, mark_upto=59),
            Grade(name="C", grade_point="2.00", mark_from=40, mark_upto=49),
            Grade(name="F", grade_point="0.00", mark_from=0, mark_upto=39),
        ]
    )
    for day, (subj, hour) in zip(
        ("sunday", "monday", "tuesday"), ((subjects[0], 9), (subjects[1], 10), (subjects[2], 11)), strict=True
    ):
        db.add(
            ClassRoutine(
                class_id=cls.class_id, section_id=sec_a.section_id, subject_id=subj.subject_id, day=day,
                time_start=hour, time_start_min=0, time_end=hour, time_end_min=45, year=year,
            )  # fmt: skip
        )

    created = calendar.timegm((date.today() - timedelta(days=10)).timetuple())
    for s, paid in ((students[0], 500), (students[1], 1500)):
        inv = Invoice(
            student_id=s.student_id, title="Tuition fee", description="Monthly tuition", amount=1500,
            amount_paid=str(paid), due=str(1500 - paid), status="paid" if paid >= 1500 else "unpaid",
            creation_timestamp=created, year=year,
        )  # fmt: skip
        db.add(inv)
        db.flush()
        db.add(
            Payment(
                invoice_id=inv.invoice_id, student_id=s.student_id, title=inv.title, payment_type="income",
                method="cash", amount=str(paid), timestamp=str(created), year=year,
            )  # fmt: skip
        )
    cat = ExpenseCategory(name="Utilities")
    db.add(cat)
    db.flush()
    db.add(
        Payment(
            title="Electricity bill", payment_type="expense", expense_category_id=cat.expense_category_id,
            method="bank", amount="300", timestamp=now, year=year,
        )  # fmt: skip
    )
    db.add(
        Noticeboard(
            notice_title="Welcome to the new portal",
            notice="The school portal has moved to a new system. Please update your bookmarks.",
            create_timestamp=now, status=1, show_on_website=1,
        )  # fmt: skip
    )
    db.add_all(
        [
            Book(name="Higher Mathematics", author="S. Ali", class_id=str(cls.class_id), price="250",
                 total_copies=5, issued_copies=0, status="available"),
            Book(name="Physics Part 1", author="M. Khan", class_id=str(cls.class_id), price="300",
                 total_copies=3, issued_copies=0, status="available"),
        ]
    )
    db.commit()
    print(f"Demo data created for running year {year}. Log in with any *@demo.school account, password {PASSWORD}")
    print("Accounts: admin@, teacher@, student@, parent@, librarian@, accountant@demo.school")


if __name__ == "__main__":
    main()
