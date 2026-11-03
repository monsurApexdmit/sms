from datetime import timedelta

import httpx
import pytest
from fastapi import BackgroundTasks
from pywebpush import WebPushException
from sqlalchemy import select

from app.api.routers.homework import school_today
from app.db.session import SessionLocal
from app.models import Notification, Parent, PushSubscription, Setting, Student
from app.services import notifications as svc
from app.services import notify as delivery
from app.services.notifications import Recipient, notify, user

SUB = {"endpoint": "https://push.example.com/abc", "keys": {"p256dh": "BPk", "auth": "xyz"}}


def _run(*recipients, category="attendance", **kw) -> list[tuple[str, tuple]]:
    """Call notify and return the queued jobs as (function name, args)."""
    tasks = BackgroundTasks()
    with SessionLocal() as db:
        notify(db, tasks, recipients, category, "Title", "Body", "/app/x", **kw)
    return [(t.args[0].__name__, t.args[1:]) for t in tasks.tasks]


def _in_app(role: str, user_id: int) -> list[Notification]:
    with SessionLocal() as db:
        return list(db.scalars(select(Notification).where(Notification.recipient_role == role, Notification.recipient_id == user_id)))


@pytest.fixture
def sms_on():
    with SessionLocal() as db:
        db.add(Setting(type="active_sms_service", description="twilio"))
        db.get(Parent, 1).phone = "+15550100"
        db.get(Student, 1).phone = "+15550100"  # shares the parent's phone
        db.commit()


# --- notify -------------------------------------------------------------------------------


def test_defaults_keep_the_old_channels(sms_on):
    # attendance: in-app + SMS (absence alerts were texted, not emailed)
    assert _run(user("parent", 1)) == [("send_sms", ("+15550100", "Title: Body"))]
    (row,) = _in_app("parent", 1)
    assert (row.title, row.body, row.link, row.read_at) == ("Title", "Body", "/app/x", None)
    # homework: in-app + email
    assert [name for name, _ in _run(user("parent", 1), category="homework")] == ["send_email"]
    # a per-call default replaces the category default
    assert _run(user("parent", 1), category="leave", defaults={"email"}) == [("send_email", ("p@example.com", "Title", "Body"))]


def test_preferences_override_defaults(client, as_role, sms_on):
    parent = as_role("parent")
    prefs = client.get("/api/notifications/preferences", headers=parent).json()
    attendance = next(i for i in prefs["items"] if i["category"] == "attendance")
    assert (attendance["in_app"], attendance["sms"], attendance["email"]) == (True, True, False)
    assert prefs["available"]["sms"] is True and prefs["available"]["push"] is False

    body = {"items": [{**attendance, "in_app": False, "sms": False, "email": True}]}
    assert client.put("/api/notifications/preferences", headers=parent, json=body).status_code == 200
    assert _run(user("parent", 1)) == [("send_email", ("p@example.com", "Title", "Body"))]
    assert _in_app("parent", 1) == []
    bad = {"items": [{**attendance, "category": "nope"}]}
    assert client.put("/api/notifications/preferences", headers=parent, json=bad).status_code == 422


def test_each_phone_and_address_once_and_contacts_without_account(sms_on):
    jobs = _run(user("parent", 1), user("student", 1), user("parent", 1), None)
    assert jobs == [("send_sms", ("+15550100", "Title: Body"))]  # shared phone texted once
    assert len(_in_app("parent", 1)) == 1 and len(_in_app("student", 1)) == 1

    jobs = _run(Recipient(email="applicant@example.com"), category="admissions")
    assert jobs == [("send_email", ("applicant@example.com", "Title", "Body"))]
    with SessionLocal() as db:
        assert db.scalars(select(Notification).where(Notification.category == "admissions")).all() == []


# --- in-app API ---------------------------------------------------------------------------


def test_only_own_notifications(client, as_role):
    _run(user("parent", 1), user("parent", 1), category="notices")  # one row (same recipient twice)
    _run(user("parent", 1), category="fees")
    _run(user("teacher", 1), category="notices")
    parent, teacher = as_role("parent"), as_role("teacher")

    assert client.get("/api/notifications/unread-count", headers=parent).json() == {"count": 2}
    items = client.get("/api/notifications", headers=parent).json()
    assert items["total"] == 2
    first = items["items"][0]["notification_id"]
    assert client.post(f"/api/notifications/{first}/read", headers=teacher).status_code == 404
    assert client.post(f"/api/notifications/{first}/read", headers=parent).status_code == 204
    assert client.get("/api/notifications/unread-count", headers=parent).json() == {"count": 1}
    listed = client.get("/api/notifications", headers=parent).json()["items"]
    assert listed[0]["read_at"] is None and listed[1]["read_at"] is not None  # unread first
    assert client.get("/api/notifications", headers=parent, params={"unread_only": True}).json()["total"] == 1
    assert client.get("/api/notifications", headers=parent, params={"category": "fees"}).json()["total"] == 1

    assert client.post("/api/notifications/read-all", headers=parent).json() == {"updated": 1}
    assert client.get("/api/notifications/unread-count", headers=teacher).json() == {"count": 1}
    assert client.get("/api/notifications/unread-count").status_code == 401


# --- web push -----------------------------------------------------------------------------


def test_push_keys_subscriptions_and_gone_endpoints(client, as_role, monkeypatch):
    admin, parent = as_role("admin"), as_role("parent")
    assert client.get("/api/notifications/push/public-key", headers=parent).json() == {"public_key": None}
    assert client.post("/api/notifications/settings/vapid", headers=parent).status_code == 403
    settings = client.post("/api/notifications/settings/vapid", headers=admin).json()
    assert settings["vapid_private_key"] == "********" and len(settings["vapid_public_key"]) > 80
    assert client.get("/api/notifications/push/public-key", headers=parent).json()["public_key"] == settings["vapid_public_key"]

    assert client.post("/api/notifications/push/subscribe", headers=parent, json={**SUB, "endpoint": "http://x"}).status_code == 422
    assert client.post("/api/notifications/push/subscribe", headers=parent, json=SUB).status_code == 204
    assert client.post("/api/notifications/push/subscribe", headers=parent, json=SUB).status_code == 204  # idempotent
    jobs = _run(user("parent", 1), category="meetings")
    (push,) = [args for name, args in jobs if name == "send_push"]
    assert '"title": "Title"' in push[1]

    calls = []
    monkeypatch.setattr(svc, "webpush", lambda info, **kw: calls.append((info, kw)))
    svc.send_push(*push)
    assert calls[0][0] == {"endpoint": SUB["endpoint"], "keys": SUB["keys"]} and calls[0][1]["vapid_claims"]["sub"].startswith("mailto:")
    with SessionLocal() as db:
        assert db.scalars(select(PushSubscription)).one().last_success_at is not None

    def gone(info, **kw):
        raise WebPushException("gone", response=httpx.Response(410))

    monkeypatch.setattr(svc, "webpush", gone)
    svc.send_push(*push)
    with SessionLocal() as db:
        assert db.scalars(select(PushSubscription)).all() == []

    # another user cannot remove someone else's subscription
    client.post("/api/notifications/push/subscribe", headers=parent, json=SUB)
    client.post("/api/notifications/push/unsubscribe", headers=as_role("teacher"), json={"endpoint": SUB["endpoint"]})
    with SessionLocal() as db:
        assert len(db.scalars(select(PushSubscription)).all()) == 1
    client.post("/api/notifications/push/unsubscribe", headers=parent, json={"endpoint": SUB["endpoint"]})
    with SessionLocal() as db:
        assert db.scalars(select(PushSubscription)).all() == []


def test_push_failure_other_than_gone_is_retried(client, as_role, monkeypatch):
    client.post("/api/notifications/settings/vapid", headers=as_role("admin"))
    client.post("/api/notifications/push/subscribe", headers=as_role("parent"), json=SUB)
    with SessionLocal() as db:
        sub_id = db.scalars(select(PushSubscription.subscription_id)).one()

    def boom(info, **kw):
        raise WebPushException("server error", response=httpx.Response(500))

    monkeypatch.setattr(svc, "webpush", boom)
    with pytest.raises(WebPushException):
        svc.send_push(sub_id, "{}")


# --- WhatsApp ---------------------------------------------------------------------------------


def test_whatsapp_skipped_until_configured_then_sent(client, as_role, monkeypatch, sms_on):
    posts = []
    monkeypatch.setattr(svc.httpx, "post", lambda url, **kw: posts.append((url, kw)) or httpx.Response(200, request=httpx.Request("POST", url)))
    svc.send_whatsapp("+1 555-0100", "hi")
    assert posts == []

    admin = as_role("admin")
    r = client.put("/api/notifications/settings", headers=admin, json={"whatsapp_token": "tok", "whatsapp_phone_number_id": "123"})
    assert r.json()["whatsapp_token"] == "********"
    client.put("/api/notifications/settings", headers=admin, json={"whatsapp_token": "********", "whatsapp_template": "alert"})
    svc.send_whatsapp("+1 555-0100", "hi")
    url, kw = posts[0]
    assert url.endswith("/123/messages") and kw["headers"]["Authorization"] == "Bearer tok"
    assert kw["json"]["to"] == "15550100" and kw["json"]["template"]["name"] == "alert"
    assert kw["json"]["template"]["components"][0]["parameters"][0]["text"] == "hi"

    parent = as_role("parent")
    attendance = next(i for i in client.get("/api/notifications/preferences", headers=parent).json()["items"] if i["category"] == "attendance")
    client.put("/api/notifications/preferences", headers=parent, json={"items": [{**attendance, "whatsapp": True, "sms": False}]})
    assert _run(user("parent", 1)) == [("send_whatsapp", ("+15550100", "Title: Body"))]
    assert client.get("/api/notifications/settings", headers=parent).status_code == 403


# --- existing features now notify in the app ------------------------------------------------


def test_leave_decision_and_absence_reach_the_parent_in_app(client, as_role, monkeypatch, sms_on):
    texts = []
    monkeypatch.setattr(delivery, "send_sms", lambda phone, text: texts.append((phone, text)))
    monkeypatch.setattr(delivery, "send_email", lambda *a: None)
    leave = client.post(
        "/api/leave", headers=as_role("parent"),
        json={"student_id": 1, "kind": "sick", "from_date": "2026-03-02", "to_date": "2026-03-03", "reason": "Flu"},
    ).json()  # fmt: skip
    client.post(f"/api/leave/{leave['leave_id']}/decision", headers=as_role("admin"), json={"approve": True})
    assert [n.title for n in _in_app("parent", 1)] == ["Leave request approved"]
    assert texts and "approved" in texts[0][1]

    admin = as_role("admin")
    sheet = client.get("/api/attendance/sheet", headers=admin, params={"class_id": 1, "section_id": 1, "date": "2026-03-10"}).json()
    items = [{"attendance_id": r["attendance_id"], "status": 2} for r in sheet]
    client.put("/api/attendance/sheet", headers=admin, json={"class_id": 1, "section_id": 1, "date": "2026-03-10", "items": items})
    titles = [n.title for n in _in_app("parent", 1)]
    assert "Kid One is absent" in titles
    assert texts[-1] == ("+15550100", "Your child Kid One is absent today (2026-03-10).")


def test_graded_homework_notifies_parent_and_student(client, as_role, monkeypatch):
    mails = []
    monkeypatch.setattr(delivery, "send_email", lambda *a: mails.append(a))
    teacher = as_role("teacher")
    due = (school_today() + timedelta(days=7)).isoformat()
    hw = client.post("/api/homework", headers=teacher, data={"title": "Algebra", "class_id": "1", "subject_id": "1", "due_date": due, "max_marks": "10"})
    sub = client.post(f"/api/homework/{hw.json()['homework_id']}/submission", headers=as_role("student"), data={"text": "x = 2"}).json()
    client.put(f"/api/homework/submissions/{sub['submission_id']}/grade", headers=teacher, json={"marks": 9})
    assert [n.title for n in _in_app("parent", 1)] == ["Homework graded: Algebra"]
    assert [n.title for n in _in_app("student", 1)] == ["Homework graded: Algebra"]
    assert [m[0] for m in mails] == ["p@example.com"]  # the student is not emailed
