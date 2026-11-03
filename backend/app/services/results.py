"""Exam results: grades, GPA, pass/fail, positions, the weighted annual result and
attendance for report cards.

Rules:
- A subject's grade comes from the `grade` table by the raw mark (as the legacy marksheet).
- An exam is "Fail" when any subject's grade point is 0 (including a mark that matches no
  grade); its GPA is then 0. Otherwise it is "Incomplete" while any mark is missing (GPA
  None), else "Pass" with GPA = mean grade point.
- Full marks per subject come from `mark.mark_total`, or 100 when it is empty.
- Positions rank by total (annual: by weighted percentage), highest first; ties share a
  position and the next one is skipped (1, 1, 3).
"""

from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser
from app.models import (
    AcademicYear,
    Attendance,
    Enroll,
    Exam,
    ExamSchedule,
    ExamWeight,
    Grade,
    Mark,
    SchoolClass,
    Section,
    Subject,
    Term,
)
from app.services.school_calendar import working_days

FULL_MARKS = 100


def grade_for(grades: list[Grade], mark: int | None) -> Grade | None:
    if mark is None:
        return None
    for g in grades:
        if (g.mark_from or 0) <= mark <= (g.mark_upto or 0):
            return g
    return None


def grade_point(grade: Grade | None) -> float:
    try:
        return float(grade.grade_point) if grade and grade.grade_point else 0.0
    except ValueError:
        return 0.0


def rank(scores: dict[int, float]) -> dict[int, int]:
    """Competition ranking, highest score first: ties share a position (1, 1, 3)."""
    ordered = sorted(scores.values(), reverse=True)
    first = {}
    for i, score in enumerate(ordered):
        first.setdefault(score, i + 1)
    return {key: first[score] for key, score in scores.items()}


def class_subjects(db: Session, class_id: int) -> list[Subject]:
    return list(db.scalars(select(Subject).where(Subject.class_id == class_id).order_by(Subject.name)))


@dataclass
class SubjectLine:
    subject_id: int
    subject: str | None
    mark_obtained: int | None
    full_marks: int
    grade: str | None
    grade_point: float | None
    comment: str | None


@dataclass
class ExamResult:
    student_id: int
    section_id: int | None
    subjects: list[SubjectLine]
    total: int
    full_total: int
    percentage: float | None
    gpa: float | None
    result: str
    position_class: int = 0
    position_section: int = 0

    def as_dict(self) -> dict:
        return asdict(self)


def exam_results(db: Session, exam_id: int, class_id: int, year: str) -> dict[int, ExamResult]:
    """Result of every student enrolled in the class in `year`, with positions."""
    grades = list(db.scalars(select(Grade)))
    subjects = class_subjects(db, class_id)
    enrolled = db.execute(select(Enroll.student_id, Enroll.section_id).where(Enroll.class_id == class_id, Enroll.year == year)).all()
    marks = {
        (m.student_id, m.subject_id): m
        for m in db.scalars(select(Mark).where(Mark.exam_id == exam_id, Mark.class_id == class_id, Mark.year == year))
    }
    out: dict[int, ExamResult] = {}
    for sid, section_id in enrolled:
        if sid is None or sid in out:
            continue
        lines, failed, missing = [], False, False
        for subj in subjects:
            mark = marks.get((sid, subj.subject_id))
            obtained = mark.mark_obtained if mark else None
            grade = grade_for(grades, obtained)
            gp = grade_point(grade) if obtained is not None else None
            if obtained is None:
                missing = True
            elif gp == 0:
                failed = True
            lines.append(
                SubjectLine(
                    subject_id=subj.subject_id, subject=subj.name, mark_obtained=obtained,
                    full_marks=(mark.mark_total if mark and mark.mark_total else FULL_MARKS),
                    grade=grade.name if grade else None, grade_point=gp, comment=mark.comment if mark else None,
                )  # fmt: skip
            )
        total = sum(line.mark_obtained or 0 for line in lines)
        full_total = sum(line.full_marks for line in lines)
        if failed:
            result, gpa = "Fail", 0.0
        elif missing or not lines:
            result, gpa = "Incomplete", None
        else:
            result, gpa = "Pass", round(sum(line.grade_point or 0 for line in lines) / len(lines), 2)
        out[sid] = ExamResult(
            student_id=sid, section_id=section_id, subjects=lines, total=total, full_total=full_total,
            percentage=round(total * 100 / full_total, 2) if full_total else None, gpa=gpa, result=result,
        )  # fmt: skip
    _set_positions(out, {sid: r.total for sid, r in out.items()})
    return out


def _set_positions(results: dict, scores: dict[int, float]) -> None:
    for sid, pos in rank(scores).items():
        results[sid].position_class = pos
    by_section: dict[int | None, dict[int, float]] = defaultdict(dict)
    for sid, score in scores.items():
        by_section[results[sid].section_id][sid] = score
    for group in by_section.values():
        for sid, pos in rank(group).items():
            results[sid].position_section = pos


# --- annual -----------------------------------------------------------------------


@dataclass
class AnnualResult:
    student_id: int
    section_id: int | None
    exams: list[dict]
    subjects: list[dict]
    percentage: float | None
    cgpa: float | None
    result: str
    position_class: int = 0
    position_section: int = 0
    weights_total: float = 0
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


def year_weights(db: Session, year: str) -> list[tuple[Exam, float | None]]:
    exams = list(db.scalars(select(Exam).where(Exam.year == year).order_by(Exam.exam_id)))
    weights = dict(db.execute(select(ExamWeight.exam_id, ExamWeight.weight).where(ExamWeight.exam_id.in_([e.exam_id for e in exams]))).all()) if exams else {}
    return [(e, weights.get(e.exam_id)) for e in exams]


def weight_warnings(weighted: list[tuple[Exam, float | None]]) -> list[str]:
    total = sum(w or 0 for _, w in weighted)
    if not any(w for _, w in weighted):
        return ["No exam weights are set for this year, so there is no annual result."]
    if abs(total - 100) > 0.01:
        return [f"Exam weights add up to {total:g}%, not 100%. The annual result is scaled to the weights that are set."]
    return []


def annual_results(db: Session, class_id: int, year: str) -> dict[int, AnnualResult]:
    """Weighted percentage and CGPA over the year's weighted exams."""
    weighted = year_weights(db, year)
    used = [(e, w) for e, w in weighted if w]
    warnings = weight_warnings(weighted)
    weight_sum = sum(w for _, w in used)
    per_exam = {e.exam_id: exam_results(db, e.exam_id, class_id, year) for e, _ in used}
    subjects = class_subjects(db, class_id)
    students = {
        sid: section_id
        for sid, section_id in db.execute(select(Enroll.student_id, Enroll.section_id).where(Enroll.class_id == class_id, Enroll.year == year))
        if sid is not None
    }
    out: dict[int, AnnualResult] = {}
    for sid, section_id in students.items():
        exams, pct_sum, gp_sum, failed, incomplete = [], 0.0, 0.0, False, not used
        for exam, w in used:
            r = per_exam[exam.exam_id].get(sid)
            exams.append(
                {
                    "exam_id": exam.exam_id, "name": exam.name, "weight": w,
                    "percentage": r.percentage if r else None, "gpa": r.gpa if r else None,
                    "result": r.result if r else "Incomplete",
                }
            )  # fmt: skip
            if r is None or r.result == "Incomplete":
                incomplete = True
            elif r.result == "Fail":
                failed = True
            pct_sum += w * ((r.percentage or 0) if r else 0)
            gp_sum += w * ((r.gpa or 0) if r else 0)
        subject_rows = []
        for subj in subjects:
            marks, weighted_pct, have_all = {}, 0.0, True
            for exam, w in used:
                r = per_exam[exam.exam_id].get(sid)
                line = next((s for s in r.subjects if s.subject_id == subj.subject_id), None) if r else None
                marks[exam.exam_id] = line.mark_obtained if line else None
                if line is None or line.mark_obtained is None:
                    have_all = False
                else:
                    weighted_pct += w * line.mark_obtained * 100 / line.full_marks
            subject_rows.append(
                {
                    "subject_id": subj.subject_id, "subject": subj.name, "marks": marks,
                    "weighted_percentage": round(weighted_pct / weight_sum, 2) if used and have_all else None,
                }
            )  # fmt: skip
        if failed:
            result, cgpa = "Fail", 0.0
        elif incomplete:
            result, cgpa = "Incomplete", None
        else:
            result, cgpa = "Pass", round(gp_sum / weight_sum, 2)
        out[sid] = AnnualResult(
            student_id=sid, section_id=section_id, exams=exams, subjects=subject_rows,
            percentage=round(pct_sum / weight_sum, 2) if used else None, cgpa=cgpa, result=result,
            weights_total=sum(w or 0 for _, w in weighted), warnings=warnings,
        )  # fmt: skip
    _set_positions(out, {sid: r.percentage or 0 for sid, r in out.items()})
    return out


# --- attendance and people -----------------------------------------------------------


def _ts_day(raw: str | None) -> date | None:
    if not raw or not raw.isdigit():
        return None
    return datetime.fromtimestamp(int(raw), timezone.utc).date()


def attendance_period(db: Session, year: str, exam_id: int | None = None, class_id: int | None = None) -> tuple[date | None, date | None]:
    """The academic year's dates, narrowed to the term the exam's papers fall in when terms have dates."""
    ay = db.scalars(select(AcademicYear).where(AcademicYear.name == year)).first()
    if ay is None:
        return None, None
    start, end = ay.start_date, ay.end_date
    if exam_id is not None:
        stmt = select(ExamSchedule.exam_date).where(ExamSchedule.exam_id == exam_id)
        if class_id is not None:
            stmt = stmt.where(ExamSchedule.class_id == class_id)
        last_paper = max(db.scalars(stmt), default=None)
        if last_paper is not None:
            for term in db.scalars(select(Term).where(Term.academic_year_id == ay.academic_year_id)):
                if term.start_date and term.end_date and term.start_date <= last_paper <= term.end_date:
                    return term.start_date, term.end_date
    return start, end


def attendance_summary(db: Session, student_id: int, year: str, start: date | None, end: date | None) -> dict:
    """Days present against working days in [start, end] (capped at today). Without dates,
    the period runs from the student's first to last recorded attendance day of the year."""
    days: dict[date, int] = {}
    for a in db.scalars(select(Attendance).where(Attendance.student_id == student_id, Attendance.year == year)):
        d = _ts_day(a.timestamp)
        if d is not None:
            days[d] = a.status or 0
    start = start or min(days, default=None)
    end = min(end or max(days, default=date.today()), date.today())
    if start is None or end < start:
        return {"present": 0, "absent": 0, "working_days": 0, "percent": None, "from": None, "to": None}
    in_range = [s for d, s in days.items() if start <= d <= end]
    present = sum(1 for s in in_range if s == 1)
    total = working_days(db, start, end)
    return {
        "present": present,
        "absent": sum(1 for s in in_range if s == 2),
        "working_days": total,
        "percent": round(min(present, total) * 100 / total, 1) if total else None,
        "from": start.isoformat(),
        "to": end.isoformat(),
    }


def teaches_class(db: Session, user: CurrentUser, class_id: int, section_id: int | None = None) -> bool:
    """Admins; the class or section teacher; or a teacher of one of the class's subjects."""
    if user.role == "admin":
        return True
    if user.role != "teacher":
        return False
    cls = db.get(SchoolClass, class_id)
    if cls is not None and cls.teacher_id == user.id:
        return True
    if section_id is not None:
        sec = db.get(Section, section_id)
        if sec is not None and sec.teacher_id == user.id:
            return True
    return db.scalars(select(Subject.subject_id).where(Subject.class_id == class_id, Subject.teacher_id == user.id)).first() is not None
