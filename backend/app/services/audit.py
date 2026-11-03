"""Audit trail for marks, attendance, money, enrolments, accounts and settings.

A flush hook records every insert, update and delete of the tables in AUDITED, with
the changed values, into `audit_log` in the same transaction as the change. The
signed-in user is taken from `session.info["actor"]`, which get_current_user sets.
Passwords and secret settings are recorded as changed but never with their values.
"""

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.services import settings as settings_service

AUDITED: tuple[type, ...] = (
    models.Admin, models.Teacher, models.Student, models.Parent, models.Librarian, models.Accountant,
    models.Enroll, models.Exam, models.Grade, models.Mark, models.OnlineExamResult, models.Attendance,
    models.Invoice, models.Payment, models.Setting, models.FrontendGeneralSetting,
    models.AdmissionApplication, models.AdmissionDocument, models.Enquiry,
)  # fmt: skip

SENSITIVE_COLUMNS = {"password", "authentication_key"}
# Settings rows whose value is a credential (or a JSON blob holding one).
SECRET_SETTINGS = settings_service.SECRET_KEYS | {"paypal", "stripe_keys", "payumoney_merchant_key", "recaptcha_secret_key"}
HIDDEN = "[hidden]"


def _hide(obj: Any, column: str) -> bool:
    if column in SENSITIVE_COLUMNS:
        return True
    return isinstance(obj, models.Setting | models.FrontendGeneralSetting) and column == "description" and obj.type in SECRET_SETTINGS


def _value(obj: Any, column: str, value: Any) -> Any:
    if value is None:
        return None
    return HIDDEN if _hide(obj, column) else value


def _changes(obj: Any, action: str) -> dict[str, Any]:
    state = inspect(obj)
    out: dict[str, Any] = {}
    for attr in state.mapper.column_attrs:
        key = attr.key
        if action == "update":
            hist = state.attrs[key].history
            if not hist.added and not hist.deleted:
                continue
            old = hist.deleted[0] if hist.deleted else None
            new = hist.added[0] if hist.added else None
            if old == new:
                continue
            out[key] = [_value(obj, key, old), _value(obj, key, new)]
        else:
            value = state.attrs[key].value
            if value is not None:
                out[key] = _value(obj, key, value)
    return out


def _after_flush(session: Session, _flush_context) -> None:
    rows = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    actor = session.info.get("actor")
    for action, objects in (("insert", session.new), ("update", session.dirty), ("delete", session.deleted)):
        for obj in objects:
            if not isinstance(obj, AUDITED):
                continue
            changes = _changes(obj, action)
            if action == "update" and not changes:
                continue
            mapper = inspect(obj).mapper
            row_id = ",".join(str(v) for v in mapper.primary_key_from_instance(obj))
            rows.append(
                {
                    "created_at": now,
                    "actor": actor,
                    "action": action,
                    "table_name": mapper.local_table.name,
                    "row_id": row_id,
                    "changes": json.dumps(changes, default=str, ensure_ascii=False),
                }
            )
    if rows:
        session.connection().execute(models.AuditLog.__table__.insert(), rows)


def install(factory: sessionmaker) -> None:
    if not event.contains(factory, "after_flush", _after_flush):
        event.listen(factory, "after_flush", _after_flush)
