"""Transport: routes (legacy `transport` rows), stops, vehicles, drivers and student assignments.

`student.transport_id` remains the record of a student's route, so the legacy app and the
student screens keep showing it; `student_transport` adds the stop and pickup/drop choice.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.crud import crud_router, get_or_404
from app.api.deps import DB, Me, require_roles
from app.core.config import get_settings
from app.models import Driver, Enroll, Parent, RouteStop, SchoolClass, Section, Student, StudentTransport, Transport, Vehicle
from app.schemas.common import Page
from app.schemas.transport import (
    AssignIn,
    AssignmentRow,
    AssignResult,
    BulkAssignIn,
    Capacity,
    DriverIn,
    ExpiryItem,
    MyTransport,
    MyVehicle,
    Roster,
    RosterStop,
    RouteOut,
    StopIn,
    StopOrder,
    StopOut,
    VehicleIn,
    VehicleOut,
)
from app.services.access import children_ids, ensure_can_view_student
from app.services.settings import running_year

router = APIRouter(prefix="/transport", tags=["transport"])
admin_only = [Depends(require_roles("admin"))]
readers = [Depends(require_roles("admin", "teacher"))]


def _today() -> date:
    return datetime.now(ZoneInfo(get_settings().school_timezone)).date()


def _route(db: Session, route_id: int) -> Transport:
    return get_or_404(db, Transport, route_id, "Route")


# --- drivers ----------------------------------------------------------------------


router.include_router(
    crud_router(
        path="/drivers", model=Driver, schema_in=DriverIn, read_roles=("admin", "teacher"), write_roles=("admin",),
        order_by=Driver.name, label="Driver",
    )  # fmt: skip
)


# --- vehicles ---------------------------------------------------------------------


def _vehicles_out(db: Session, rows: list[Vehicle]) -> list[VehicleOut]:
    routes = dict(db.execute(select(Transport.transport_id, Transport.route_name)).all()) if rows else {}
    drivers = {d.driver_id: d for d in db.scalars(select(Driver).where(Driver.driver_id.in_({r.driver_id for r in rows if r.driver_id})))}
    out = []
    for r in rows:
        driver = drivers.get(r.driver_id)
        out.append(
            VehicleOut(
                vehicle_id=r.vehicle_id, registration_no=r.registration_no, model=r.model, capacity=r.capacity,
                route_id=r.route_id, route_name=routes.get(r.route_id), driver_id=r.driver_id,
                driver_name=driver.name if driver else None, driver_phone=driver.phone if driver else None,
                insurance_expiry=r.insurance_expiry, fitness_expiry=r.fitness_expiry, notes=r.notes, active=r.active,
            )  # fmt: skip
        )
    return out


def _apply_vehicle(db: Session, row: Vehicle, body: VehicleIn) -> None:
    reg = " ".join(body.registration_no.split()).upper()
    clash = db.scalars(select(Vehicle).where(func.upper(Vehicle.registration_no) == reg)).first()
    if clash is not None and clash.vehicle_id != row.vehicle_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "A vehicle with that registration number already exists")
    if body.route_id is not None:
        _route(db, body.route_id)
    if body.driver_id is not None:
        get_or_404(db, Driver, body.driver_id, "Driver")
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    row.registration_no = reg


@router.get("/vehicles", response_model=Page, dependencies=readers)
def list_vehicles(db: DB, route_id: int | None = None):
    stmt = select(Vehicle)
    if route_id:
        stmt = stmt.where(Vehicle.route_id == route_id)
    rows = list(db.scalars(stmt.order_by(Vehicle.registration_no)))
    return Page(items=_vehicles_out(db, rows), total=len(rows))


@router.post("/vehicles", response_model=VehicleOut, status_code=201, dependencies=admin_only)
def create_vehicle(body: VehicleIn, db: DB):
    row = Vehicle()
    _apply_vehicle(db, row, body)
    db.add(row)
    db.commit()
    return _vehicles_out(db, [row])[0]


@router.put("/vehicles/{vehicle_id}", response_model=VehicleOut, dependencies=admin_only)
def update_vehicle(vehicle_id: int, body: VehicleIn, db: DB):
    row = get_or_404(db, Vehicle, vehicle_id, "Vehicle")
    _apply_vehicle(db, row, body)
    db.commit()
    return _vehicles_out(db, [row])[0]


@router.delete("/vehicles/{vehicle_id}", status_code=204, dependencies=admin_only)
def delete_vehicle(vehicle_id: int, db: DB):
    db.delete(get_or_404(db, Vehicle, vehicle_id, "Vehicle"))
    db.commit()


# --- routes and stops --------------------------------------------------------------


def _stops(db: Session, route_id: int) -> list[RouteStop]:
    return list(db.scalars(select(RouteStop).where(RouteStop.route_id == route_id).order_by(RouteStop.sequence, RouteStop.stop_id)))


def _capacity(db: Session, route_id: int) -> Capacity:
    """Assigned students against the seats of the route's active vehicles."""
    assigned = db.scalar(select(func.count()).select_from(Student).where(Student.transport_id == route_id)) or 0
    seats = db.scalar(
        select(func.coalesce(func.sum(Vehicle.capacity), 0)).where(Vehicle.route_id == route_id, Vehicle.active.is_(True))
    ) or 0  # fmt: skip
    return Capacity(assigned=assigned, capacity=seats, over_capacity=assigned > seats)


@router.get("/routes", response_model=list[RouteOut], dependencies=readers)
def list_routes(db: DB):
    out = []
    for route in db.scalars(select(Transport).order_by(Transport.route_name)):
        vehicles = list(db.scalars(select(Vehicle).where(Vehicle.route_id == route.transport_id).order_by(Vehicle.registration_no)))
        out.append(
            RouteOut(
                transport_id=route.transport_id, route_name=route.route_name, route_fare=route.route_fare,
                description=route.description, stops=[StopOut.model_validate(s, from_attributes=True) for s in _stops(db, route.transport_id)],
                vehicles=_vehicles_out(db, vehicles), **_capacity(db, route.transport_id).model_dump(),
            )  # fmt: skip
        )
    return out


@router.post("/routes/{route_id}/stops", response_model=StopOut, status_code=201, dependencies=admin_only)
def create_stop(route_id: int, body: StopIn, db: DB):
    _route(db, route_id)
    last = db.scalar(select(func.max(RouteStop.sequence)).where(RouteStop.route_id == route_id))
    row = RouteStop(route_id=route_id, sequence=(last or 0) + 1, **body.model_dump())
    db.add(row)
    db.commit()
    return row


@router.put("/stops/{stop_id}", response_model=StopOut, dependencies=admin_only)
def update_stop(stop_id: int, body: StopIn, db: DB):
    row = get_or_404(db, RouteStop, stop_id, "Stop")
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    db.commit()
    return row


@router.delete("/stops/{stop_id}", status_code=204, dependencies=admin_only)
def delete_stop(stop_id: int, db: DB):
    row = get_or_404(db, RouteStop, stop_id, "Stop")
    for st in db.scalars(select(StudentTransport).where(StudentTransport.stop_id == stop_id)):
        st.stop_id = None
    db.delete(row)
    db.commit()


@router.put("/routes/{route_id}/stop-order", response_model=list[StopOut], dependencies=admin_only)
def reorder_stops(route_id: int, body: StopOrder, db: DB):
    _route(db, route_id)
    stops = {s.stop_id: s for s in _stops(db, route_id)}
    if sorted(body.stop_ids) != sorted(stops):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "stop_ids must list every stop of the route exactly once")
    for seq, stop_id in enumerate(body.stop_ids, start=1):
        stops[stop_id].sequence = seq
    db.commit()
    return _stops(db, route_id)


# --- assignments ------------------------------------------------------------------


def _assign(db: Session, student: Student, body: AssignIn) -> None:
    _route(db, body.route_id)
    if body.stop_id is not None:
        stop = db.get(RouteStop, body.stop_id)
        if stop is None or stop.route_id != body.route_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The stop is not on that route")
    row = db.scalars(select(StudentTransport).where(StudentTransport.student_id == student.student_id)).first()
    if row is None:
        row = StudentTransport(student_id=student.student_id)
        db.add(row)
    row.route_id, row.stop_id, row.pickup, row.drop = body.route_id, body.stop_id, body.pickup, body.drop
    row.since = body.since or row.since or _today()
    student.transport_id = body.route_id


def _rows(db: Session, students: list[Student]) -> list[AssignmentRow]:
    """Assignment view of students. A student_transport row only counts while it matches student.transport_id
    (the route may have been changed on the student form since)."""
    ids = [s.student_id for s in students]
    if not ids:
        return []
    year = running_year(db)
    enrolls = {
        e.student_id: e
        for e in db.scalars(select(Enroll).where(Enroll.student_id.in_(ids), Enroll.year == year).order_by(Enroll.enroll_id))
    }
    classes = dict(db.execute(select(SchoolClass.class_id, SchoolClass.name)).all())
    sections = dict(db.execute(select(Section.section_id, Section.name)).all())
    links = {t.student_id: t for t in db.scalars(select(StudentTransport).where(StudentTransport.student_id.in_(ids)))}
    stop_ids = {t.stop_id for t in links.values() if t.stop_id}
    stops = {s.stop_id: s for s in db.scalars(select(RouteStop).where(RouteStop.stop_id.in_(stop_ids)))} if stop_ids else {}
    routes = dict(db.execute(select(Transport.transport_id, Transport.route_name)).all())
    parent_ids = {s.parent_id for s in students if s.parent_id}
    phones = dict(db.execute(select(Parent.parent_id, Parent.phone).where(Parent.parent_id.in_(parent_ids))).all()) if parent_ids else {}
    out = []
    for s in students:
        enroll = enrolls.get(s.student_id)
        link = links.get(s.student_id)
        if link is not None and link.route_id != s.transport_id:
            link = None
        stop = stops.get(link.stop_id) if link and link.stop_id else None
        out.append(
            AssignmentRow(
                student_id=s.student_id, name=s.name, roll=enroll.roll if enroll else None,
                class_name=classes.get(enroll.class_id) if enroll else None,
                section_name=sections.get(enroll.section_id) if enroll else None,
                route_id=s.transport_id or None, route_name=routes.get(s.transport_id),
                stop_id=stop.stop_id if stop else None, stop_name=stop.name if stop else None,
                pickup=link.pickup if link else True, drop=link.drop if link else True,
                parent_phone=phones.get(s.parent_id),
            )  # fmt: skip
        )
    return out


def _class_students(db: Session, class_id: int, section_id: int | None) -> list[Student]:
    stmt = (
        select(Student)
        .join(Enroll, Enroll.student_id == Student.student_id)
        .where(Enroll.class_id == class_id, Enroll.year == running_year(db))
        .order_by(Enroll.roll, Student.name)
    )
    if section_id:
        stmt = stmt.where(Enroll.section_id == section_id)
    return list(db.scalars(stmt).unique())


@router.get("/assignments", response_model=list[AssignmentRow], dependencies=readers)
def list_assignments(db: DB, class_id: int, section_id: int | None = None):
    """Students of a class (and section) this year, with their route and stop."""
    return _rows(db, _class_students(db, class_id, section_id))


@router.put("/assignments/{student_id}", response_model=AssignResult, dependencies=admin_only)
def assign_student(student_id: int, body: AssignIn, db: DB):
    _assign(db, get_or_404(db, Student, student_id, "Student"), body)
    db.commit()
    return AssignResult(assigned=1, capacity=_capacity(db, body.route_id))


@router.post("/assignments/bulk", response_model=AssignResult, dependencies=admin_only)
def assign_bulk(body: BulkAssignIn, db: DB):
    if body.student_ids:
        students = list(db.scalars(select(Student).where(Student.student_id.in_(body.student_ids))))
        if len(students) != len(set(body.student_ids)):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Some students were not found")
    else:
        students = _class_students(db, body.class_id, body.section_id)  # type: ignore[arg-type]
    for student in students:
        _assign(db, student, body)
    db.commit()
    return AssignResult(assigned=len(students), capacity=_capacity(db, body.route_id))


@router.delete("/assignments/{student_id}", status_code=204, dependencies=admin_only)
def unassign_student(student_id: int, db: DB):
    student = get_or_404(db, Student, student_id, "Student")
    for row in db.scalars(select(StudentTransport).where(StudentTransport.student_id == student_id)):
        db.delete(row)
    student.transport_id = None
    db.commit()


# --- roster -----------------------------------------------------------------------


@router.get("/routes/{route_id}/roster", response_model=Roster, dependencies=readers)
def route_roster(route_id: int, db: DB):
    """Students on the route grouped by stop in route order; students without a stop come last."""
    route = _route(db, route_id)
    rows = _rows(db, list(db.scalars(select(Student).where(Student.transport_id == route_id).order_by(Student.name))))
    stops = _stops(db, route_id)
    groups = [
        RosterStop(stop=StopOut.model_validate(s, from_attributes=True), students=[r for r in rows if r.stop_id == s.stop_id])
        for s in stops
    ]
    no_stop = [r for r in rows if r.stop_id is None]
    if no_stop:
        groups.append(RosterStop(stop=None, students=no_stop))
    vehicles = list(db.scalars(select(Vehicle).where(Vehicle.route_id == route_id).order_by(Vehicle.registration_no)))
    return Roster(
        transport_id=route.transport_id, route_name=route.route_name, vehicles=_vehicles_out(db, vehicles), stops=groups,
        **_capacity(db, route_id).model_dump(),
    )  # fmt: skip


# --- expiring documents -------------------------------------------------------------


@router.get("/expiring", response_model=list[ExpiryItem], dependencies=admin_only)
def expiring_documents(db: DB, days: int = Query(30, ge=0, le=365)):
    """Vehicle insurance/fitness and driver licences that expire within `days` days or have already expired."""
    today = _today()
    limit = date.fromordinal(today.toordinal() + days)
    items: list[ExpiryItem] = []
    for v in db.scalars(select(Vehicle).where(Vehicle.active.is_(True))):
        for kind, when in (("insurance", v.insurance_expiry), ("fitness", v.fitness_expiry)):
            if when and when <= limit:
                items.append(ExpiryItem(kind=kind, label=v.registration_no, item_id=v.vehicle_id, expires_on=when, days_left=(when - today).days))
    for d in db.scalars(select(Driver).where(Driver.active.is_(True), Driver.licence_expiry <= limit)):
        items.append(
            ExpiryItem(kind="licence", label=d.name, item_id=d.driver_id, expires_on=d.licence_expiry, days_left=(d.licence_expiry - today).days)
        )
    return sorted(items, key=lambda i: (i.expires_on, i.kind, i.label))


# --- my transport -------------------------------------------------------------------


@router.get("/mine", response_model=MyTransport)
def my_transport(user: Me, db: DB, student_id: int | None = None):
    """Route, stop, times, vehicles and driver contact for the student, a parent's child, or (staff) any student."""
    if student_id is None:
        if user.role != "student":
            if user.role == "parent" and len(kids := children_ids(db, user.id)) == 1:
                student_id = kids[0]
            else:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "student_id is required")
        else:
            student_id = user.id
    ensure_can_view_student(db, user, student_id)
    student = get_or_404(db, Student, student_id, "Student")
    route = db.get(Transport, student.transport_id) if student.transport_id else None
    link = db.scalars(select(StudentTransport).where(StudentTransport.student_id == student_id)).first()
    if link is not None and (route is None or link.route_id != route.transport_id):
        link = None
    stop = db.get(RouteStop, link.stop_id) if link and link.stop_id else None
    vehicles = []
    if route is not None:
        rows = db.scalars(select(Vehicle).where(Vehicle.route_id == route.transport_id, Vehicle.active.is_(True)).order_by(Vehicle.registration_no))
        vehicles = [MyVehicle(registration_no=v.registration_no, model=v.model, driver_name=v.driver_name, driver_phone=v.driver_phone) for v in _vehicles_out(db, list(rows))]
    return MyTransport(
        student_id=student.student_id, student_name=student.name,
        route_id=route.transport_id if route else None, route_name=route.route_name if route else None,
        route_description=route.description if route else None,
        stop=StopOut.model_validate(stop, from_attributes=True) if stop else None,
        pickup=link.pickup if link else True, drop=link.drop if link else True,
        fare=(stop.fare if stop and stop.fare else route.route_fare if route else None),
        since=link.since if link else None, vehicles=vehicles,
    )  # fmt: skip
