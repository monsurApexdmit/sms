"""Transport routes and dormitories (legacy tables)."""

from sqlalchemy.orm import Mapped

from app.db.base import Base
from app.models.columns import Txt, pk, txt


class Transport(Base):
    __tablename__ = "transport"
    transport_id: Mapped[int] = pk()
    route_name: Txt = txt()
    number_of_vehicle: Txt = txt()
    description: Txt = txt()
    route_fare: Txt = txt()


class Dormitory(Base):
    __tablename__ = "dormitory"
    dormitory_id: Mapped[int] = pk()
    name: Txt = txt()
    number_of_room: Txt = txt()
    description: Txt = txt()
