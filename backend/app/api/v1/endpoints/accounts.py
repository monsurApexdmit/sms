"""Staff and parent accounts: admins, teachers, parents, librarians, accountants.
Students live in students.py because they also carry enrolment data."""

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, EmailStr, Field, create_model
from sqlalchemy import func, or_, select

from app.api.crud import Page, get_or_404, out_schema
from app.api.deps import DB, CurrentUser, Me, require_roles
from app.core.security import hash_password
from app.models import Accountant, Admin, Librarian, Parent, Student, Teacher
from app.services.accounts import email_taken, insert_account
from app.services.files import safe_path, save_image, user_image_url

SECRET = ("password", "authentication_key")
# Personal fields only admins see; other roles get a directory-style record.
PRIVATE = ("birthday", "sex", "religion", "blood_group", "address", "phone", "profession")


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str | None = Field(default=None, min_length=8, max_length=200)


class AdminIn(AccountIn):
    phone: str | None = None
    address: str | None = None


class TeacherIn(AccountIn):
    phone: str | None = None
    address: str | None = None
    birthday: str | None = None
    sex: str | None = None
    religion: str | None = None
    blood_group: str | None = None
    designation: str | None = None
    about: str | None = None
    social_links: str | None = None
    show_on_website: int | None = 0


class ParentIn(AccountIn):
    phone: str | None = None
    address: str | None = None
    profession: str | None = None


def account_router(
    *, role: str, path: str, model: Any, schema_in: type[AccountIn], read_roles: tuple[str, ...]
) -> APIRouter:
    router = APIRouter(prefix=path, tags=["accounts"])
    pk = f"{role}_id"
    base = out_schema(model, exclude=SECRET)
    out = create_model(f"{model.__name__}AccountOut", __base__=base, image_url=(str | None, None))
    read = [Depends(require_roles(*read_roles))]
    write = [Depends(require_roles("admin"))]

    def to_out(row, viewer: CurrentUser | None = None) -> Any:
        data = base.model_validate(row).model_dump()
        if viewer is not None and viewer.role != "admin":
            data = {k: (None if k in PRIVATE else v) for k, v in data.items()}
        return out(**data, image_url=user_image_url(role, getattr(row, pk)))

    @router.get("", response_model=Page, dependencies=read)
    def list_accounts(
        db: DB,
        viewer: Me,
        q: str | None = None,
        limit: int = Query(500, ge=1, le=2000),
        offset: int = Query(0, ge=0),
    ):
        stmt = select(model)
        if q:
            like = f"%{q}%"
            stmt = stmt.where(or_(model.name.like(like), model.email.like(like)))
        total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        rows = db.scalars(stmt.order_by(model.name).limit(limit).offset(offset)).all()
        return Page(items=[to_out(r, viewer) for r in rows], total=total)

    @router.get("/{obj_id}", response_model=out, dependencies=read)
    def get_account(obj_id: int, db: DB, viewer: Me):
        return to_out(get_or_404(db, model, obj_id, role.title()), viewer)

    @router.post("", response_model=out, status_code=201, dependencies=write)
    def create_account(body: schema_in, db: DB):  # type: ignore[valid-type]
        if not body.password:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Password is required")
        if email_taken(db, body.email):
            raise HTTPException(status.HTTP_409_CONFLICT, "Email is already used by another account")
        row = insert_account(db, model, body.model_dump())
        db.commit()
        db.refresh(row)
        return to_out(row)

    @router.put("/{obj_id}", response_model=out, dependencies=write)
    def update_account(obj_id: int, body: schema_in, db: DB):  # type: ignore[valid-type]
        row = get_or_404(db, model, obj_id, role.title())
        if email_taken(db, body.email, exclude=(role, obj_id)):
            raise HTTPException(status.HTTP_409_CONFLICT, "Email is already used by another account")
        data = body.model_dump(exclude_unset=True)
        password = data.pop("password", None)
        for key, value in data.items():
            setattr(row, key, value)
        if password:
            row.password = hash_password(password)
        db.commit()
        return to_out(row)

    @router.delete("/{obj_id}", status_code=204, dependencies=write)
    def delete_account(obj_id: int, db: DB):
        row = get_or_404(db, model, obj_id, role.title())
        if role == "parent":
            db.query(Student).filter(Student.parent_id == obj_id).update({Student.parent_id: None})
        db.delete(row)
        db.commit()
        safe_path(f"{role}_image/{obj_id}.jpg").unlink(missing_ok=True)

    @router.post("/{obj_id}/photo", response_model=out, dependencies=write)
    async def upload_photo(obj_id: int, db: DB, file: UploadFile = File(...)):
        row = get_or_404(db, model, obj_id, role.title())
        await save_image(file, f"{role}_image/{obj_id}.jpg", max_side=600)
        return to_out(row)

    return router


STAFF = ("admin", "teacher", "accountant", "librarian")
ALL = (*STAFF, "student", "parent")

routers = [
    account_router(role="admin", path="/admins", model=Admin, schema_in=AdminIn, read_roles=("admin",)),
    account_router(role="teacher", path="/teachers", model=Teacher, schema_in=TeacherIn, read_roles=ALL),
    account_router(role="parent", path="/parents", model=Parent, schema_in=ParentIn, read_roles=STAFF),
    account_router(role="librarian", path="/librarians", model=Librarian, schema_in=AccountIn, read_roles=("admin",)),
    account_router(
        role="accountant", path="/accountants", model=Accountant, schema_in=AccountIn, read_roles=("admin",)
    ),
]
