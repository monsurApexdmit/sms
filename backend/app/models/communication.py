"""Noticeboard and messages."""

from sqlalchemy import Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Int, Txt, num, pk, txt


class Noticeboard(Base):
    __tablename__ = "noticeboard"
    notice_id: Mapped[int] = pk()
    notice_title: Txt = txt()
    notice: Txt = txt()
    create_timestamp: Txt = txt()
    status: Int = mapped_column(Integer, nullable=True, default=1)
    show_on_website: Int = mapped_column(Integer, nullable=True, default=0)
    image: Txt = txt()


class MessageThread(Base):
    __tablename__ = "message_thread"
    message_thread_id: Mapped[int] = pk()
    message_thread_code: Txt = txt()
    sender: Txt = txt()  # "role-id"
    reciever: Txt = txt()  # "role-id" (legacy spelling)
    last_message_timestamp: Txt = txt()


class Message(Base):
    __tablename__ = "message"
    message_id: Mapped[int] = pk()
    message_thread_code: Txt = txt()
    message: Txt = txt()
    sender: Txt = txt()
    timestamp: Txt = txt()
    read_status: Int = num()
    attached_file_name: Txt = txt()


class GroupMessageThread(Base):
    __tablename__ = "group_message_thread"
    group_message_thread_id: Mapped[int] = pk()
    group_message_thread_code: Txt = txt()
    members: Txt = txt()  # JSON list of "role_id" (underscore, legacy format)
    group_name: Txt = txt()
    last_message_timestamp: Txt = txt()
    created_timestamp: Txt = txt()


class GroupMessage(Base):
    __tablename__ = "group_message"
    group_message_id: Mapped[int] = pk()
    group_message_thread_code: Txt = txt()
    sender: Txt = txt()
    message: Txt = txt()
    timestamp: Txt = txt()
    read_status: Int = num()
    attached_file_name: Txt = txt()
