import re

from sqlalchemy import select

from app.db.session import SessionLocal
from app.main import app
from app.models import Admin

# Endpoints that are meant to work without logging in.
PUBLIC = {
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/refresh"),
    ("POST", "/api/auth/logout"),
    ("POST", "/api/auth/forgot-password"),
    ("POST", "/api/auth/reset-password"),
    # second sign-in step: authorised by the short-lived mfa_token in the body
    ("POST", "/api/auth/mfa/verify"),
    ("GET", "/api/settings/public"),
    ("GET", "/api/health"),
    ("GET", "/api/health/ready"),
}


def _operations():
    for path, methods in app.openapi()["paths"].items():
        for method in methods:
            yield method.upper(), path


def test_every_private_endpoint_rejects_anonymous_requests(client):
    """Guards the legacy bug class: ~60 controller methods had no login check."""
    checked = 0
    for method, path in _operations():
        if (method, path) in PUBLIC or path.startswith("/api/public/"):
            continue
        url = re.sub(r"\{[^}]+\}", "1", path)
        r = client.request(method, url)
        assert r.status_code in (401, 403), f"{method} {path} answered {r.status_code} without a token"
        checked += 1
    assert checked > 150


def test_legacy_sha1_password_logs_in_and_is_upgraded(client):
    r = client.post("/api/auth/login", json={"email": "admin@example.com", "password": "Secret@123"})
    assert r.status_code == 200
    with SessionLocal() as db:
        stored = db.scalars(select(Admin)).first().password
    assert stored.startswith("$argon2")
    # still works after the upgrade
    assert client.post("/api/auth/login", json={"email": "admin@example.com", "password": "Secret@123"}).status_code == 200


def test_wrong_password_rejected(client):
    r = client.post("/api/auth/login", json={"email": "admin@example.com", "password": "nope"})
    assert r.status_code == 401


def test_refresh_cookie_flow(client):
    client.post("/api/auth/login", json={"email": "t1@example.com", "password": "Secret@123"})
    r = client.post("/api/auth/refresh")
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "teacher"


def test_password_reset_link_is_single_use(client, monkeypatch):
    sent = {}
    monkeypatch.setattr("app.api.routers.auth.send_email", lambda to, subject, body: sent.update(body=body))
    assert client.post("/api/auth/forgot-password", json={"email": "t1@example.com"}).status_code == 202
    token = re.search(r"token=(\S+)", sent["body"]).group(1)
    assert client.post("/api/auth/reset-password", json={"token": token, "new_password": "NewPass@123"}).status_code == 204
    assert client.post("/api/auth/reset-password", json={"token": token, "new_password": "Again@1234"}).status_code == 400
    r = client.post("/api/auth/login", json={"email": "t1@example.com", "password": "NewPass@123"})
    assert r.status_code == 200


def test_forgot_password_does_not_reveal_accounts(client):
    assert client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"}).status_code == 202


def test_role_boundaries(client, as_role):
    student = as_role("student")
    assert client.get("/api/students", headers=student).status_code == 403
    assert client.post("/api/teachers", headers=as_role("teacher"), json={}).status_code == 403
    assert client.get("/api/settings", headers=as_role("teacher")).status_code == 403


def test_student_and_parent_only_see_their_own_records(client, as_role):
    assert client.get("/api/marksheet/1", headers=as_role("student")).status_code == 200
    assert client.get("/api/marksheet/2", headers=as_role("student")).status_code == 403
    parent = as_role("parent")
    assert client.get("/api/marksheet/1", headers=parent).status_code == 200  # own child
    assert client.get("/api/marksheet/2", headers=parent).status_code == 403


def test_script_upload_is_rejected(client, as_role):
    r = client.post(
        "/api/study-materials",
        headers=as_role("teacher"),
        data={"title": "x", "class_id": "1"},
        files={"file": ("shell.php", b"<?php system($_GET['c']); ?>", "application/x-php")},
    )
    assert r.status_code == 400


def test_upload_is_renamed_and_served_only_with_signature(client, as_role):
    r = client.post(
        "/api/study-materials",
        headers=as_role("teacher"),
        data={"title": "Notes", "class_id": "1"},
        files={"file": ("notes.pdf", b"%PDF-1.4 test", "application/pdf")},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["file_name"] != "notes.pdf" and body["file_name"].endswith("_notes.pdf")
    url = body["download_url"]
    assert client.get(url).status_code == 200
    assert client.get(url.replace("sig=", "sig=0")).status_code == 403
    assert client.get("/api/media/document/" + body["file_name"] + "?exp=9999999999&sig=bad").status_code == 403


def test_media_path_traversal_blocked(client):
    from app.core.security import sign_media_path

    url = sign_media_path("../../etc/passwd")
    assert client.get(url).status_code in (400, 404)


def test_emails_unique_across_roles(client, as_role):
    r = client.post(
        "/api/teachers",
        headers=as_role("admin"),
        json={"name": "Dup", "email": "s1@example.com", "password": "Password1!"},
    )
    assert r.status_code == 409


def test_non_admins_get_directory_view_of_teachers(client, as_role):
    from app.db.session import SessionLocal
    from app.models import Teacher

    with SessionLocal() as db:
        db.get(Teacher, 1).birthday = "1990-01-01"
        db.commit()
    student_view = client.get("/api/teachers/1", headers=as_role("student")).json()
    assert student_view["name"] == "Teacher One" and student_view["birthday"] is None
    assert client.get("/api/teachers/1", headers=as_role("admin")).json()["birthday"] == "1990-01-01"
