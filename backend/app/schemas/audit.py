"""Request and response models for app/api/v1/endpoints/audit.py."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class AuditOut(BaseModel):
    audit_id: int
    created_at: datetime
    actor: str | None
    actor_name: str | None
    action: str
    table_name: str
    row_id: str
    changes: dict[str, Any]
