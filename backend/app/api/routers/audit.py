import json
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.crud import Page
from app.core.deps import DB, require_roles
from app.models import AuditLog
from app.services.accounts import get_account

router = APIRouter(prefix="/audit-log", tags=["audit"], dependencies=[Depends(require_roles("admin"))])


class AuditOut(BaseModel):
    audit_id: int
    created_at: datetime
    actor: str | None
    actor_name: str | None
    action: str
    table_name: str
    row_id: str
    changes: dict[str, Any]


def _actor_name(db: Session, actor: str) -> str | None:
    role, _, raw_id = actor.partition("-")
    row = get_account(db, role, int(raw_id)) if raw_id.isdigit() else None
    return row.name if row is not None else None


@router.get("", response_model=Page)
def list_audit_log(
    db: DB,
    table_name: str | None = None,
    row_id: str | None = None,
    actor: str | None = None,
    action: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    stmt = select(AuditLog)
    for column, value in (
        (AuditLog.table_name, table_name), (AuditLog.row_id, row_id), (AuditLog.actor, actor), (AuditLog.action, action),
    ):  # fmt: skip
        if value:
            stmt = stmt.where(column == value)
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= datetime.combine(date_from, time.min))
    if date_to:
        stmt = stmt.where(AuditLog.created_at < datetime.combine(date_to + timedelta(days=1), time.min))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(db.scalars(stmt.order_by(AuditLog.audit_id.desc()).limit(limit).offset(offset)))
    names = {actor: _actor_name(db, actor) for actor in {r.actor for r in rows if r.actor}}
    items = [
        AuditOut(
            # stored as naive UTC
            audit_id=r.audit_id, created_at=r.created_at.replace(tzinfo=timezone.utc), actor=r.actor, actor_name=names.get(r.actor or ""),
            action=r.action, table_name=r.table_name, row_id=r.row_id, changes=json.loads(r.changes or "{}"),
        )  # fmt: skip
        for r in rows
    ]
    return Page(items=items, total=total)


@router.get("/tables", response_model=list[str])
def audited_tables(db: DB):
    return list(db.scalars(select(AuditLog.table_name).distinct().order_by(AuditLog.table_name)))
