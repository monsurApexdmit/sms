"""Daily attendance (legacy)."""

from sqlalchemy.orm import Mapped

from app.db.base import Base
from app.models.columns import Int, Txt, num, pk, txt


class Attendance(Base):
    __tablename__ = "attendance"
    attendance_id: Mapped[int] = pk()
    timestamp: Txt = txt()
    year: Txt = txt()
    class_id: Int = num()
    section_id: Int = num()
    student_id: Int = num()
    class_routine_id: Int = num()
    # 0/NULL = not taken, 1 = present, 2 = absent
    status: Int = num()
