import re
from datetime import date

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Notification, Parent, Setting
from app.services import notify as delivery
from app.services.messages import CATALOG, LANGS, msg, normalize, short_date

PLACEHOLDER = re.compile(r"\{(\w+)\}")


def test_every_message_has_every_language_with_the_same_placeholders():
    for key, texts in CATALOG.items():
        assert set(texts) == set(LANGS), key
        assert all(texts.values()), key
        assert {sorted(PLACEHOLDER.findall(t)).__repr__() for t in texts.values()} == {sorted(PLACEHOLDER.findall(texts["en"])).__repr__()}, key


def test_language_setting_values():
    assert normalize("english") == "en"
    assert normalize("bengali") == "bn"  # the old app's language file name
    assert normalize("Bangla") == "bn"
    assert normalize(None) == "en"
    assert normalize("arabic") == "en"  # no catalog yet: English


def test_msg_and_dates():
    assert msg("en", "attendance.absent.title", name="Rina") == "Rina is absent"
    assert msg("bn", "attendance.absent.title", name="Rina") == "Rina অনুপস্থিত"
    assert msg("xx", "attendance.absent.title", name="Rina") == "Rina is absent"
    assert short_date("en", date(2026, 3, 4)) == "04 Mar 2026"
    assert short_date("bn", date(2026, 3, 4)) == "04 মার্চ 2026"


@pytest.fixture
def bangla():
    with SessionLocal() as db:
        db.add(Setting(type="language", description="bengali"))
        db.add(Setting(type="active_sms_service", description="twilio"))
        db.get(Parent, 1).phone = "+15550100"
        db.commit()


def test_absence_and_leave_messages_follow_the_school_language(client, as_role, monkeypatch, bangla):
    texts = []
    monkeypatch.setattr(delivery, "send_sms", lambda phone, text: texts.append(text))
    monkeypatch.setattr(delivery, "send_email", lambda *a: None)
    admin = as_role("admin")

    sheet = client.get("/api/attendance/sheet", headers=admin, params={"class_id": 1, "section_id": 1, "date": "2026-03-10"}).json()
    items = [{"attendance_id": r["attendance_id"], "status": 2} for r in sheet]
    client.put("/api/attendance/sheet", headers=admin, json={"class_id": 1, "section_id": 1, "date": "2026-03-10", "items": items})
    assert texts[-1] == "আপনার সন্তান Kid One আজ (2026-03-10) অনুপস্থিত।"

    leave = client.post(
        "/api/leave", headers=as_role("parent"),
        json={"student_id": 1, "kind": "sick", "from_date": "2026-03-02", "to_date": "2026-03-03", "reason": "Flu"},
    ).json()  # fmt: skip
    client.post(f"/api/leave/{leave['leave_id']}/decision", headers=admin, json={"approve": False, "note": "Exam week"})
    with SessionLocal() as db:
        titles = list(db.scalars(select(Notification.title).where(Notification.recipient_role == "parent")))
    assert "ছুটির আবেদন প্রত্যাখ্যাত" in titles
    # SMS without its own text: "<title>: <text>"
    assert texts[-1] == "ছুটির আবেদন প্রত্যাখ্যাত: Kid One-এর ছুটি (2026-03-02 থেকে 2026-03-03) প্রত্যাখ্যাত হয়েছে। নোট: Exam week"
