"""Request and response models for app/api/v1/endpoints/transport.py."""

from datetime import date

from pydantic import BaseModel, Field, model_validator

HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
MONEY = r"^\d{1,8}(\.\d{1,2})?$"


class DriverIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    phone: str | None = Field(default=None, max_length=50)
    licence_no: str | None = Field(default=None, max_length=50)
    licence_expiry: date | None = None
    address: str | None = Field(default=None, max_length=1000)
    active: bool = True


class VehicleIn(BaseModel):
    registration_no: str = Field(min_length=1, max_length=50)
    model: str | None = Field(default=None, max_length=100)
    capacity: int = Field(default=0, ge=0, le=500)
    route_id: int | None = None
    driver_id: int | None = None
    insurance_expiry: date | None = None
    fitness_expiry: date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    active: bool = True


class VehicleOut(BaseModel):
    vehicle_id: int
    registration_no: str
    model: str | None
    capacity: int
    route_id: int | None
    route_name: str | None = None
    driver_id: int | None
    driver_name: str | None = None
    driver_phone: str | None = None
    insurance_expiry: date | None
    fitness_expiry: date | None
    notes: str | None
    active: bool


class StopIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    pickup_time: str | None = Field(default=None, pattern=HHMM)
    drop_time: str | None = Field(default=None, pattern=HHMM)
    fare: str | None = Field(default=None, pattern=MONEY)


class StopOut(BaseModel):
    stop_id: int
    route_id: int
    name: str
    sequence: int
    pickup_time: str | None
    drop_time: str | None
    fare: str | None


class StopOrder(BaseModel):
    stop_ids: list[int] = Field(max_length=500)


class Capacity(BaseModel):
    assigned: int
    capacity: int
    over_capacity: bool


class RouteOut(Capacity):
    transport_id: int
    route_name: str | None
    route_fare: str | None
    description: str | None
    stops: list[StopOut]
    vehicles: list[VehicleOut]


class AssignIn(BaseModel):
    route_id: int
    stop_id: int | None = None
    pickup: bool = True
    drop: bool = True
    since: date | None = None


class BulkAssignIn(AssignIn):
    student_ids: list[int] | None = Field(default=None, max_length=1000)
    class_id: int | None = None
    section_id: int | None = None

    @model_validator(mode="after")
    def check_target(self):
        if not self.student_ids and not self.class_id:
            raise ValueError("Give student_ids or a class_id")
        return self


class AssignmentRow(BaseModel):
    student_id: int
    name: str | None
    roll: int | None = None
    class_name: str | None = None
    section_name: str | None = None
    route_id: int | None
    route_name: str | None = None
    stop_id: int | None = None
    stop_name: str | None = None
    pickup: bool = True
    drop: bool = True
    parent_phone: str | None = None


class AssignResult(BaseModel):
    assigned: int
    capacity: Capacity


class RosterStop(BaseModel):
    stop: StopOut | None
    students: list[AssignmentRow]


class Roster(Capacity):
    transport_id: int
    route_name: str | None
    vehicles: list[VehicleOut]
    stops: list[RosterStop]


class ExpiryItem(BaseModel):
    kind: str  # insurance | fitness | licence
    label: str
    item_id: int
    expires_on: date
    days_left: int


class MyVehicle(BaseModel):
    registration_no: str
    model: str | None
    driver_name: str | None
    driver_phone: str | None


class MyTransport(BaseModel):
    student_id: int
    student_name: str | None
    route_id: int | None
    route_name: str | None
    route_description: str | None
    stop: StopOut | None
    pickup: bool
    drop: bool
    fare: str | None
    since: date | None
    vehicles: list[MyVehicle]
