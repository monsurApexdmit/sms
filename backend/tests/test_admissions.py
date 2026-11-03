from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import AdmissionApplication, Enroll, Parent, Student
from tests.conftest import YEAR

FORM = {
    "class_id": "1",
    "student_name": "New Kid",
    "date_of_birth": "2015-04-02",
    "gender": "female",
    "guardian_name": "Rina Guardian",
    "guardian_relation": "Mother",
    "guardian_phone": "+880 1711-000111",
    "guardian_email": "rina@example.com",
    "address": "12 Lake Road",
}


@pytest.fixture
def outbox(monkeypatch):
    mails: list[tuple[str, str, str]] = []
    fake = lambda to, subject, body: mails.append((to, subject, body))  # noqa: E731
    monkeypatch.setattr("app.api.routers.admissions.send_email", fake)
    monkeypatch.setattr("app.services.notify.send_email", fake)  # status emails go through notifications
    return mails


@pytest.fixture
def opened(client, as_role):
    r = client.put("/api/admissions/settings", headers=as_role("admin"), json={"open": True, "year": YEAR})
    assert r.status_code == 200, r.text


def _apply(client, files=None, **overrides):
    return client.post("/api/public/admissions", data={**FORM, **overrides}, files=files or [])


# --- public form ----------------------------------------------------------------------


def test_applications_closed_by_default(client):
    assert client.get("/api/public/admissions/options").json() == {"open": False, "year": YEAR, "classes": []}
    assert _apply(client).status_code == 403


def test_public_application_with_documents(client, as_role, opened, outbox):
    options = client.get("/api/public/admissions/options").json()
    assert options["open"] and options["classes"] == [{"class_id": 1, "name": "Ten"}]

    files = [("files", ("birth.pdf", b"%PDF-1.4 test", "application/pdf")), ("files", ("photo.png", b"png", "image/png"))]
    r = client.post("/api/public/admissions", data={**FORM, "labels": ["Birth certificate", "Photo"]}, files=files)
    assert r.status_code == 201, r.text
    ref = r.json()["reference"]
    assert r.json()["status"] == "new" and ref.startswith("A25-")
    assert outbox[0][0] == "rina@example.com" and ref in outbox[0][2]

    admin = as_role("admin")
    listed = client.get("/api/admissions", headers=admin, params={"q": "New Kid"}).json()
    assert listed["total"] == 1 and listed["items"][0]["document_count"] == 2
    detail = client.get(f"/api/admissions/{listed['items'][0]['application_id']}", headers=admin).json()
    assert [d["label"] for d in detail["documents"]] == ["Birth certificate", "Photo"]
    assert detail["documents"][0]["url"].startswith("/api/media/admission_document/")
    assert detail["source"] == "online" and detail["class_name"] == "Ten"


def test_public_application_rejects_bad_input(client, opened):
    assert _apply(client, files=[("files", ("evil.php", b"<?php", "text/plain"))]).status_code == 400
    assert _apply(client, guardian_email="not-an-email").status_code == 422
    assert _apply(client, class_id="99").status_code == 422
    assert _apply(client, guardian_phone="").status_code == 422
    with SessionLocal() as db:
        assert db.scalars(select(AdmissionApplication)).all() == []


def test_public_application_rate_limit(client, opened):
    codes = [_apply(client).status_code for _ in range(6)]
    assert codes == [201] * 5 + [429]


def test_public_application_recaptcha(client, as_role, opened, monkeypatch):
    client.put("/api/cms/settings", headers=as_role("admin"), json={"recaptcha_secret_key": "s3cret"})

    def fake_post(url, data=None, timeout=None):
        return httpx.Response(200, json={"success": data["response"] == "good"}, request=httpx.Request("POST", url))

    monkeypatch.setattr("app.api.routers.cms.httpx.post", fake_post)
    assert _apply(client).status_code == 400
    assert _apply(client, recaptcha_token="bad").status_code == 400
    assert _apply(client, recaptcha_token="good").status_code == 201


def test_status_lookup_needs_matching_phone(client, opened):
    ref = _apply(client).json()["reference"]
    r = client.post("/api/public/admissions/status", json={"reference": ref.lower(), "phone": "8801711000111"})
    assert r.status_code == 200
    assert set(r.json()) == {"reference", "status", "status_label", "updated_at"}
    assert r.json()["status_label"] == "Received"

    wrong = client.post("/api/public/admissions/status", json={"reference": ref, "phone": "01711999999"})
    unknown = client.post("/api/public/admissions/status", json={"reference": "A25-000000", "phone": "8801711000111"})
    assert wrong.status_code == unknown.status_code == 404
    assert wrong.json() == unknown.json()
    assert "New Kid" not in wrong.text and "Rina" not in wrong.text


# --- office ---------------------------------------------------------------------------


def _office_application(client, admin, **overrides) -> dict:
    body = {**{k: v for k, v in FORM.items() if k != "class_id"}, "class_id": 1, **overrides}
    r = client.post("/api/admissions", headers=admin, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_office_actions_are_admin_only(client, as_role):
    admin = as_role("admin")
    app_id = _office_application(client, admin)["application_id"]
    teacher = as_role("teacher")
    assert client.get("/api/admissions", headers=teacher).status_code == 403
    assert client.get("/api/enquiries", headers=as_role("parent")).status_code == 403
    assert client.post(f"/api/admissions/{app_id}/status", headers=teacher, json={"status": "accepted"}).status_code == 403
    assert client.put("/api/admissions/settings", headers=teacher, json={"open": True, "year": YEAR}).status_code == 403


def test_status_change_emails_guardian(client, as_role, outbox):
    admin = as_role("admin")
    app_id = _office_application(client, admin)["application_id"]
    r = client.post(f"/api/admissions/{app_id}/status", headers=admin, json={"status": "reviewing"})
    assert r.status_code == 200 and outbox == []
    r = client.post(f"/api/admissions/{app_id}/status", headers=admin, json={"status": "accepted", "note": "Bring the original certificates."})
    assert r.json()["status"] == "accepted" and r.json()["reviewed_by"] == "admin-1"
    (to, subject, body) = outbox[0]
    assert to == "rina@example.com" and "accepted" in body and "original certificates" in body


def test_enroll_creates_accounts_with_next_roll(client, as_role):
    admin = as_role("admin")
    app_id = _office_application(client, admin)["application_id"]
    enroll = {"section_id": 1, "student_email": "newkid@example.com", "student_password": "Secret@123",
              "parent_email": "rina@example.com", "parent_password": "Secret@123"}  # fmt: skip
    assert client.post(f"/api/admissions/{app_id}/enroll", headers=admin, json=enroll).status_code == 409  # not accepted yet
    client.post(f"/api/admissions/{app_id}/status", headers=admin, json={"status": "accepted", "notify": False})

    r = client.post(f"/api/admissions/{app_id}/enroll", headers=admin, json=enroll)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "enrolled" and out["student_id"] and out["parent_id"]
    with SessionLocal() as db:
        student = db.get(Student, out["student_id"])
        assert student.name == "New Kid" and student.parent_id == out["parent_id"] and student.birthday == "2015-04-02"
        assert db.get(Parent, out["parent_id"]).phone == FORM["guardian_phone"]
        row = db.scalars(select(Enroll).where(Enroll.student_id == student.student_id)).one()
        assert (row.class_id, row.section_id, row.roll, row.year) == (1, 1, 3, YEAR)  # rolls 1 and 2 are taken

    # the new accounts can log in
    assert client.post("/api/auth/login", json={"email": "newkid@example.com", "password": "Secret@123"}).status_code == 200
    # enrolled applications are closed
    assert client.post(f"/api/admissions/{app_id}/enroll", headers=admin, json=enroll).status_code == 409
    assert client.post(f"/api/admissions/{app_id}/status", headers=admin, json={"status": "new"}).status_code == 409


def test_enroll_links_existing_parent_and_checks_section(client, as_role):
    admin = as_role("admin")
    with SessionLocal() as db:
        from app.models import Section

        db.add(Section(name="B-other", class_id=2))
        db.commit()
    app_id = _office_application(client, admin)["application_id"]
    client.post(f"/api/admissions/{app_id}/status", headers=admin, json={"status": "accepted", "notify": False})
    base = {"student_email": "kid3@example.com", "student_password": "Secret@123"}
    assert client.post(f"/api/admissions/{app_id}/enroll", headers=admin, json={**base, "section_id": 2}).status_code == 422
    taken = {**base, "student_email": "t1@example.com", "section_id": 1}
    assert client.post(f"/api/admissions/{app_id}/enroll", headers=admin, json=taken).status_code == 409
    r = client.post(f"/api/admissions/{app_id}/enroll", headers=admin, json={**base, "section_id": 1, "roll": 7, "parent_email": "P@example.com"})
    assert r.status_code == 200, r.text
    assert r.json()["parent_id"] == 1  # the existing parent account
    with SessionLocal() as db:
        assert db.scalars(select(Enroll.roll).where(Enroll.student_id == r.json()["student_id"])).one() == 7


# --- enquiries ------------------------------------------------------------------------


def test_enquiry_follow_up_and_convert(client, as_role):
    admin = as_role("admin")
    today = date.today()
    due = client.post("/api/enquiries", headers=admin, json={"name": "Karim", "phone": "01711222333", "class_id": 1, "follow_up_on": (today - timedelta(days=1)).isoformat()}).json()
    client.post("/api/enquiries", headers=admin, json={"name": "Later", "phone": "01711444555", "follow_up_on": (today + timedelta(days=5)).isoformat()})
    client.post("/api/enquiries", headers=admin, json={"name": "No phone"})

    due_list = client.get("/api/enquiries", headers=admin, params={"due": True}).json()
    assert [e["name"] for e in due_list["items"]] == ["Karim"]

    r = client.post(f"/api/enquiries/{due['enquiry_id']}/convert", headers=admin, json={"student_name": "Karim Jr"})
    assert r.status_code == 201, r.text
    application = r.json()
    assert application["source"] == "enquiry" and application["guardian_name"] == "Karim" and application["class_id"] == 1
    enquiry = client.get("/api/enquiries", headers=admin, params={"status": "converted"}).json()["items"][0]
    assert enquiry["application_id"] == application["application_id"]
    assert client.post(f"/api/enquiries/{due['enquiry_id']}/convert", headers=admin, json={"student_name": "Again"}).status_code == 409

    no_phone = client.get("/api/enquiries", headers=admin, params={"q": "No phone"}).json()["items"][0]
    assert client.post(f"/api/enquiries/{no_phone['enquiry_id']}/convert", headers=admin, json={"student_name": "X", "class_id": 1}).status_code == 422
