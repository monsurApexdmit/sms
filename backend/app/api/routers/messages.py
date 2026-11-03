"""Private and group messaging on the legacy tables.

Users are referenced as "role-id" in message/message_thread and as "role_id" in
group_message_thread.members, exactly like the CodeIgniter app."""

import json
import secrets
import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import DB, CurrentUser, Me, forbid, not_found, require_roles
from app.models import GroupMessage, GroupMessageThread, Message, MessageThread
from app.services.accounts import ROLE_MODELS, get_account, id_column, parse_ref, ref_name
from app.services.files import media_url, save_document

router = APIRouter(tags=["messages"])

# Who may start a conversation with whom.
CAN_MESSAGE = {
    "admin": ("admin", "teacher", "student", "parent", "librarian", "accountant"),
    "teacher": ("admin", "teacher", "student", "parent"),
    "student": ("admin", "teacher"),
    "parent": ("admin", "teacher"),
    "librarian": ("admin",),
    "accountant": ("admin",),
}


class Contact(BaseModel):
    ref: str
    role: str
    name: str


class MessageOut(BaseModel):
    message_id: int
    sender: str | None
    sender_name: str
    message: str | None
    timestamp: str | None
    read_status: int | None = None
    attachment_name: str | None = None
    attachment_url: str | None = None
    mine: bool


class ThreadOut(BaseModel):
    code: str
    other: str
    other_name: str
    last_message: str | None
    last_timestamp: str | None
    unread: int


class GroupIn(BaseModel):
    group_name: str = Field(min_length=1, max_length=200)
    members: list[str] = Field(default_factory=list)  # "role_id"


class GroupOut(BaseModel):
    code: str
    group_name: str | None
    members: list[str]
    member_names: list[str]
    last_timestamp: str | None


def _now() -> str:
    return str(int(time.time()))


def _attachment_label(name: str | None) -> str | None:
    # stored as "<random>_<original>"; show the original part
    return name.split("_", 1)[1] if name and "_" in name else name


def _message_out(db: Session, m, me: str, kind: str, names: dict[str, str]) -> MessageOut:
    if m.sender not in names:
        names[m.sender] = ref_name(db, m.sender)
    return MessageOut(
        message_id=getattr(m, "message_id", None) or m.group_message_id,
        sender=m.sender,
        sender_name=names[m.sender],
        message=m.message,
        timestamp=m.timestamp,
        read_status=m.read_status,
        attachment_name=_attachment_label(m.attached_file_name),
        attachment_url=media_url(kind, m.attached_file_name),
        mine=m.sender == me,
    )


@router.get("/messages/contacts", response_model=list[Contact])
def contacts(user: Me, db: DB):
    out = []
    for role in CAN_MESSAGE[user.role]:
        model = ROLE_MODELS[role]
        for uid, name in db.execute(select(id_column(role), model.name).order_by(model.name)):
            if role == user.role and uid == user.id:
                continue
            out.append(Contact(ref=f"{role}-{uid}", role=role, name=name or ""))
    return out


@router.get("/messages/threads", response_model=list[ThreadOut])
def threads(user: Me, db: DB):
    me = user.ref
    rows = db.scalars(select(MessageThread).where(or_(MessageThread.sender == me, MessageThread.reciever == me)))
    out = []
    for t in rows:
        other = t.reciever if t.sender == me else t.sender
        last = db.scalars(
            select(Message).where(Message.message_thread_code == t.message_thread_code).order_by(Message.message_id.desc())
        ).first()
        unread = db.scalar(
            select(func.count()).select_from(Message).where(
                Message.message_thread_code == t.message_thread_code,
                Message.sender != me,
                or_(Message.read_status == 0, Message.read_status.is_(None)),
            )
        )
        out.append(
            ThreadOut(
                code=t.message_thread_code or "",
                other=other or "",
                other_name=ref_name(db, other),
                last_message=last.message if last else None,
                last_timestamp=last.timestamp if last else t.last_message_timestamp,
                unread=unread or 0,
            )
        )
    out.sort(key=lambda t: int(t.last_timestamp or 0), reverse=True)
    return out


@router.get("/messages/unread-count")
def unread_count(user: Me, db: DB):
    me = user.ref
    codes = select(MessageThread.message_thread_code).where(or_(MessageThread.sender == me, MessageThread.reciever == me))
    count = db.scalar(
        select(func.count()).select_from(Message).where(
            Message.message_thread_code.in_(codes),
            Message.sender != me,
            or_(Message.read_status == 0, Message.read_status.is_(None)),
        )
    )
    return {"unread": count or 0}


def _thread_for(db: Session, user: CurrentUser, code: str) -> MessageThread:
    t = db.scalars(select(MessageThread).where(MessageThread.message_thread_code == code)).first()
    if t is None:
        raise not_found("Conversation")
    if user.ref not in (t.sender, t.reciever):
        raise forbid()
    return t


@router.get("/messages/threads/{code}", response_model=list[MessageOut])
def thread_messages(code: str, user: Me, db: DB):
    _thread_for(db, user, code)
    me = user.ref
    msgs = list(db.scalars(select(Message).where(Message.message_thread_code == code).order_by(Message.message_id)))
    for m in msgs:
        if m.sender != me and not m.read_status:
            m.read_status = 1
    db.commit()
    names: dict[str, str] = {}
    return [_message_out(db, m, me, "message", names) for m in msgs]


async def _attachment(file: UploadFile | None, kind: str) -> str | None:
    if file is None or not file.filename:
        return None
    return await save_document(file, kind)


@router.post("/messages", response_model=list[MessageOut], status_code=201)
async def send_new(
    user: Me,
    db: DB,
    receiver: str = Form(...),
    message: str = Form(..., min_length=1, max_length=5000),
    file: UploadFile | None = File(None),
):
    parsed = parse_ref(receiver)
    if parsed is None or get_account(db, *parsed) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown receiver")
    if parsed[0] not in CAN_MESSAGE[user.role] or receiver == user.ref:
        raise forbid()
    me = user.ref
    t = db.scalars(
        select(MessageThread).where(
            or_(
                (MessageThread.sender == me) & (MessageThread.reciever == receiver),
                (MessageThread.sender == receiver) & (MessageThread.reciever == me),
            )
        )
    ).first()
    if t is None:
        t = MessageThread(message_thread_code=secrets.token_hex(8)[:15], sender=me, reciever=receiver)
        db.add(t)
    attached = await _attachment(file, "message")
    now = _now()
    t.last_message_timestamp = now
    db.add(
        Message(
            message_thread_code=t.message_thread_code, message=message, sender=me, timestamp=now,
            read_status=0, attached_file_name=attached,
        )  # fmt: skip
    )
    db.commit()
    return thread_messages(t.message_thread_code, user, db)


@router.post("/messages/threads/{code}", response_model=list[MessageOut], status_code=201)
async def reply(
    code: str,
    user: Me,
    db: DB,
    message: str = Form(..., min_length=1, max_length=5000),
    file: UploadFile | None = File(None),
):
    t = _thread_for(db, user, code)
    attached = await _attachment(file, "message")
    now = _now()
    t.last_message_timestamp = now
    db.add(
        Message(
            message_thread_code=code, message=message, sender=user.ref, timestamp=now,
            read_status=0, attached_file_name=attached,
        )  # fmt: skip
    )
    db.commit()
    return thread_messages(code, user, db)


# --- groups -------------------------------------------------------------------


def _members(g: GroupMessageThread) -> list[str]:
    try:
        return [m for m in json.loads(g.members or "[]") if isinstance(m, str)]
    except ValueError:
        return []


def _group_out(db: Session, g: GroupMessageThread) -> GroupOut:
    members = _members(g)
    return GroupOut(
        code=g.group_message_thread_code or "",
        group_name=g.group_name,
        members=members,
        member_names=[ref_name(db, m, "_") for m in members],
        last_timestamp=g.last_message_timestamp,
    )


def _group_for(db: Session, user: CurrentUser, code: str) -> GroupMessageThread:
    g = db.scalars(select(GroupMessageThread).where(GroupMessageThread.group_message_thread_code == code)).first()
    if g is None:
        raise not_found("Group")
    if user.role != "admin" and f"{user.role}_{user.id}" not in _members(g):
        raise forbid()
    return g


def _clean_members(db: Session, members: list[str], user: CurrentUser) -> list[str]:
    clean = {m for m in members if (p := parse_ref(m, "_")) and get_account(db, *p) is not None}
    clean.add(f"{user.role}_{user.id}")
    return sorted(clean)


@router.get("/groups", response_model=list[GroupOut])
def list_groups(user: Me, db: DB):
    mine = f"{user.role}_{user.id}"
    groups = [g for g in db.scalars(select(GroupMessageThread)) if user.role == "admin" or mine in _members(g)]
    groups.sort(key=lambda g: int(g.last_message_timestamp or g.created_timestamp or 0), reverse=True)
    return [_group_out(db, g) for g in groups]


@router.post("/groups", response_model=GroupOut, status_code=201)
def create_group(body: GroupIn, db: DB, user: CurrentUser = Depends(require_roles("admin"))):
    g = GroupMessageThread(
        group_message_thread_code=secrets.token_hex(8)[:15],
        group_name=body.group_name,
        members=json.dumps(_clean_members(db, body.members, user)),
        created_timestamp=_now(),
    )
    db.add(g)
    db.commit()
    return _group_out(db, g)


@router.put("/groups/{code}", response_model=GroupOut)
def update_group(code: str, body: GroupIn, db: DB, user: CurrentUser = Depends(require_roles("admin"))):
    g = _group_for(db, user, code)
    g.group_name = body.group_name
    g.members = json.dumps(_clean_members(db, body.members, user))
    db.commit()
    return _group_out(db, g)


@router.delete("/groups/{code}", status_code=204)
def delete_group(code: str, db: DB, user: CurrentUser = Depends(require_roles("admin"))):
    g = _group_for(db, user, code)
    db.query(GroupMessage).filter(GroupMessage.group_message_thread_code == code).delete()
    db.delete(g)
    db.commit()


@router.get("/groups/{code}/messages", response_model=list[MessageOut])
def group_messages(code: str, user: Me, db: DB):
    _group_for(db, user, code)
    msgs = db.scalars(
        select(GroupMessage).where(GroupMessage.group_message_thread_code == code).order_by(GroupMessage.group_message_id)
    )
    names: dict[str, str] = {}
    return [_message_out(db, m, user.ref, "group_message", names) for m in msgs]


@router.post("/groups/{code}/messages", response_model=list[MessageOut], status_code=201)
async def post_group_message(
    code: str,
    user: Me,
    db: DB,
    message: str = Form(..., min_length=1, max_length=5000),
    file: UploadFile | None = File(None),
):
    g = _group_for(db, user, code)
    attached = await _attachment(file, "group_message")
    now = _now()
    g.last_message_timestamp = now
    db.add(
        GroupMessage(
            group_message_thread_code=code, sender=user.ref, message=message, timestamp=now,
            read_status=0, attached_file_name=attached,
        )  # fmt: skip
    )
    db.commit()
    return group_messages(code, user, db)
