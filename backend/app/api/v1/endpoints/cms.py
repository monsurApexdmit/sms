"""Public school website (no login) and its admin editor. Uses the legacy
frontend_* tables and uploads/frontend/* images."""

import calendar
import json
import logging
import time
from datetime import date
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.crud import get_or_404
from app.api.deps import DB, require_roles
from app.models import (
    FrontendEvent,
    FrontendGallery,
    FrontendGalleryImage,
    FrontendGeneralSetting,
    FrontendNews,
    Noticeboard,
    Teacher,
)
from app.services.files import delete_file, media_url, save_site_image, user_image_url
from app.services.jobs import enqueue
from app.services.notify import send_email
from app.services.ratelimit import throttle
from app.services.settings import MASK, get_setting

log = logging.getLogger("contact")

public = APIRouter(prefix="/public", tags=["public website"])
admin = APIRouter(prefix="/cms", tags=["website admin"], dependencies=[Depends(require_roles("admin"))])

PUBLIC_TTL = 86400
TEXT_KEYS = {
    "school_title", "address", "phone", "email", "fax", "copyright_text", "school_location",
    "about_us", "terms_conditions", "privacy_policy", "homepage_note_title", "homepage_note_description",
    "theme", "social_links", "recaptcha_site_key",
}  # fmt: skip
IMAGE_KEYS = {"header_logo", "footer_logo", "about_us_image"}
SECRET_KEYS = {"recaptcha_secret_key"}  # writable by admins, never sent back in clear
RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify"


def _general(db: Session) -> dict[str, str | None]:
    return {r.type: r.description for r in db.scalars(select(FrontendGeneralSetting)) if r.type}


def _set_general(db: Session, key: str, value: str | None) -> None:
    row = db.scalars(select(FrontendGeneralSetting).where(FrontendGeneralSetting.type == key)).first()
    if row is None:
        db.add(FrontendGeneralSetting(type=key, description=value))
    else:
        row.description = value


def _json_list(raw: str | None) -> list[Any]:
    try:
        value = json.loads(raw or "[]")
        return value if isinstance(value, list) else []
    except ValueError:
        return []


def _site_image(name: str | None) -> str | None:
    return media_url("site", name, PUBLIC_TTL)


def _news(n: FrontendNews) -> dict:
    return {
        "frontend_news_id": n.frontend_news_id,
        "title": n.title,
        "description": n.description,
        "date_added": n.date_added,
        "image_url": media_url("news", n.image, PUBLIC_TTL),
    }


def _notice(n: Noticeboard) -> dict:
    return {
        "notice_id": n.notice_id,
        "notice_title": n.notice_title,
        "notice": n.notice,
        "create_timestamp": n.create_timestamp,
        "image_url": media_url("notice", n.image, PUBLIC_TTL),
    }


def _gallery(g: FrontendGallery) -> dict:
    return {
        "frontend_gallery_id": g.frontend_gallery_id,
        "title": g.title,
        "description": g.description,
        "date_added": g.date_added,
        "show_on_website": g.show_on_website,
        "image_url": media_url("gallery_cover", g.image, PUBLIC_TTL),
    }


# --- public -------------------------------------------------------------------


@public.get("/site")
def site(db: DB):
    g = _general(db)
    social = _json_list(g.get("social_links"))
    return {
        "system_name": get_setting(db, "system_name"),
        **{k: g.get(k) for k in TEXT_KEYS - {"social_links", "recaptcha_site_key"}},
        "social_links": social[0] if social else {},
        "recaptcha_site_key": g.get("recaptcha_site_key") or None,
        "contact_enabled": bool(_contact_target(db, g)),
        "header_logo_url": _site_image(g.get("header_logo")),
        "footer_logo_url": _site_image(g.get("footer_logo")),
        "about_us_image_url": _site_image(g.get("about_us_image")),
        "slider": [
            {**s, "image_url": media_url("slider", s.get("image"), PUBLIC_TTL)}
            for s in _json_list(g.get("slider_images"))
            if isinstance(s, dict)
        ],
    }


# --- contact form ---

CONTACT_LIMIT, CONTACT_WINDOW = 5, 600


class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr = Field(max_length=254)
    phone: str | None = Field(default=None, max_length=50)
    message: str = Field(min_length=1, max_length=5000)
    recaptcha_token: str | None = Field(default=None, max_length=4000)


def _contact_target(db: Session, g: dict[str, str | None]) -> str:
    return (g.get("email") or get_setting(db, "system_email") or "").strip()


def _contact_throttle(ip: str) -> None:
    throttle(f"contact:{ip}", CONTACT_LIMIT, CONTACT_WINDOW, "Too many messages. Please try again later.")


def _recaptcha_ok(secret: str, token: str, ip: str) -> bool:
    try:
        r = httpx.post(RECAPTCHA_VERIFY_URL, data={"secret": secret, "response": token, "remoteip": ip}, timeout=10)
        r.raise_for_status()
        return r.json().get("success") is True
    except (httpx.HTTPError, ValueError):
        log.exception("reCAPTCHA verification request failed")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Could not verify reCAPTCHA. Please try again.") from None


def verify_recaptcha(g: dict[str, str | None], token: str | None, ip: str) -> None:
    """Public forms: require a valid reCAPTCHA token when the website has a secret key set."""
    secret = (g.get("recaptcha_secret_key") or "").strip()
    if not secret:
        return
    if not token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please complete the reCAPTCHA check")
    if not _recaptcha_ok(secret, token, ip):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "reCAPTCHA verification failed")


def website_settings(db: Session) -> dict[str, str | None]:
    return _general(db)


@public.post("/contact", status_code=202)
def contact(body: ContactIn, request: Request, tasks: BackgroundTasks, db: DB):
    ip = request.client.host if request.client else "?"
    _contact_throttle(ip)
    g = _general(db)
    target = _contact_target(db, g)
    if not target:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The contact form is not available")
    verify_recaptcha(g, body.recaptcha_token, ip)
    name = " ".join(body.name.split())  # no line breaks in the subject header
    text = (
        f"Message from the website contact form.\n\nName: {name}\nEmail: {body.email}\n"
        f"Phone: {(body.phone or '').strip() or '-'}\n\n{body.message}"
    )
    enqueue(tasks, send_email, target, f"Contact form: {name}", text)
    return {"status": "sent"}


@public.get("/news")
def public_news(db: DB, limit: int = 20):
    rows = db.scalars(select(FrontendNews).order_by(FrontendNews.frontend_news_id.desc()).limit(min(limit, 100)))
    return [_news(n) for n in rows]


@public.get("/news/{news_id}")
def public_news_item(news_id: int, db: DB):
    return _news(get_or_404(db, FrontendNews, news_id, "News"))


@public.get("/events")
def public_events(db: DB):
    rows = db.scalars(select(FrontendEvent).where(FrontendEvent.status == 1).order_by(FrontendEvent.timestamp.desc()))
    return [{"frontend_events_id": e.frontend_events_id, "title": e.title, "timestamp": e.timestamp} for e in rows]


@public.get("/notices")
def public_notices(db: DB):
    rows = db.scalars(
        select(Noticeboard)
        .where(Noticeboard.show_on_website == 1, Noticeboard.status == 1)
        .order_by(Noticeboard.notice_id.desc())
    )
    return [_notice(n) for n in rows]


@public.get("/notices/{notice_id}")
def public_notice(notice_id: int, db: DB):
    n = get_or_404(db, Noticeboard, notice_id, "Notice")
    if n.show_on_website != 1:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notice not found")
    return _notice(n)


@public.get("/gallery")
def public_gallery(db: DB):
    rows = db.scalars(
        select(FrontendGallery).where(FrontendGallery.show_on_website == 1).order_by(FrontendGallery.frontend_gallery_id.desc())
    )
    return [_gallery(g) for g in rows]


@public.get("/gallery/{gallery_id}")
def public_gallery_item(gallery_id: int, db: DB):
    g = get_or_404(db, FrontendGallery, gallery_id, "Gallery")
    if g.show_on_website != 1:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gallery not found")
    return {**_gallery(g), "images": _gallery_images(db, gallery_id)}


def _gallery_images(db: Session, gallery_id: int) -> list[dict]:
    rows = db.scalars(select(FrontendGalleryImage).where(FrontendGalleryImage.frontend_gallery_id == gallery_id))
    return [
        {
            "frontend_gallery_image_id": i.frontend_gallery_image_id,
            "title": i.title,
            "image_url": media_url("gallery_image", i.image, PUBLIC_TTL),
        }
        for i in rows
    ]


@public.get("/teachers")
def public_teachers(db: DB):
    rows = db.scalars(select(Teacher).where(Teacher.show_on_website == 1).order_by(Teacher.name))
    return [
        {
            "teacher_id": t.teacher_id,
            "name": t.name,
            "designation": t.designation,
            "about": t.about,
            "social_links": (_json_list(t.social_links) or [{}])[0],
            "image_url": user_image_url("teacher", t.teacher_id, PUBLIC_TTL),
        }
        for t in rows
    ]


# --- admin --------------------------------------------------------------------


@admin.get("/settings")
def get_site_settings(db: DB):
    g = _general(db)
    return {
        **{k: g.get(k) for k in TEXT_KEYS},
        **{k: (MASK if g.get(k) else g.get(k)) for k in SECRET_KEYS},
        **{f"{k}_url": _site_image(g.get(k)) for k in IMAGE_KEYS},
        "slider": [
            {**s, "image_url": media_url("slider", s.get("image"))}
            for s in _json_list(g.get("slider_images"))
            if isinstance(s, dict)
        ],
        "disable_frontend": get_setting(db, "disable_frontend", "0"),
    }


@admin.put("/settings")
def update_site_settings(body: dict[str, str | None], db: DB):
    unknown = set(body) - TEXT_KEYS - SECRET_KEYS
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown keys: {', '.join(sorted(unknown))}")
    for key, value in body.items():
        if key in SECRET_KEYS and value == MASK:
            continue  # unchanged secret
        _set_general(db, key, value)
    db.commit()
    return get_site_settings(db)


@admin.post("/images/{key}")
async def upload_site_image(key: str, db: DB, file: UploadFile = File(...)):
    if key not in IMAGE_KEYS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown image")
    old = _general(db).get(key)
    name = await save_site_image(file, "site")
    _set_general(db, key, name)
    db.commit()
    if old and old != name:
        delete_file("site", old)
    return get_site_settings(db)


class SlideIn(BaseModel):
    title: str = ""
    description: str = ""
    image: str


@admin.put("/slider")
def update_slider(slides: list[SlideIn], db: DB):
    _set_general(db, "slider_images", json.dumps([s.model_dump() for s in slides]))
    db.commit()
    return get_site_settings(db)


@admin.post("/slider/image")
async def upload_slide_image(file: UploadFile = File(...)):
    name = await save_site_image(file, "slider")
    return {"image": name, "image_url": media_url("slider", name)}


# news


@admin.get("/news")
def admin_news(db: DB):
    return [_news(n) for n in db.scalars(select(FrontendNews).order_by(FrontendNews.frontend_news_id.desc()))]


@admin.post("/news", status_code=201)
async def create_news(
    db: DB, title: str = Form(..., min_length=1), description: str = Form(""), image: UploadFile | None = File(None)
):
    n = FrontendNews(title=title, description=description, date_added=int(time.time()))
    if image is not None and image.filename:
        n.image = await save_site_image(image, "news")
    db.add(n)
    db.commit()
    return _news(n)


@admin.put("/news/{news_id}")
async def update_news(
    news_id: int,
    db: DB,
    title: str = Form(..., min_length=1),
    description: str = Form(""),
    image: UploadFile | None = File(None),
):
    n = get_or_404(db, FrontendNews, news_id, "News")
    n.title, n.description = title, description
    if image is not None and image.filename:
        delete_file("news", n.image)
        n.image = await save_site_image(image, "news")
    db.commit()
    return _news(n)


@admin.delete("/news/{news_id}", status_code=204)
def delete_news(news_id: int, db: DB):
    n = get_or_404(db, FrontendNews, news_id, "News")
    delete_file("news", n.image)
    db.delete(n)
    db.commit()


# events


class EventIn(BaseModel):
    title: str = Field(min_length=1)
    date: date
    status: int = Field(default=1, ge=0, le=1)


@admin.get("/events")
def admin_events(db: DB):
    rows = db.scalars(select(FrontendEvent).order_by(FrontendEvent.timestamp.desc()))
    return [{"frontend_events_id": e.frontend_events_id, "title": e.title, "timestamp": e.timestamp, "status": e.status} for e in rows]


def _day(d: date) -> int:
    return calendar.timegm(d.timetuple())


@admin.post("/events", status_code=201)
def create_event(body: EventIn, db: DB):
    e = FrontendEvent(title=body.title, timestamp=_day(body.date), status=body.status)
    db.add(e)
    db.commit()
    return {"frontend_events_id": e.frontend_events_id}


@admin.put("/events/{event_id}")
def update_event(event_id: int, body: EventIn, db: DB):
    e = get_or_404(db, FrontendEvent, event_id, "Event")
    e.title, e.timestamp, e.status = body.title, _day(body.date), body.status
    db.commit()
    return {"frontend_events_id": e.frontend_events_id}


@admin.delete("/events/{event_id}", status_code=204)
def delete_event(event_id: int, db: DB):
    db.delete(get_or_404(db, FrontendEvent, event_id, "Event"))
    db.commit()


# gallery


@admin.get("/gallery")
def admin_gallery(db: DB):
    return [_gallery(g) for g in db.scalars(select(FrontendGallery).order_by(FrontendGallery.frontend_gallery_id.desc()))]


@admin.get("/gallery/{gallery_id}")
def admin_gallery_item(gallery_id: int, db: DB):
    return {**_gallery(get_or_404(db, FrontendGallery, gallery_id, "Gallery")), "images": _gallery_images(db, gallery_id)}


@admin.post("/gallery", status_code=201)
async def create_gallery(
    db: DB,
    title: str = Form(..., min_length=1),
    description: str = Form(""),
    show_on_website: int = Form(1),
    image: UploadFile | None = File(None),
):
    g = FrontendGallery(title=title, description=description, show_on_website=show_on_website, date_added=int(time.time()))
    if image is not None and image.filename:
        g.image = await save_site_image(image, "gallery_cover")
    db.add(g)
    db.commit()
    return _gallery(g)


@admin.put("/gallery/{gallery_id}")
async def update_gallery(
    gallery_id: int,
    db: DB,
    title: str = Form(..., min_length=1),
    description: str = Form(""),
    show_on_website: int = Form(1),
    image: UploadFile | None = File(None),
):
    g = get_or_404(db, FrontendGallery, gallery_id, "Gallery")
    g.title, g.description, g.show_on_website = title, description, show_on_website
    if image is not None and image.filename:
        delete_file("gallery_cover", g.image)
        g.image = await save_site_image(image, "gallery_cover")
    db.commit()
    return _gallery(g)


@admin.delete("/gallery/{gallery_id}", status_code=204)
def delete_gallery(gallery_id: int, db: DB):
    g = get_or_404(db, FrontendGallery, gallery_id, "Gallery")
    for img in db.scalars(select(FrontendGalleryImage).where(FrontendGalleryImage.frontend_gallery_id == gallery_id)):
        delete_file("gallery_image", img.image)
        db.delete(img)
    delete_file("gallery_cover", g.image)
    db.delete(g)
    db.commit()


@admin.post("/gallery/{gallery_id}/images", status_code=201)
async def add_gallery_images(gallery_id: int, db: DB, files: list[UploadFile] = File(...), title: str = Form("")):
    get_or_404(db, FrontendGallery, gallery_id, "Gallery")
    for f in files[:30]:
        db.add(FrontendGalleryImage(frontend_gallery_id=gallery_id, title=title, image=await save_site_image(f, "gallery_image")))
    db.commit()
    return _gallery_images(db, gallery_id)


@admin.delete("/gallery-images/{image_id}", status_code=204)
def delete_gallery_image(image_id: int, db: DB):
    img = get_or_404(db, FrontendGalleryImage, image_id, "Image")
    delete_file("gallery_image", img.image)
    db.delete(img)
    db.commit()
