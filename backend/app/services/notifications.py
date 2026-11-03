"""Notifications: one call writes the in-app notification and sends it on the channels
each recipient chose for that category (email, SMS, web push, WhatsApp).

Without a saved preference a category's DEFAULTS apply; they match what the app sent
before notifications existed (absence alerts by SMS, homework grades by email, ...). A
call can pass its own `defaults` when one category serves different people (e.g. staff
leave decisions are emailed but not texted). External sends go through the job queue
(app/services/jobs.py) so they are retried; channels that are not configured are skipped.
"""

import base64
import json
import logging
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
from cryptography.hazmat.primitives import serialization
from fastapi import BackgroundTasks
from py_vapid import Vapid02
from pywebpush import WebPushException, webpush
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from app.db.session import new_session
from app.models import Enroll, Notification, NotificationPreference, PushSubscription, Student
from app.services import notify as delivery
from app.services.accounts import ROLE_MODELS, id_column
from app.services.jobs import enqueue
from app.services.settings import get_setting, running_year

log = logging.getLogger("notifications")

CATEGORIES = ("attendance", "homework", "leave", "fees", "exams", "meetings", "notices", "admissions", "system")
CHANNELS = ("in_app", "email", "sms", "push", "whatsapp")
EXTERNAL = ("email", "sms", "push", "whatsapp")
# External channels on by default per category (in-app is always on by default).
DEFAULTS: dict[str, frozenset[str]] = {
    "attendance": frozenset({"sms", "push"}),
    "homework": frozenset({"email", "push"}),
    "leave": frozenset({"email", "sms", "push"}),
    "fees": frozenset({"email", "sms", "push"}),
    "exams": frozenset({"sms", "push"}),
    "meetings": frozenset({"email", "push"}),
    "notices": frozenset({"sms", "push"}),
    "admissions": frozenset({"email"}),
    "system": frozenset({"email", "push"}),
}
WHATSAPP_API = "https://graph.facebook.com/v21.0"


@dataclass(frozen=True)
class Recipient:
    """A user account (role + id), or a contact without one (email/phone only, e.g. an applicant)."""

    role: str | None = None
    id: int | None = None
    email: str | None = None
    phone: str | None = None

    @property
    def is_user(self) -> bool:
        return self.role is not None and self.id is not None


def user(role: str, user_id: int) -> Recipient:
    return Recipient(role=role, id=user_id)


def parent_or_student(db: Session, student_id: int) -> Recipient | None:
    """The student's parent, or the student when no parent is linked."""
    student = db.get(Student, student_id)
    if student is None:
        return None
    return user("parent", student.parent_id) if student.parent_id else user("student", student_id)


def parents_of(db: Session, student_ids: Iterable[int]) -> list[Recipient]:
    ids = list(student_ids)
    if not ids:
        return []
    parent_ids = {p for p in db.scalars(select(Student.parent_id).where(Student.student_id.in_(ids))) if p}
    return [user("parent", p) for p in sorted(parent_ids)]


def class_members(db: Session, class_id: int, section_id: int | None = None, *, with_parents: bool = True) -> list[Recipient]:
    """Students enrolled in the class (and section) this year, and their parents."""
    stmt = select(Enroll.student_id).where(Enroll.class_id == class_id, Enroll.year == running_year(db))
    if section_id:
        stmt = stmt.where(Enroll.section_id == section_id)
    ids = sorted(set(db.scalars(stmt)))
    out = [user("student", s) for s in ids]
    return out + parents_of(db, ids) if with_parents else out


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def channels_for(db: Session, role: str, user_id: int, category: str, defaults: Iterable[str] | None = None) -> set[str]:
    """Channels this user gets for `category`: their saved preference, else the defaults."""
    pref = db.scalars(
        select(NotificationPreference).where(
            NotificationPreference.user_role == role, NotificationPreference.user_id == user_id,
            NotificationPreference.category == category,
        )  # fmt: skip
    ).first()
    if pref is not None:
        return {c for c in CHANNELS if getattr(pref, c)}
    return {"in_app", *(DEFAULTS.get(category, frozenset()) if defaults is None else defaults)}


# --- channel configuration ------------------------------------------------------------


def vapid_keys(db: Session) -> tuple[str, str, str] | None:
    """(public key, private key, subject) when web push is configured."""
    public, private = get_setting(db, "vapid_public_key").strip(), get_setting(db, "vapid_private_key").strip()
    if not (public and private):
        return None
    subject = get_setting(db, "vapid_subject").strip() or f"mailto:{get_setting(db, 'system_email') or 'admin@example.com'}"
    return public, private, subject


def generate_vapid_keys() -> tuple[str, str]:
    """A new (public, private) VAPID key pair, URL-safe base64 as browsers and pywebpush expect."""
    key = Vapid02()
    key.generate_keys()
    raw_public = key.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    raw_private = key.private_key.private_numbers().private_value.to_bytes(32, "big")
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()  # noqa: E731
    return b64(raw_public), b64(raw_private)


def whatsapp_enabled(db: Session) -> bool:
    return bool(get_setting(db, "whatsapp_token").strip() and get_setting(db, "whatsapp_phone_number_id").strip())


def available_channels(db: Session) -> dict[str, bool]:
    return {
        "in_app": True,
        "email": bool(get_setting(db, "smtp_host") and get_setting(db, "smtp_user")),
        "sms": delivery.sms_enabled(db),
        "push": vapid_keys(db) is not None,
        "whatsapp": whatsapp_enabled(db),
    }


# --- senders (run as jobs) ---------------------------------------------------------------


def send_push(subscription_id: int, payload: str) -> None:
    """Deliver one web push. Subscriptions the push service reports as gone are deleted."""
    with new_session() as db:
        sub = db.get(PushSubscription, subscription_id)
        keys = vapid_keys(db)
        if sub is None or keys is None:
            return
        _, private, subject = keys
        try:
            webpush(
                {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                data=payload, vapid_private_key=private, vapid_claims={"sub": subject}, ttl=86400, timeout=20,
            )  # fmt: skip
        except WebPushException as e:
            if e.response is not None and e.response.status_code in (404, 410):
                db.delete(sub)
                db.commit()
                return
            raise
        sub.last_success_at = _now()
        db.commit()


def _whatsapp_number(phone: str) -> str:
    return "".join(ch for ch in phone if ch.isdigit())


def send_whatsapp(phone: str, text: str) -> None:
    """Send through the WhatsApp Cloud API. With `whatsapp_template` set, the approved template
    is used with the text as its single body parameter ({{1}}): Meta only allows free text to
    people who wrote to the school in the last 24 hours, so templates are needed for alerts."""
    with new_session() as db:
        token = get_setting(db, "whatsapp_token").strip()
        number_id = get_setting(db, "whatsapp_phone_number_id").strip()
        template = get_setting(db, "whatsapp_template").strip()
        language = get_setting(db, "whatsapp_template_language").strip() or "en"
    to = _whatsapp_number(phone)
    if not (token and number_id and to):
        log.info("WhatsApp not configured; message to %s skipped: %s", phone, text)
        return
    if template:
        message = {
            "type": "template",
            "template": {
                "name": template,
                "language": {"code": language},
                "components": [{"type": "body", "parameters": [{"type": "text", "text": text[:1000]}]}],
            },
        }
    else:
        message = {"type": "text", "text": {"body": text[:4096]}}
    httpx.post(
        f"{WHATSAPP_API}/{number_id}/messages",
        headers={"Authorization": f"Bearer {token}"},
        json={"messaging_product": "whatsapp", "to": to, **message},
        timeout=20,
    ).raise_for_status()


# --- notify ---------------------------------------------------------------------------------


def notify(
    db: Session,
    tasks: BackgroundTasks,
    recipients: Iterable[Recipient | None],
    category: str,
    title: str,
    body: str,
    link: str | None = None,
    sms_text: str | None = None,
    *,
    email_subject: str | None = None,
    email_body: str | None = None,
    defaults: Iterable[str] | None = None,
    commit: bool = True,
) -> int:
    """Notify every recipient on their channels; returns how many recipients there were.
    Each email address, phone number and push subscription gets a message at most once per
    call (a parent and a child sharing a phone get one SMS). Accounts, preferences and push
    subscriptions are loaded in a few queries, so a notice to the whole school stays cheap.
    With commit=False the caller commits the in-app rows."""
    assert category in CATEGORIES, category
    defaults = None if defaults is None else frozenset(defaults)
    available = available_channels(db)
    sms_text = sms_text or (f"{title}: {body}" if body else title)
    push_payload = json.dumps({"title": title, "body": body, "link": link, "category": category})
    people = list(dict.fromkeys(r for r in recipients if r is not None))
    ids_by_role: dict[str, set[int]] = defaultdict(set)
    for r in people:
        if r.is_user and r.role in ROLE_MODELS:
            ids_by_role[r.role].add(r.id)
    accounts, prefs, subs = _load(db, ids_by_role, category, with_push=available["push"])

    sent_email: set[str] = set()
    sent_phone: dict[str, set[str]] = {"sms": set(), "whatsapp": set()}
    in_app_rows = []
    now = _now()
    for r in people:
        if r.is_user:
            account = accounts.get((r.role, r.id))
            if account is None:
                continue
            pref = prefs.get((r.role, r.id))
            channels = {c for c in CHANNELS if getattr(pref, c)} if pref is not None else {"in_app", *(DEFAULTS[category] if defaults is None else defaults)}
            email, phone = (account.email or "").strip(), (getattr(account, "phone", None) or "").strip()
        else:
            channels = set(DEFAULTS[category] if defaults is None else defaults)
            email, phone = (r.email or "").strip(), (r.phone or "").strip()

        if "in_app" in channels and r.is_user:
            in_app_rows.append({
                "recipient_role": r.role, "recipient_id": r.id, "category": category, "title": title[:200], "body": body,
                "link": link, "created_at": now, "read_at": None,
            })  # fmt: skip
        # email is always queued: send_email itself logs and skips when SMTP is not set up
        if "email" in channels and email and email.lower() not in sent_email:
            sent_email.add(email.lower())
            enqueue(tasks, delivery.send_email, email, email_subject or title, email_body or body)
        if "sms" in channels and available["sms"] and phone and phone not in sent_phone["sms"]:
            sent_phone["sms"].add(phone)
            enqueue(tasks, delivery.send_sms, phone, sms_text)
        if "whatsapp" in channels and available["whatsapp"] and phone and phone not in sent_phone["whatsapp"]:
            sent_phone["whatsapp"].add(phone)
            enqueue(tasks, send_whatsapp, phone, sms_text)
        if "push" in channels and r.is_user:
            for sub_id in subs.get((r.role, r.id), ()):
                enqueue(tasks, send_push, sub_id, push_payload)
    if in_app_rows:
        db.execute(insert(Notification), in_app_rows)
    if commit:
        db.commit()
    return len(people)


def _load(db: Session, ids_by_role: dict[str, set[int]], category: str, *, with_push: bool):
    """Accounts, saved preferences for `category` and push subscription ids of the given users."""
    accounts, prefs, subs = {}, {}, defaultdict(list)
    for role, ids in ids_by_role.items():
        model, pk = ROLE_MODELS[role], id_column(role)
        for chunk in _chunks(sorted(ids)):
            accounts.update(((role, getattr(a, f"{role}_id")), a) for a in db.scalars(select(model).where(pk.in_(chunk))))
            prefs.update(
                ((p.user_role, p.user_id), p)
                for p in db.scalars(
                    select(NotificationPreference).where(
                        NotificationPreference.category == category, NotificationPreference.user_role == role,
                        NotificationPreference.user_id.in_(chunk),
                    )  # fmt: skip
                )
            )
            if with_push:
                for sub_id, sub_role, sub_user in db.execute(
                    select(PushSubscription.subscription_id, PushSubscription.user_role, PushSubscription.user_id).where(
                        PushSubscription.user_role == role, PushSubscription.user_id.in_(chunk)
                    )
                ):
                    subs[(sub_role, sub_user)].append(sub_id)
    return accounts, prefs, subs


def _chunks(ids: list[int], size: int = 500):
    for i in range(0, len(ids), size):
        yield ids[i : i + size]
