"""Several schools on one install: one SQLite database per school, routed by Host."""

from argparse import Namespace
from datetime import datetime

import fakeredis
import pytest
from fastapi import BackgroundTasks
from fastapi.testclient import TestClient
from rq import Queue
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session

from app.db import session as db_module
from app.core import tenancy
from app.core.config import base_settings, get_settings
from app.core.security import sign_media_path, verify_media_signature
from app.core.tenancy import TenantRow, control_engine, control_session, reload_registry, tenant_by_slug, use_tenant
from app.db.base import Base
from app.db.session import new_session
from app.main import app
from app.models import Admin, Parent, Setting
from app.services import jobs, ratelimit
from scripts import tenants as tenants_cli
from tests.conftest import PASSWORD, YEAR
from tests.test_migrations import NEW_TABLES

HOSTS = {"a": "a.test", "b": "b.test", "c": "c.test"}


def _reset() -> None:
    base_settings.cache_clear()
    control_engine.cache_clear()
    tenancy._registry["at"] = 0.0
    for url, factory in db_module._school_factories.values():
        factory.kw["bind"].dispose()
    db_module._school_factories.clear()


def _register(slug: str, url: str, *, active: bool = True) -> None:
    with control_session() as db:
        db.add(TenantRow(slug=slug, name=f"School {slug.upper()}", hosts=HOSTS[slug], database_url=url, active=active, created_at=datetime(2026, 1, 1)))
        db.commit()


@pytest.fixture
def schools(tmp_path, monkeypatch):
    """Schools a and b (with an admin and a parent each) and a disabled school c."""
    monkeypatch.setenv("CONTROL_DATABASE_URL", f"sqlite:///{tmp_path / 'control.db'}")
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    _reset()
    from app.core.security import hash_password

    for slug in ("a", "b", "c"):
        url = f"sqlite:///{tmp_path / f'{slug}.db'}"
        engine = create_engine(url)
        Base.metadata.create_all(engine)
        with Session(engine) as s:
            s.add(Setting(type="running_year", description=YEAR))
            s.add(Admin(name=f"Admin {slug.upper()}", email="admin@example.com", password=hash_password(PASSWORD)))
            s.add(Parent(name=f"Parent {slug.upper()}", email=f"parent-{slug}@example.com", password=hash_password(PASSWORD)))
            s.commit()
        engine.dispose()
        _register(slug, url, active=slug != "c")
    reload_registry()
    ratelimit.reset()
    yield tmp_path
    monkeypatch.delenv("CONTROL_DATABASE_URL")
    monkeypatch.delenv("UPLOAD_DIR")
    _reset()


def _client(slug: str) -> TestClient:
    return TestClient(app, base_url=f"http://{HOSTS[slug]}")


def _login(client: TestClient) -> dict:
    r = client.post("/api/auth/login", json={"email": "admin@example.com", "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_each_host_sees_only_its_own_school(schools):
    with _client("a") as a, _client("b") as b:
        ha, hb = _login(a), _login(b)
        assert a.get("/api/auth/me", headers=ha).json()["name"] == "Admin A"
        assert b.get("/api/auth/me", headers=hb).json()["name"] == "Admin B"
        assert [p["name"] for p in a.get("/api/parents", headers=ha).json()["items"]] == ["Parent A"]
        assert [p["name"] for p in b.get("/api/parents", headers=hb).json()["items"]] == ["Parent B"]
        # writes land in the school's own database
        assert a.put("/api/settings", headers=ha, json={"system_name": "Greenfield"}).status_code == 200
        assert b.get("/api/settings/public").json()["system_name"] != "Greenfield"
        assert a.get("/api/settings/public").json()["system_name"] == "Greenfield"


def test_token_of_one_school_is_refused_by_another(schools):
    with _client("a") as a, _client("b") as b:
        token_a = _login(a)
        assert b.get("/api/auth/me", headers=token_a).status_code == 401
        refresh = a.cookies.get("sms_refresh")
        assert refresh and a.post("/api/auth/refresh").status_code == 200
        # the same refresh token presented to another school
        assert b.post("/api/auth/refresh", headers={"Cookie": f"sms_refresh={refresh}"}).status_code == 401


def test_unknown_and_disabled_hosts_get_404(schools):
    with TestClient(app, base_url="http://nowhere.test") as other:
        assert other.get("/api/settings/public").status_code == 404
        # container health checks call these on 127.0.0.1, so they answer without a school
        assert other.get("/api/health").status_code == 200
    with _client("c") as c:
        assert c.post("/api/auth/login", json={"email": "admin@example.com", "password": PASSWORD}).status_code == 404


def test_forwarded_host_only_when_trusted(schools, monkeypatch):
    with TestClient(app, base_url="http://proxy.internal") as client:
        assert client.get("/api/settings/public", headers={"X-Forwarded-Host": "a.test"}).status_code == 404
        monkeypatch.setenv("TRUST_FORWARDED_HOST", "true")
        base_settings.cache_clear()
        assert client.get("/api/settings/public", headers={"X-Forwarded-Host": "a.test"}).status_code == 200


def test_school_settings_uploads_and_media_urls(schools):
    a, b = tenant_by_slug("a"), tenant_by_slug("b")
    with use_tenant(a):
        assert get_settings().upload_dir == schools / "uploads" / "a"
        assert get_settings().frontend_url == "https://a.test"
        url = sign_media_path("syllabus/x.pdf")
        exp, sig = url.split("exp=")[1].split("&sig=")
    with use_tenant(a):
        assert verify_media_signature("syllabus/x.pdf", int(exp), sig)
    with use_tenant(b):
        assert not verify_media_signature("syllabus/x.pdf", int(exp), sig)
    assert get_settings().upload_dir == schools / "uploads"


def _add_parent(name: str) -> None:
    """A job that writes to whatever school it runs for."""
    with new_session() as db:
        db.add(Parent(name=name, email=f"{name}@example.com"))
        db.commit()


def _parents(slug: str) -> list[str]:
    with use_tenant(tenant_by_slug(slug)), new_session() as db:
        return sorted(db.scalars(select(Parent.name)))


def test_queued_jobs_run_for_the_school_that_queued_them(schools, monkeypatch):
    server = fakeredis.FakeRedis()
    monkeypatch.setattr(jobs, "get_redis", lambda: server)
    with use_tenant(tenant_by_slug("b")):
        jobs.enqueue(BackgroundTasks(), _add_parent, "Queued")
    (job,) = Queue(jobs.QUEUE, connection=server).get_jobs()
    assert job.func_name == "app.services.jobs.run_for_school"
    assert job.args[0] == "b"
    job.perform()  # what the worker does, outside any request
    assert "Queued" in _parents("b") and "Queued" not in _parents("a")


def test_in_process_jobs_also_keep_their_school(schools):
    import asyncio

    tasks = BackgroundTasks()
    with use_tenant(tenant_by_slug("a")):
        jobs.enqueue(tasks, _add_parent, "Inline")
    asyncio.run(tasks())
    assert "Inline" in _parents("a") and "Inline" not in _parents("b")


def test_rate_limits_are_per_school(schools, monkeypatch):
    server = fakeredis.FakeRedis()
    monkeypatch.setattr(ratelimit, "get_redis", lambda: server)
    bad = {"email": "admin@example.com", "password": "wrong"}
    with _client("a") as a, _client("b") as b:
        for _ in range(10):
            assert a.post("/api/auth/login", json=bad).status_code == 401
        assert a.post("/api/auth/login", json=bad).status_code == 429
        assert b.post("/api/auth/login", json=bad).status_code == 401
    keys = {k.decode() for k in server.keys("ratelimit:*")}
    assert keys and all(k.startswith(("ratelimit:a:", "ratelimit:b:")) for k in keys)


def test_migrate_all_upgrades_every_active_school(tmp_path, monkeypatch):
    monkeypatch.setenv("CONTROL_DATABASE_URL", f"sqlite:///{tmp_path / 'control.db'}")
    _reset()
    legacy = [t for name, t in Base.metadata.tables.items() if name not in NEW_TABLES]
    urls = {}
    for slug in ("a", "b"):
        urls[slug] = f"sqlite:///{tmp_path / f'legacy-{slug}.db'}"
        engine = create_engine(urls[slug])
        Base.metadata.create_all(engine, tables=legacy)
        engine.dispose()
        _register(slug, urls[slug])
    try:
        tenants_cli.cmd_migrate(Namespace(slug=None))
        for url in urls.values():
            engine = create_engine(url)
            assert NEW_TABLES <= set(inspect(engine).get_table_names())
            engine.dispose()
    finally:
        monkeypatch.delenv("CONTROL_DATABASE_URL")
        _reset()


def test_single_school_mode_is_unchanged(client, as_role):
    assert not tenancy.multi_tenant()
    assert client.get("/api/auth/me", headers=as_role("admin")).json()["name"] == "Admin"
