import time

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.crud import get_or_404
from app.api.deps import DB, Me, require_roles
from app.models import Noticeboard, Parent, Student, Teacher
from app.schemas.common import Page
from app.schemas.notices import NoticeBase, NoticeOut
from app.services.files import delete_file, media_url, save_site_image
from app.services.messages import msg, school_language
from app.services.notifications import notify, user

router = APIRouter(prefix="/notices", tags=["noticeboard"])
admin_only = [Depends(require_roles("admin"))]


def notice_out(row: Noticeboard) -> NoticeOut:
    return NoticeOut(**NoticeBase.model_validate(row).model_dump(), image_url=media_url("notice", row.image))


def _queue_notice_sms(db: Session, tasks: BackgroundTasks, row: Noticeboard) -> None:
    """Legacy check_sms: tell every student, parent and teacher about the notice (by SMS unless
    they chose other channels for notices; each phone number gets one text)."""
    ts = row.create_timestamp
    day = time.strftime("%Y-%m-%d", time.gmtime(int(ts))) if ts and ts.isdigit() else time.strftime("%Y-%m-%d")
    lang = school_language(db)
    text = msg(lang, "notices.text", title=row.notice_title, date=day)
    people = [
        user(role, person_id)
        for role, model in (("student", Student), ("parent", Parent), ("teacher", Teacher))
        for person_id in db.scalars(select(getattr(model, f"{role}_id")))
    ]
    notify(db, tasks, people, "notices", row.notice_title or msg(lang, "notices.default_title"), text, "/app/notices", sms_text=text)


@router.get("", response_model=Page)
def list_notices(_: Me, db: DB, limit: int = 100):
    rows = list(db.scalars(select(Noticeboard).where(Noticeboard.status == 1).order_by(Noticeboard.notice_id.desc()).limit(limit)))
    return Page(items=[notice_out(r) for r in rows], total=len(rows))


@router.get("/all", response_model=Page, dependencies=admin_only)
def list_all(db: DB):
    rows = list(db.scalars(select(Noticeboard).order_by(Noticeboard.notice_id.desc())))
    return Page(items=[notice_out(r) for r in rows], total=len(rows))


@router.post("", response_model=NoticeOut, status_code=201, dependencies=admin_only)
async def create_notice(
    db: DB,
    tasks: BackgroundTasks,
    notice_title: str = Form(..., min_length=1),
    notice: str = Form(""),
    show_on_website: int = Form(0),
    status: int = Form(1),
    send_sms: str = Form("0", pattern="^[01]$"),
    image: UploadFile | None = File(None),
):
    row = Noticeboard(
        notice_title=notice_title,
        notice=notice,
        show_on_website=show_on_website,
        status=status,
        create_timestamp=str(int(time.time())),
    )
    if image is not None and image.filename:
        row.image = await save_site_image(image, "notice")
    db.add(row)
    db.commit()
    db.refresh(row)
    if send_sms == "1":
        _queue_notice_sms(db, tasks, row)
    return notice_out(row)


@router.put("/{notice_id}", response_model=NoticeOut, dependencies=admin_only)
async def update_notice(
    notice_id: int,
    db: DB,
    tasks: BackgroundTasks,
    notice_title: str = Form(..., min_length=1),
    notice: str = Form(""),
    show_on_website: int = Form(0),
    status: int = Form(1),
    send_sms: str = Form("0", pattern="^[01]$"),
    image: UploadFile | None = File(None),
):
    row = get_or_404(db, Noticeboard, notice_id, "Notice")
    row.notice_title, row.notice, row.show_on_website, row.status = notice_title, notice, show_on_website, status
    if image is not None and image.filename:
        delete_file("notice", row.image)
        row.image = await save_site_image(image, "notice")
    db.commit()
    if send_sms == "1":
        _queue_notice_sms(db, tasks, row)
    return notice_out(row)


@router.delete("/{notice_id}", status_code=204, dependencies=admin_only)
def delete_notice(notice_id: int, db: DB):
    row = get_or_404(db, Noticeboard, notice_id, "Notice")
    delete_file("notice", row.image)
    db.delete(row)
    db.commit()
