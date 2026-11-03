from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.api.crud import crud_router, get_or_404
from app.api.deps import DB, CurrentUser, Me, require_roles
from app.models import Book, BookRequest, Dormitory, Student, Transport
from app.schemas.common import Page
from app.schemas.library import BookIn, BookRequestIn, BookRequestOut, BookRequestStatus, DormitoryIn, RequestBase, TransportIn

router = APIRouter(tags=["library & facilities"])
ALL = ("admin", "teacher", "accountant", "librarian", "student", "parent")
LIB = ("admin", "librarian")


for sub in (
    crud_router(path="/books", model=Book, schema_in=BookIn, read_roles=ALL, write_roles=LIB,
                filters=("class_id",), order_by=Book.name, label="Book"),
    crud_router(path="/transports", model=Transport, schema_in=TransportIn, read_roles=ALL,
                write_roles=("admin",), order_by=Transport.route_name, label="Transport"),
    crud_router(path="/dormitories", model=Dormitory, schema_in=DormitoryIn, read_roles=ALL,
                write_roles=("admin",), order_by=Dormitory.name, label="Dormitory"),
):  # fmt: skip
    router.include_router(sub)


def _requests_out(db, rows) -> list[BookRequestOut]:
    books = dict(db.execute(select(Book.book_id, Book.name)).all())
    students = dict(db.execute(select(Student.student_id, Student.name)).all())
    return [
        BookRequestOut(
            **RequestBase.model_validate(r).model_dump(),
            book_name=books.get(r.book_id),
            student_name=students.get(r.student_id),
        )
        for r in rows
    ]


@router.get("/book-requests", response_model=Page)
def list_requests(user: Me, db: DB):
    stmt = select(BookRequest)
    if user.role == "student":
        stmt = stmt.where(BookRequest.student_id == user.id)
    elif user.role not in LIB:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
    rows = list(db.scalars(stmt.order_by(BookRequest.book_request_id.desc())))
    return Page(items=_requests_out(db, rows), total=len(rows))


@router.post("/book-requests", response_model=BookRequestOut, status_code=201)
def create_request(body: BookRequestIn, db: DB, user: CurrentUser = Depends(require_roles("student"))):
    book = get_or_404(db, Book, body.book_id, "Book")
    if (book.total_copies or 0) - (book.issued_copies or 0) <= 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "No copies available")
    if body.issue_end_date < body.issue_start_date:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "End date is before start date")
    row = BookRequest(
        book_id=body.book_id,
        student_id=user.id,
        issue_start_date=body.issue_start_date,
        issue_end_date=body.issue_end_date,
        status=0,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _requests_out(db, [row])[0]


@router.put("/book-requests/{request_id}/status", response_model=BookRequestOut, dependencies=[Depends(require_roles(*LIB))])
def set_request_status(request_id: int, body: BookRequestStatus, db: DB):
    row = get_or_404(db, BookRequest, request_id, "Book request")
    if row.status not in (0, None):
        raise HTTPException(status.HTTP_409_CONFLICT, "Request is already processed")
    if body.status == 1:
        book = get_or_404(db, Book, row.book_id, "Book")
        if (book.total_copies or 0) - (book.issued_copies or 0) <= 0:
            raise HTTPException(status.HTTP_409_CONFLICT, "No copies available")
        book.issued_copies = (book.issued_copies or 0) + 1
    row.status = body.status
    db.commit()
    return _requests_out(db, [row])[0]


@router.post("/book-requests/{request_id}/return", response_model=BookRequestOut, dependencies=[Depends(require_roles(*LIB))])
def return_book(request_id: int, db: DB):
    """Free a copy once an issued book is returned (not in the legacy app)."""
    row = get_or_404(db, BookRequest, request_id, "Book request")
    if row.status != 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "Book is not issued")
    book = db.get(Book, row.book_id)
    if book is not None and (book.issued_copies or 0) > 0:
        book.issued_copies -= 1
    row.status = 3  # returned
    db.commit()
    return _requests_out(db, [row])[0]
