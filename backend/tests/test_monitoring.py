import json
import logging
import time

import sentry_sdk

from app.api.v1.endpoints import health
from app.core import monitoring
from app.core.config import get_settings


def test_ready_reports_each_dependency(client):
    r = client.get("/api/health/ready")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "checks": {"database": "ok", "redis": "not configured"}}


def test_ready_is_503_when_a_dependency_fails(client, monkeypatch):
    def broken():
        raise OSError("connection refused")

    monkeypatch.setattr(health, "_check_database", broken)
    r = client.get("/api/health/ready")
    assert r.status_code == 503 and r.json()["checks"]["database"] == "error"


def test_ready_times_out_instead_of_hanging(client, monkeypatch):
    monkeypatch.setattr(health, "READY_TIMEOUT", 0.2)
    monkeypatch.setattr(health, "_check_database", lambda: time.sleep(2))
    started = time.monotonic()
    r = client.get("/api/health/ready")
    assert r.status_code == 503 and r.json()["checks"]["database"] == "timeout"
    assert time.monotonic() - started < 1.5


def test_scrub_event_removes_personal_data():
    event = {
        "request": {
            "url": "https://school.test/api/students",
            "data": '{"name": "Kid One"}',
            "cookies": {"sms_refresh": "token"},
            "query_string": "q=Kid",
            "headers": {"Authorization": "Bearer abc", "Cookie": "x", "X-Device-Key": "k", "User-Agent": "UA"},
        },
        "user": {"email": "p@example.com"},
    }
    out = monitoring.scrub_event(event)
    assert set(out["request"]) == {"url", "headers"}
    assert out["request"]["headers"] == {"Authorization": "[removed]", "Cookie": "[removed]", "X-Device-Key": "[removed]", "User-Agent": "UA"}
    assert "user" not in out


def test_json_log_format():
    record = logging.LogRecord("notify", logging.WARNING, __file__, 1, "sent %s", ("x",), None)
    entry = json.loads(monitoring.JsonFormatter().format(record))
    assert entry["level"] == "WARNING" and entry["logger"] == "notify" and entry["message"] == "sent x"


def test_sentry_only_starts_with_a_dsn(monkeypatch):
    calls = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: calls.append(kw))
    monkeypatch.setattr(sentry_sdk, "set_tag", lambda *a: None)
    assert monitoring.init_sentry("api") is False and calls == []

    monkeypatch.setenv("SENTRY_DSN", "https://key@sentry.example/1")
    get_settings.cache_clear()
    try:
        assert monitoring.init_sentry("worker") is True
    finally:
        monkeypatch.delenv("SENTRY_DSN")
        get_settings.cache_clear()
    assert calls[0]["send_default_pii"] is False and calls[0]["before_send"] is monitoring.scrub_event
