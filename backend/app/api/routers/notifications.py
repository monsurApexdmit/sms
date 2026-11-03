"""In-app notifications, notification preferences, web push subscriptions, and the admin
settings for the push and WhatsApp channels."""

from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import case, delete, func, select, update

from app.api.crud import Page
from app.core.deps import DB, Me, not_found, require_roles
from app.models import Notification, NotificationPreference, PushSubscription
from app.services.messages import msg, school_language
from app.services.notifications import CATEGORIES, available_channels, channels_for, generate_vapid_keys, notify, user, vapid_keys
from app.services.settings import MASK, SECRET_KEYS, get_setting, set_setting

router = APIRouter(prefix="/notifications", tags=["notifications"])
admin_only = [Depends(require_roles("admin"))]

LABELS = {
    "attendance": "Attendance", "homework": "Homework", "leave": "Leave", "fees": "Fees and payments",
    "exams": "Exams and results", "meetings": "Parent-teacher meetings", "notices": "Notices",
    "admissions": "Admissions", "system": "Account and system",
}  # fmt: skip
CHANNEL_SETTINGS = (
    "whatsapp_token", "whatsapp_phone_number_id", "whatsapp_template", "whatsapp_template_language",
    "vapid_public_key", "vapid_private_key", "vapid_subject",
)  # fmt: skip


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class NotificationOut(BaseModel):
    notification_id: int
    category: str
    title: str
    body: str | None
    link: str | None
    created_at: datetime
    read_at: datetime | None


def _out(row: Notification) -> NotificationOut:
    # stored as naive UTC
    return NotificationOut(
        notification_id=row.notification_id, category=row.category, title=row.title, body=row.body, link=row.link,
        created_at=row.created_at.replace(tzinfo=timezone.utc),
        read_at=row.read_at.replace(tzinfo=timezone.utc) if row.read_at else None,
    )  # fmt: skip


def _mine(user_: Me):
    return (Notification.recipient_role == user_.role, Notification.recipient_id == user_.id)


@router.get("", response_model=Page)
def list_notifications(
    me: Me,
    db: DB,
    unread_only: bool = False,
    category: str | None = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """My notifications, unread first, newest first."""
    stmt = select(Notification).where(*_mine(me))
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    if category:
        stmt = stmt.where(Notification.category == category)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    unread_first = case((Notification.read_at.is_(None), 0), else_=1)
    rows = db.scalars(stmt.order_by(unread_first, Notification.notification_id.desc()).limit(limit).offset(offset))
    return Page(items=[_out(r) for r in rows], total=total)


@router.get("/unread-count")
def unread_count(me: Me, db: DB):
    count = db.scalar(select(func.count()).select_from(Notification).where(*_mine(me), Notification.read_at.is_(None))) or 0
    return {"count": count}


@router.post("/{notification_id}/read", status_code=204)
def mark_read(notification_id: int, me: Me, db: DB):
    row = db.get(Notification, notification_id)
    if row is None or (row.recipient_role, row.recipient_id) != (me.role, me.id):
        raise not_found("Notification")
    if row.read_at is None:
        row.read_at = _now()
        db.commit()


@router.post("/read-all")
def mark_all_read(me: Me, db: DB):
    result = db.execute(update(Notification).where(*_mine(me), Notification.read_at.is_(None)).values(read_at=_now()))
    db.commit()
    return {"updated": result.rowcount}


# --- preferences ----------------------------------------------------------------------


class PreferenceItem(BaseModel):
    category: str
    in_app: bool = True
    email: bool = False
    sms: bool = False
    push: bool = True
    whatsapp: bool = False

    @field_validator("category")
    @classmethod
    def known(cls, v: str) -> str:
        if v not in CATEGORIES:
            raise ValueError("Unknown category")
        return v


class PreferencesIn(BaseModel):
    items: list[PreferenceItem] = Field(max_length=len(CATEGORIES))


def _preferences(db: DB, me: Me) -> dict:
    items = []
    for category in CATEGORIES:
        on = channels_for(db, me.role, me.id, category)
        items.append({"category": category, "label": LABELS[category], **{c: c in on for c in ("in_app", "email", "sms", "push", "whatsapp")}})
    return {"items": items, "available": available_channels(db)}


@router.get("/preferences")
def get_preferences(me: Me, db: DB):
    """My channels per category, and which channels the school has set up."""
    return _preferences(db, me)


@router.put("/preferences")
def save_preferences(body: PreferencesIn, me: Me, db: DB):
    existing = {
        p.category: p
        for p in db.scalars(
            select(NotificationPreference).where(NotificationPreference.user_role == me.role, NotificationPreference.user_id == me.id)
        )
    }
    for item in body.items:
        row = existing.get(item.category)
        if row is None:
            row = NotificationPreference(user_role=me.role, user_id=me.id, category=item.category)
            db.add(row)
            existing[item.category] = row
        row.in_app, row.email, row.sms, row.push, row.whatsapp = item.in_app, item.email, item.sms, item.push, item.whatsapp
    db.commit()
    return _preferences(db, me)


# --- web push ---------------------------------------------------------------------------


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=200)
    auth: str = Field(min_length=1, max_length=100)


class SubscribeIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=500)
    keys: PushKeys

    @field_validator("endpoint")
    @classmethod
    def https(cls, v: str) -> str:
        if not v.startswith("https://"):
            raise ValueError("endpoint must be an https URL")
        return v


class UnsubscribeIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=500)


@router.get("/push/public-key")
def push_public_key(_: Me, db: DB):
    keys = vapid_keys(db)
    return {"public_key": keys[0] if keys else None}


@router.post("/push/subscribe", status_code=204)
def push_subscribe(body: SubscribeIn, request: Request, me: Me, db: DB):
    """Save this browser's subscription for me (a browser moves to whoever subscribed last)."""
    row = db.scalars(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint)).first()
    if row is None:
        row = PushSubscription(endpoint=body.endpoint, created_at=_now())
        db.add(row)
    row.user_role, row.user_id = me.role, me.id
    row.p256dh, row.auth = body.keys.p256dh, body.keys.auth
    row.user_agent = (request.headers.get("user-agent") or "")[:300] or None
    db.commit()


@router.post("/push/unsubscribe", status_code=204)
def push_unsubscribe(body: UnsubscribeIn, me: Me, db: DB):
    db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == body.endpoint, PushSubscription.user_role == me.role, PushSubscription.user_id == me.id
        )
    )
    db.commit()


@router.post("/test")
def send_test(me: Me, tasks: BackgroundTasks, db: DB):
    """Send myself a test notification on every channel I have on for "Account and system"."""
    lang = school_language(db)
    notify(db, tasks, [user(me.role, me.id)], "system", msg(lang, "notifications.test.title"), msg(lang, "notifications.test.text"), "/app/notifications")
    return {"channels": sorted(channels_for(db, me.role, me.id, "system"))}


# --- admin: channel settings ---------------------------------------------------------------


def _channel_settings(db: DB) -> dict:
    out = {}
    for key in CHANNEL_SETTINGS:
        value = get_setting(db, key)
        out[key] = MASK if key in SECRET_KEYS and value else value
    out["subscriptions"] = db.scalar(select(func.count()).select_from(PushSubscription)) or 0
    return out


@router.get("/settings", dependencies=admin_only)
def get_channel_settings(db: DB):
    return _channel_settings(db)


class ChannelSettingsIn(BaseModel):
    whatsapp_token: str | None = Field(default=None, max_length=1000)
    whatsapp_phone_number_id: str | None = Field(default=None, max_length=50)
    whatsapp_template: str | None = Field(default=None, max_length=100)
    whatsapp_template_language: str | None = Field(default=None, max_length=20)
    vapid_subject: str | None = Field(default=None, max_length=200)


@router.put("/settings", dependencies=admin_only)
def save_channel_settings(body: ChannelSettingsIn, db: DB):
    """VAPID keys are not set here: generate them with POST /notifications/settings/vapid."""
    for key, value in body.model_dump(exclude_unset=True).items():
        if value == MASK:
            continue  # unchanged secret
        set_setting(db, key, (value or "").strip())
    db.commit()
    return _channel_settings(db)


@router.post("/settings/vapid", status_code=status.HTTP_200_OK, dependencies=admin_only)
def new_vapid_keys(db: DB):
    """Create a new VAPID key pair. Existing browser subscriptions belong to the old key and are removed."""
    public, private = generate_vapid_keys()
    set_setting(db, "vapid_public_key", public)
    set_setting(db, "vapid_private_key", private)
    db.execute(delete(PushSubscription))
    db.commit()
    return _channel_settings(db)
