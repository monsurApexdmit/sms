"""Library books and book requests."""

from sqlalchemy.orm import Mapped

from app.db.base import Base
from app.models.columns import Int, Txt, num, pk, txt


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
