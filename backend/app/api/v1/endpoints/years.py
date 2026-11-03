"""Academic years and terms."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select

from app.api.crud import crud_router, get_or_404
from app.api.deps import DB, require_roles
from app.models import AcademicYear, Term
from app.services.years import set_current_year, valid_year_name

STAFF = ("admin", "teacher", "accountant", "librarian")
ALL = (*STAFF, "student", "parent")
admin_only = [Depends(require_roles("admin"))]

router = APIRouter(tags=["academic years"])


class DateRange(BaseModel):
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode="after")
    def check_order(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must not be before start_date")
        return self


class YearIn(DateRange):
    name: str = Field(min_length=9, max_length=9, description='e.g. "2025-2026"')


class YearOut(BaseModel):
    academic_year_id: int
    name: str
    start_date: date | None
    end_date: date | None
    is_current: bool
    terms: list[dict]


class TermIn(DateRange):
    academic_year_id: int
    name: str = Field(min_length=1, max_length=100)


def _year_out(db: DB, row: AcademicYear) -> YearOut:
    terms = db.scalars(select(Term).where(Term.academic_year_id == row.academic_year_id).order_by(Term.start_date, Term.term_id))
    return YearOut(
        academic_year_id=row.academic_year_id, name=row.name, start_date=row.start_date, end_date=row.end_date,
        is_current=row.is_current,
        terms=[{"term_id": t.term_id, "name": t.name, "start_date": t.start_date, "end_date": t.end_date} for t in terms],
    )  # fmt: skip


def _check_name(db: DB, name: str, own_id: int | None = None) -> None:
    if not valid_year_name(name):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Year must look like 2025-2026")
    other = db.scalars(select(AcademicYear).where(AcademicYear.name == name)).first()
    if other is not None and other.academic_year_id != own_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "That academic year already exists")


@router.get("/school-years", response_model=list[YearOut], dependencies=[Depends(require_roles(*ALL))])
def list_years(db: DB):
    return [_year_out(db, r) for r in db.scalars(select(AcademicYear).order_by(AcademicYear.name.desc()))]


@router.post("/school-years", response_model=YearOut, status_code=201, dependencies=admin_only)
def create_year(body: YearIn, db: DB):
    _check_name(db, body.name)
    row = AcademicYear(name=body.name, start_date=body.start_date, end_date=body.end_date, is_current=False)
    db.add(row)
    db.commit()
    return _year_out(db, row)


@router.put("/school-years/{year_id}", response_model=YearOut, dependencies=admin_only)
def update_year(year_id: int, body: DateRange, db: DB):
    """Dates only: the name is stored as text on legacy rows (enrolments, exams, invoices), so it cannot change."""
    row = get_or_404(db, AcademicYear, year_id, "Academic year")
    row.start_date, row.end_date = body.start_date, body.end_date
    db.commit()
    return _year_out(db, row)


@router.post("/school-years/{year_id}/make-current", response_model=YearOut, dependencies=admin_only)
def make_current(year_id: int, db: DB):
    row = get_or_404(db, AcademicYear, year_id, "Academic year")
    set_current_year(db, row.name)
    db.commit()
    return _year_out(db, row)


@router.delete("/school-years/{year_id}", status_code=204, dependencies=admin_only)
def delete_year(year_id: int, db: DB):
    row = get_or_404(db, AcademicYear, year_id, "Academic year")
    if row.is_current:
        raise HTTPException(status.HTTP_409_CONFLICT, "The current academic year cannot be deleted")
    db.delete(row)
    db.commit()


router.include_router(
    crud_router(
        path="/terms", model=Term, schema_in=TermIn, read_roles=ALL, write_roles=("admin",),
        filters=("academic_year_id",), order_by=(Term.start_date, Term.term_id), label="Term",
    )  # fmt: skip
)
