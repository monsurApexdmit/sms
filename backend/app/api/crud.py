"""Generic list/get/create/update/delete router for simple tables.

Every route carries its role dependency at registration time, so an endpoint
cannot be added without an access rule (the legacy app checked login inside
each method and missed ~60 of them).
"""

from collections.abc import Callable, Iterable
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import DB, require_roles
from app.db.base import Base
from app.schemas.common import Page, out_schema


def pk_name(model: type[Base]) -> str:
    return next(iter(model.__table__.primary_key.columns)).name


def apply_filters(stmt, model: type[Base], params: dict[str, str], allowed: Iterable[str]):
    for name in allowed:
        raw = params.get(name)
        if raw in (None, ""):
            continue
        col = model.__table__.columns[name]
        try:
            value: Any = col.type.python_type(raw)
        except (ValueError, NotImplementedError):
            value = raw
        stmt = stmt.where(getattr(model, name) == value)
    return stmt


def get_or_404(db: Session, model: type[Base], obj_id: int, label: str = "Record"):
    from app.api.deps import not_found

    obj = db.get(model, obj_id)
    if obj is None:
        raise not_found(label)
    return obj


def crud_router(
    *,
    path: str,
    model: type[Base],
    schema_in: type[BaseModel],
    read_roles: tuple[str, ...],
    write_roles: tuple[str, ...],
    filters: Iterable[str] = (),
    order_by: Any = None,
    defaults: Callable[[Session], dict[str, Any]] | None = None,
    label: str = "Record",
) -> APIRouter:
    router = APIRouter(prefix=path)
    out = out_schema(model)
    pk = pk_name(model)
    filters = tuple(filters)
    order = order_by if order_by is not None else getattr(model, pk).desc()
    order = order if isinstance(order, tuple) else (order,)
    read_dep = [Depends(require_roles(*read_roles))]
    write_dep = [Depends(require_roles(*write_roles))]

    @router.get("", response_model=Page, dependencies=read_dep)
    def list_items(
        request: Request, db: DB, limit: int = Query(200, ge=1, le=2000), offset: int = Query(0, ge=0)
    ):
        stmt = apply_filters(select(model), model, dict(request.query_params), filters)
        total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        rows = db.scalars(stmt.order_by(*order).limit(limit).offset(offset)).all()
        return Page(items=[out.model_validate(r) for r in rows], total=total)

    @router.get("/{obj_id}", response_model=out, dependencies=read_dep)
    def get_item(obj_id: int, db: DB):
        return get_or_404(db, model, obj_id, label)

    @router.post("", response_model=out, status_code=201, dependencies=write_dep)
    def create_item(body: schema_in, db: DB):  # type: ignore[valid-type]
        data = body.model_dump()
        if defaults:
            for key, value in defaults(db).items():
                if data.get(key) in (None, ""):
                    data[key] = value
        obj = model(**data)
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @router.put("/{obj_id}", response_model=out, dependencies=write_dep)
    def update_item(obj_id: int, body: schema_in, db: DB):  # type: ignore[valid-type]
        obj = get_or_404(db, model, obj_id, label)
        for key, value in body.model_dump(exclude_unset=True).items():
            setattr(obj, key, value)
        db.commit()
        db.refresh(obj)
        return obj

    @router.delete("/{obj_id}", status_code=204, dependencies=write_dep)
    def delete_item(obj_id: int, db: DB):
        db.delete(get_or_404(db, model, obj_id, label))
        db.commit()

    return router
