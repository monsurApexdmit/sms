import fakeredis
import pytest
from fastapi import BackgroundTasks
from pydantic import ValidationError
from rq import Queue
from sqlalchemy import select

from app.core.config import Settings
from app.db.session import SessionLocal
from app.models import AuditLog
from app.services import jobs, notify, ratelimit

GOOD = {"secret_key": "x" * 64, "cookie_secure": True, "redis_url": "redis://redis:6379/0"}


# --- production settings --------------------------------------------------------


def test_production_accepts_safe_settings():
    assert Settings(environment="production", **GOOD).environment == "production"


@pytest.mark.parametrize(
    "override",
    [
        {"secret_key": "change-me"},
        {"secret_key": "short"},
        {"cookie_secure": False},
        {"redis_url": ""},
    ],
)
def test_production_refuses_unsafe_settings(override):
    with pytest.raises(ValidationError, match="Unsafe production settings"):
        Settings(environment="production", **{**GOOD, **override})


def test_development_allows_defaults():
    Settings(environment="development", secret_key="change-me", cookie_secure=False, redis_url="")


# --- audit log ------------------------------------------------------------------


def _audit(table: str, action: str) -> list[AuditLog]:
    """Rows written by the test itself (the fixture's seed data is audited as inserts)."""
    stmt = select(AuditLog).where(AuditLog.table_name == table, AuditLog.action == action)
    if action == "insert":
        stmt = stmt.where(AuditLog.actor.is_not(None))
    with SessionLocal() as db:
        return list(db.scalars(stmt.order_by(AuditLog.audit_id)))


def test_changes_are_audited_with_actor_and_secrets_hidden(client, as_role):
    admin = as_role("admin")
    r = client.put("/api/settings", headers=admin, json={"system_name": "New Name", "smtp_pass": "hunter2"})
    assert r.status_code == 200, r.text

    (renamed,) = _audit("settings", "update")
    assert renamed.actor == "admin-1"
    assert renamed.changes == '{"description": ["Test School", "New Name"]}'
    (secret,) = _audit("settings", "insert")
    assert secret.actor == "admin-1"
    assert "hunter2" not in secret.changes and '"description": "[hidden]"' in secret.changes


def test_password_upgrade_is_audited_without_the_hash(client):
    client.post("/api/auth/login", json={"email": "admin@example.com", "password": "Secret@123"})
    (row,) = _audit("admin", "update")
    assert row.action == "update" and row.actor is None
    assert row.changes == '{"password": ["[hidden]", "[hidden]"]}'


def test_audit_log_is_admin_only(client, as_role):
    as_role("admin")  # produces an audit row (password upgrade)
    assert client.get("/api/audit-log", headers=as_role("teacher")).status_code == 403
    r = client.get("/api/audit-log", headers=as_role("admin"), params={"table_name": "admin"})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 1 and body["items"][0]["changes"]["password"] == ["[hidden]", "[hidden]"]
    settings = client.get("/api/audit-log", headers=as_role("admin"), params={"actor": "admin-1"}).json()
    assert all(i["actor_name"] == "Admin" for i in settings["items"])


# --- Redis-backed rate limit and job queue ----------------------------------------


@pytest.fixture
def fake_redis(monkeypatch):
    server = fakeredis.FakeRedis()
    monkeypatch.setattr(ratelimit, "get_redis", lambda: server)
    monkeypatch.setattr(jobs, "get_redis", lambda: server)
    return server


def test_login_rate_limit_is_kept_in_redis(client, fake_redis):
    for _ in range(10):
        assert client.post("/api/auth/login", json={"email": "admin@example.com", "password": "bad"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "admin@example.com", "password": "bad"}).status_code == 429
    assert fake_redis.keys("ratelimit:auth:*")
    ratelimit.reset()  # only clears the in-process fallback
    assert client.post("/api/auth/login", json={"email": "admin@example.com", "password": "bad"}).status_code == 429


def test_notifications_go_to_the_queue_with_retries(fake_redis):
    tasks = BackgroundTasks()
    jobs.enqueue(tasks, notify.send_sms, "+15550100", "hello")
    assert not tasks.tasks
    (job,) = Queue(jobs.QUEUE, connection=fake_redis).get_jobs()
    assert job.func_name == "app.services.notify.send_sms"
    assert job.args == ("+15550100", "hello")
    assert job.retries_left == 3


def test_notifications_run_in_process_without_redis():
    tasks = BackgroundTasks()
    jobs.enqueue(tasks, notify.send_sms, "+15550100", "hello")
    assert len(tasks.tasks) == 1


# --- list totals cover every matching row, not just the page ----------------------


def test_invoice_list_pages_searches_and_summarises_all_rows(client, as_role):
    admin = as_role("admin")
    for i, (student, paid) in enumerate([(1, 0), (1, 40), (2, 100), (2, 0), (2, 10)]):
        r = client.post("/api/invoices", headers=admin, json={"student_id": student, "title": f"Fee {i}", "amount": 100, "amount_paid": paid})
        assert r.status_code == 201, r.text

    body = client.get("/api/invoices", headers=admin, params={"limit": 2}).json()
    assert len(body["items"]) == 2 and body["total"] == 5
    assert body["summary"] == {"billed": 500, "collected": 150, "outstanding": 350, "open": 4, "partial": 2}

    second = client.get("/api/invoices", headers=admin, params={"limit": 2, "offset": 2}).json()["items"]
    assert {i["invoice_id"] for i in second}.isdisjoint(i["invoice_id"] for i in body["items"])

    by_student = client.get("/api/invoices", headers=admin, params={"q": "kid two"}).json()
    assert by_student["total"] == 3 and by_student["summary"]["collected"] == 110
    assert client.get("/api/invoices", headers=admin, params={"q": "Fee 3"}).json()["total"] == 1
    assert client.get("/api/invoices", headers=admin, params={"q": "4"}).json()["items"][0]["title"] in {"Fee 3", "Fee 4"}


def test_payment_list_totals_and_date_filter(client, as_role):
    admin = as_role("admin")
    for day, amount in [("2026-01-10", 10), ("2026-02-10", 20), ("2026-03-10", 30)]:
        r = client.post("/api/expenses", headers=admin, json={"title": "Chalk", "amount": amount, "date": day})
        assert r.status_code == 201, r.text

    body = client.get("/api/payments", headers=admin, params={"payment_type": "expense", "limit": 1}).json()
    assert body["total"] == 3 and body["amount_total"] == 60 and len(body["items"]) == 1

    feb = client.get("/api/payments", headers=admin, params={"date_from": "2026-02-01", "date_to": "2026-02-28"}).json()
    assert feb["total"] == 1 and feb["amount_total"] == 20
