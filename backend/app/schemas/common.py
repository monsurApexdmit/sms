"""Shared response models: the paged list wrapper and models generated from tables."""

from collections.abc import Iterable
from typing import Any

from pydantic import BaseModel, ConfigDict, create_model

from app.db.base import Base


class Page(BaseModel):
    items: list[Any]
    total: int


_out_cache: dict[type, type[BaseModel]] = {}


def out_schema(model: type[Base], exclude: Iterable[str] = ()) -> type[BaseModel]:
    """Pydantic response model mirroring every column of a table."""
    key = model
    if key in _out_cache and not exclude:
        return _out_cache[key]
    fields: dict[str, Any] = {}
    for col in model.__table__.columns:
        if col.name in exclude:
            continue
        try:
            py = col.type.python_type
        except NotImplementedError:
            py = str
        fields[col.name] = (py | None, None)
    schema = create_model(f"{model.__name__}Out", __config__=ConfigDict(from_attributes=True), **fields)
    if not exclude:
        _out_cache[key] = schema
    return schema
