"""Column helpers shared by the model modules."""

from sqlalchemy import Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

Txt = Mapped[str | None]
Int = Mapped[int | None]


def pk() -> Mapped[int]:
    return mapped_column(Integer, primary_key=True, autoincrement=True)


def txt() -> Txt:
    return mapped_column(Text, nullable=True)


def num() -> Int:
    return mapped_column(Integer, nullable=True)
