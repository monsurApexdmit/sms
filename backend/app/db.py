"""Database sessions.

One school: everything uses DATABASE_URL (`engine`, `SessionLocal`). Several schools
(app/core/tenancy.py): sessions come from the current school's own engine, created on
first use and kept per school. Code that opens a session itself (jobs, scripts) uses
`new_session()` so it gets the right school's database either way.
"""

import threading
from collections.abc import Callable, Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import base_settings
from app.core.tenancy import Tenant, current_tenant


class Base(DeclarativeBase):
    pass


engine = create_engine(base_settings().database_url, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

_school_factories: dict[str, tuple[str, sessionmaker]] = {}
_hooks: list[Callable[[sessionmaker], None]] = []
_lock = threading.Lock()


def on_new_sessionmaker(hook: Callable[[sessionmaker], None]) -> None:
    """Apply `hook` (e.g. the audit-log listener) to every session factory, including schools added later."""
    _hooks.append(hook)
    for factory in (SessionLocal, *(f for _, f in _school_factories.values())):
        hook(factory)


def _factory_for(tenant: Tenant) -> sessionmaker:
    cached = _school_factories.get(tenant.slug)
    if cached is not None and cached[0] == tenant.database_url:
        return cached[1]
    with _lock:
        return _create_factory(tenant)


def _create_factory(tenant: Tenant) -> sessionmaker:
    cached = _school_factories.get(tenant.slug)
    if cached is not None and cached[0] == tenant.database_url:
        return cached[1]
    if cached is not None:  # the school's database moved: drop the old pool
        cached[1].kw["bind"].dispose()
    url = tenant.database_url
    pool = {} if url.startswith("sqlite") else {"pool_size": 3, "max_overflow": 5}
    factory = sessionmaker(
        bind=create_engine(url, pool_pre_ping=True, pool_recycle=3600, **pool), autoflush=False, expire_on_commit=False
    )
    for hook in _hooks:
        hook(factory)
    _school_factories[tenant.slug] = (url, factory)
    return factory


def current_sessionmaker() -> sessionmaker:
    tenant = current_tenant()
    return _factory_for(tenant) if tenant else SessionLocal


def new_session() -> Session:
    """A session on the current school's database (DATABASE_URL in single-school mode)."""
    return current_sessionmaker()()


def get_db() -> Iterator[Session]:
    db = new_session()
    try:
        yield db
    finally:
        db.close()
