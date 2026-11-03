"""Accounts: the six legacy login tables (one per role)."""

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Int, Txt, num, pk, txt


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
