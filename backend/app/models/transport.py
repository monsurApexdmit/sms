"""Transport: drivers, vehicles, stops and student assignments."""

from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Txt, pk, txt

# A legacy `transport` row is a route. It (and `student`) is MyISAM in sms.sql, so
# route_id / student_id below are plain indexed columns, not foreign keys.


class Driver(Base):
    """Driver contact record (not a login account)."""

    __tablename__ = "driver"
    driver_id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    licence_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    licence_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    address: Txt = txt()
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Vehicle(Base):
    __tablename__ = "vehicle"
    vehicle_id: Mapped[int] = pk()
    registration_no: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    route_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    driver_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("driver.driver_id", ondelete="SET NULL"), nullable=True)
    insurance_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    fitness_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Txt = txt()
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class RouteStop(Base):
    __tablename__ = "route_stop"
    stop_id: Mapped[int] = pk()
    route_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # "HH:MM", like the legacy class routine times
    pickup_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    drop_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    # overrides the route's fare when set (text, like transport.route_fare)
    fare: Mapped[str | None] = mapped_column(String(20), nullable=True)


class StudentTransport(Base):
    """A student's stop on their route. `student.transport_id` stays the record of the route itself."""

    __tablename__ = "student_transport"
    student_transport_id: Mapped[int] = pk()
    student_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    route_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    stop_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("route_stop.stop_id", ondelete="SET NULL"), nullable=True)
    pickup: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    drop: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    since: Mapped[date | None] = mapped_column(Date, nullable=True)
