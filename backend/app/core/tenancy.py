"""Several schools on one install: one database (and uploads folder) per school.

Off unless CONTROL_DATABASE_URL is set. Then the `tenant` table in that control
database lists the schools; each request is routed to a school by its Host header
(TenantMiddleware) and everything inside the request -- the database session
(app/db.py), uploads, JWTs, signed media URLs, rate limits, queued jobs -- uses
that school. Schools are managed with `python -m scripts.tenants`.
"""

import json
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime
from functools import cached_property, lru_cache
from pathlib import Path

from sqlalchemy import Boolean, DateTime, String, Text, create_engine, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.core import config
from app.core.config import Settings, base_settings

REGISTRY_TTL = 30  # seconds before the school list is re-read from the control database


class ControlBase(DeclarativeBase):
    """Metadata of the control database only (not part of any school's schema)."""


class TenantRow(ControlBase):
    __tablename__ = "tenant"
    slug: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # comma-separated host names, e.g. "greenfield.example.com,www.greenfield.example.com"
    hosts: Mapped[str] = mapped_column(Text, nullable=False)
    database_url: Mapped[str] = mapped_column(Text, nullable=False)
    upload_dir: Mapped[str | None] = mapped_column(Text, nullable=True)
    # links in emails (password reset, payment return); default https://<first host>
    frontend_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


@dataclass(frozen=True)
class Tenant:
    slug: str
    name: str
    hosts: tuple[str, ...]
    database_url: str
    upload_dir: str | None = None
    frontend_url: str | None = None
    timezone: str | None = None
    active: bool = True

    @cached_property
    def settings(self) -> Settings:
        """The environment settings with this school's database, uploads, address and time zone."""
        base = base_settings()
        update: dict = {
            "database_url": self.database_url,
            "upload_dir": Path(self.upload_dir) if self.upload_dir else base.upload_dir / self.slug,
            "frontend_url": (self.frontend_url or f"https://{self.hosts[0]}").rstrip("/"),
        }
        if self.timezone:
            update["school_timezone"] = self.timezone
        return base.model_copy(update=update)


def split_hosts(raw: str) -> tuple[str, ...]:
    return tuple(h.strip().lower() for h in raw.split(",") if h.strip())


def _tenant(row: TenantRow) -> Tenant:
    return Tenant(
        slug=row.slug, name=row.name, hosts=split_hosts(row.hosts), database_url=row.database_url,
        upload_dir=row.upload_dir, frontend_url=row.frontend_url, timezone=row.timezone, active=row.active,
    )  # fmt: skip


# --- control database ---------------------------------------------------------------


def multi_tenant() -> bool:
    return bool(base_settings().control_database_url)


@lru_cache
def control_engine() -> Engine:
    engine = create_engine(base_settings().control_database_url, pool_pre_ping=True, pool_recycle=3600, pool_size=2)
    ControlBase.metadata.create_all(engine)
    return engine


def control_session() -> Session:
    return sessionmaker(bind=control_engine(), expire_on_commit=False)()


_lock = threading.Lock()
_registry: dict = {"at": 0.0, "by_slug": {}, "by_host": {}}


def _load() -> None:
    with control_session() as db:
        rows = [_tenant(r) for r in db.scalars(select(TenantRow))]
    _registry["by_slug"] = {t.slug: t for t in rows}
    _registry["by_host"] = {h: t for t in rows for h in t.hosts}
    _registry["at"] = time.monotonic()


def _fresh(refresh: bool) -> dict:
    with _lock:
        if refresh or time.monotonic() - _registry["at"] > REGISTRY_TTL:
            _load()
        return _registry


def reload_registry() -> None:
    _fresh(True)


def all_tenants(refresh: bool = False) -> list[Tenant]:
    return sorted(_fresh(refresh)["by_slug"].values(), key=lambda t: t.slug)


def tenant_by_slug(slug: str, refresh: bool = False) -> Tenant | None:
    return _fresh(refresh)["by_slug"].get(slug)


def tenant_for_host(host: str) -> Tenant | None:
    return _fresh(False)["by_host"].get(host.split(":", 1)[0].strip().lower())


# --- current school ------------------------------------------------------------------

_current: ContextVar[Tenant | None] = ContextVar("tenant", default=None)


def current_tenant() -> Tenant | None:
    return _current.get()


def current_slug() -> str | None:
    tenant = _current.get()
    return tenant.slug if tenant else None


@contextmanager
def use_tenant(tenant: Tenant) -> Iterator[Tenant]:
    """Run the block for one school: its database session, settings and uploads."""
    token = _current.set(tenant)
    settings_token = config._school_settings.set(tenant.settings)
    try:
        yield tenant
    finally:
        config._school_settings.reset(settings_token)
        _current.reset(token)


class TenantMiddleware:
    """Routes each request to its school by Host (or X-Forwarded-Host when trusted).
    Unknown or disabled hosts get 404. Does nothing in single-school mode."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not multi_tenant():
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        host = headers.get(b"host", b"").decode("latin-1")
        if base_settings().trust_forwarded_host and b"x-forwarded-host" in headers:
            host = headers[b"x-forwarded-host"].decode("latin-1").split(",")[0]
        tenant = tenant_for_host(host)
        if tenant is None or not tenant.active:
            body = json.dumps({"detail": "Unknown school"}).encode()
            await send({"type": "http.response.start", "status": 404, "headers": [(b"content-type", b"application/json")]})
            await send({"type": "http.response.body", "body": body})
            return
        with use_tenant(tenant):
            await self.app(scope, receive, send)
