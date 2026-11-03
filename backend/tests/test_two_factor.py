from datetime import timedelta

import pyotp
import pytest
from sqlalchemy import select

from app.api.routers import mfa as mfa_router
from app.core.security import create_token, password_fingerprint
from app.db.session import SessionLocal
from app.models import AuditLog, Teacher, UserTotp
from app.services import mfa
from tests.conftest import PASSWORD

TEACHER = {"email": "t1@example.com", "password": PASSWORD}


@pytest.fixture
def clock(monkeypatch):
    """Controls the time TOTP codes are checked against; advance with clock[0] += 30."""
    now = [1_800_000_000.0]
    monkeypatch.setattr(mfa, "_now_ts", lambda: now[0])
    return now


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _enable(client, headers, clock) -> tuple[str, list[str]]:
    """Turns 2FA on for the signed-in user; returns (secret, recovery codes)."""
    setup = client.post("/api/auth/mfa/setup", headers=headers)
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    r = client.post("/api/auth/mfa/confirm", headers=headers, json={"code": pyotp.TOTP(secret).at(clock[0])})
    assert r.status_code == 200, r.text
    clock[0] += 30  # the confirming code's time step is now used up
    return secret, r.json()["recovery_codes"]


def _challenge(client) -> dict:
    r = client.post("/api/auth/login", json=TEACHER)
    assert r.status_code == 200, r.text
    return r.json()


def test_enable_and_sign_in_with_code(client, as_role, clock):
    teacher = as_role("teacher")
    assert client.get("/api/auth/mfa", headers=teacher).json()["enabled"] is False

    setup = client.post("/api/auth/mfa/setup", headers=teacher).json()
    assert setup["otpauth_uri"].startswith("otpauth://totp/") and setup["qr"].startswith("data:image/svg+xml;base64,")
    assert client.post("/api/auth/mfa/confirm", headers=teacher, json={"code": "000000"}).status_code == 400
    r = client.post("/api/auth/mfa/confirm", headers=teacher, json={"code": pyotp.TOTP(setup["secret"]).at(clock[0])})
    assert r.status_code == 200 and len(r.json()["recovery_codes"]) == 10 and r.json()["session"] is None
    clock[0] += 30

    status = client.get("/api/auth/mfa", headers=teacher).json()
    assert status["enabled"] and status["recovery_codes_left"] == 10
    assert client.post("/api/auth/mfa/setup", headers=teacher).status_code == 409

    # the secret is encrypted at rest
    with SessionLocal() as db:
        row = db.scalars(select(UserTotp)).one()
        assert setup["secret"] not in row.secret_encrypted and mfa.decrypt_secret(row.secret_encrypted) == setup["secret"]

    challenge = _challenge(client)
    assert challenge["mfa_required"] is True and "access_token" not in challenge
    # the challenge token is not a session
    assert client.get("/api/auth/me", headers=_bearer(challenge["mfa_token"])).status_code == 401
    wrong = client.post("/api/auth/mfa/verify", json={"mfa_token": challenge["mfa_token"], "code": "123456"})
    assert wrong.status_code == 401
    ok = client.post("/api/auth/mfa/verify", json={"mfa_token": challenge["mfa_token"], "code": pyotp.TOTP(setup["secret"]).at(clock[0])})
    assert ok.status_code == 200, ok.text
    assert client.get("/api/auth/me", headers=_bearer(ok.json()["access_token"])).json()["email"] == "t1@example.com"
    assert client.post("/api/auth/refresh").status_code == 200  # refresh cookie issued after the second step


def test_code_cannot_be_replayed(client, as_role, clock):
    secret, _ = _enable(client, as_role("teacher"), clock)
    code = pyotp.TOTP(secret).at(clock[0])
    assert client.post("/api/auth/mfa/verify", json={"mfa_token": _challenge(client)["mfa_token"], "code": code}).status_code == 200
    assert client.post("/api/auth/mfa/verify", json={"mfa_token": _challenge(client)["mfa_token"], "code": code}).status_code == 401
    # neither can an older code inside the window
    previous = pyotp.TOTP(secret).at(clock[0] - 30)
    assert client.post("/api/auth/mfa/verify", json={"mfa_token": _challenge(client)["mfa_token"], "code": previous}).status_code == 401
    clock[0] += 30
    fresh = pyotp.TOTP(secret).at(clock[0])
    assert client.post("/api/auth/mfa/verify", json={"mfa_token": _challenge(client)["mfa_token"], "code": fresh}).status_code == 200


def test_recovery_code_is_single_use(client, as_role, clock):
    _, codes = _enable(client, as_role("teacher"), clock)
    token = _challenge(client)["mfa_token"]
    assert client.post("/api/auth/mfa/verify", json={"mfa_token": token, "recovery_code": codes[0].upper()}).status_code == 200
    token = _challenge(client)["mfa_token"]
    assert client.post("/api/auth/mfa/verify", json={"mfa_token": token, "recovery_code": codes[0]}).status_code == 401
    assert client.post("/api/auth/mfa/verify", json={"mfa_token": token, "recovery_code": codes[1]}).status_code == 200
    headers = as_role("admin")  # anyone signed in sees only their own status
    assert client.get("/api/auth/mfa", headers=headers).json()["enabled"] is False


def test_regenerate_recovery_codes(client, as_role, clock):
    teacher = as_role("teacher")
    secret, old = _enable(client, teacher, clock)
    assert client.post("/api/auth/mfa/recovery-codes", headers=teacher, json={"code": "111111"}).status_code == 400
    r = client.post("/api/auth/mfa/recovery-codes", headers=teacher, json={"code": pyotp.TOTP(secret).at(clock[0])})
    assert r.status_code == 200 and set(r.json()["recovery_codes"]).isdisjoint(old)
    token = _challenge(client)["mfa_token"]
    assert client.post("/api/auth/mfa/verify", json={"mfa_token": token, "recovery_code": old[0]}).status_code == 401


def test_challenge_token_expiry_kind_and_password_change(client, as_role, clock):
    secret, _ = _enable(client, as_role("teacher"), clock)
    code = pyotp.TOTP(secret).at(clock[0])
    with SessionLocal() as db:
        fp = password_fingerprint(db.get(Teacher, 1).password)
    expired = create_token(role="teacher", user_id=1, fp=fp, kind="mfa", lifetime=timedelta(seconds=-1))
    assert client.post("/api/auth/mfa/verify", json={"mfa_token": expired, "code": code}).status_code == 401
    access = create_token(role="teacher", user_id=1, fp=fp, kind="access", lifetime=timedelta(minutes=5))
    assert client.post("/api/auth/mfa/verify", json={"mfa_token": access, "code": code}).status_code == 401
    stale = create_token(role="teacher", user_id=1, fp="old-password", kind="mfa", lifetime=timedelta(minutes=5))
    assert client.post("/api/auth/mfa/verify", json={"mfa_token": stale, "code": code}).status_code == 401
    assert client.post("/api/auth/mfa/verify", json={"mfa_token": _challenge(client)["mfa_token"]}).status_code == 422


def test_forced_enrollment_token_only_reaches_setup(client, as_role, clock):
    admin = as_role("admin")
    assert client.put("/api/settings", headers=admin, json={"mfa_required_roles": "teacher, wizard"}).status_code == 422
    assert client.put("/api/settings", headers=admin, json={"mfa_required_roles": "teacher,accountant"}).status_code == 200

    challenge = _challenge(client)
    assert challenge["mfa_required"] is False and challenge["enroll_required"] is True
    enroll = _bearer(challenge["mfa_token"])
    for method, path in (
        ("GET", "/api/auth/me"), ("GET", "/api/auth/mfa"), ("GET", "/api/students?class_id=1"),
        ("GET", "/api/notifications/unread-count"), ("PUT", "/api/settings"), ("GET", "/api/homework"),
        ("POST", "/api/auth/mfa/recovery-codes"), ("POST", "/api/auth/mfa/disable"),
    ):  # fmt: skip
        assert client.request(method, path, headers=enroll).status_code == 401, path
    assert client.post("/api/auth/mfa/verify", json={"mfa_token": challenge["mfa_token"], "code": "123456"}).status_code == 401

    setup = client.post("/api/auth/mfa/setup", headers=enroll)
    assert setup.status_code == 200
    r = client.post("/api/auth/mfa/confirm", headers=enroll, json={"code": pyotp.TOTP(setup.json()["secret"]).at(clock[0])})
    assert r.status_code == 200
    session = r.json()["session"]
    assert session and client.get("/api/auth/me", headers=_bearer(session["access_token"])).status_code == 200
    # from now on the normal second step applies
    assert _challenge(client)["mfa_required"] is True
    # and a required role cannot switch it off
    me = _bearer(session["access_token"])
    assert client.post("/api/auth/mfa/disable", headers=me, json={"password": PASSWORD, "code": "000000"}).status_code == 409


def test_disable_needs_password_and_code(client, as_role, clock):
    teacher = as_role("teacher")
    secret, codes = _enable(client, teacher, clock)
    code = pyotp.TOTP(secret).at(clock[0])
    assert client.post("/api/auth/mfa/disable", headers=teacher, json={"password": "wrong", "code": code}).status_code == 400
    assert client.post("/api/auth/mfa/disable", headers=teacher, json={"password": PASSWORD, "code": "000000"}).status_code == 400
    assert client.post("/api/auth/mfa/disable", headers=teacher, json={"password": PASSWORD, "code": codes[0]}).status_code == 204
    assert "access_token" in _challenge(client)


def test_admin_reset_is_audited_without_the_secret(client, as_role, clock):
    secret, _ = _enable(client, as_role("teacher"), clock)
    assert client.get("/api/auth/mfa/users", headers=as_role("teacher2")).status_code == 403
    listed = client.get("/api/auth/mfa/users", headers=as_role("admin")).json()
    assert [(u["role"], u["user_id"], u["email"]) for u in listed] == [("teacher", 1, "t1@example.com")]
    assert client.delete("/api/auth/mfa/users/teacher/1", headers=as_role("teacher2")).status_code == 403
    assert client.delete("/api/auth/mfa/users/wizard/1", headers=as_role("admin")).status_code == 422
    assert client.delete("/api/auth/mfa/users/teacher/1", headers=as_role("admin")).status_code == 204
    assert client.delete("/api/auth/mfa/users/teacher/1", headers=as_role("admin")).status_code == 404
    assert "access_token" in _challenge(client)
    with SessionLocal() as db:
        rows = db.scalars(select(AuditLog).where(AuditLog.table_name == "user_totp")).all()
    changes = [r.changes for r in rows]
    deleted = [r for r in rows if r.action == "delete"]
    assert len(deleted) == 1 and deleted[0].actor == "admin-1"
    assert all(secret not in c for c in changes)
    assert all('"secret_encrypted": "[hidden]"' in c or "secret_encrypted" not in c for c in changes)
    assert '"recovery_codes": "[hidden]"' in deleted[0].changes


def test_verification_is_rate_limited(client, as_role, clock):
    secret, _ = _enable(client, as_role("teacher"), clock)
    token = _challenge(client)["mfa_token"]
    for _ in range(mfa_router.MAX_ATTEMPTS):
        assert client.post("/api/auth/mfa/verify", json={"mfa_token": token, "code": "000000"}).status_code == 401
    good = pyotp.TOTP(secret).at(clock[0])
    assert client.post("/api/auth/mfa/verify", json={"mfa_token": token, "code": good}).status_code == 429
