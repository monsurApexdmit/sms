"""Leave lookups used outside the leave screens (attendance)."""

from collections.abc import Iterable
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import LeaveRequest


def students_on_leave(db: Session, student_ids: Iterable[int], day: date) -> set[int]:
    """Students among `student_ids` with approved leave covering `day`."""
    ids = list(student_ids)
    if not ids:
        return set()
    return set(
        db.scalars(
            select(LeaveRequest.student_id).where(
                LeaveRequest.student_id.in_(ids),
                LeaveRequest.status == "approved",
                LeaveRequest.from_date <= day,
                LeaveRequest.to_date >= day,
            )
        )
    )
