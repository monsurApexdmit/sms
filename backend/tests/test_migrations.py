from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from app.db import Base

BACKEND = Path(__file__).resolve().parents[1]
NEW_TABLES = {"audit_log"}


def test_migrations_upgrade_a_legacy_database(tmp_path, monkeypatch):
    """A database holding only the legacy schema upgrades to match the models."""
    url = f"sqlite:///{tmp_path / 'legacy.db'}"
    engine = create_engine(url)
    Base.metadata.create_all(engine, tables=[t for name, t in Base.metadata.tables.items() if name not in NEW_TABLES])

    monkeypatch.setenv("DATABASE_URL", url)
    from app.core.config import get_settings

    get_settings.cache_clear()
    try:
        command.upgrade(Config(str(BACKEND / "alembic.ini")), "head")
    finally:
        get_settings.cache_clear()

    assert NEW_TABLES <= set(inspect(engine).get_table_names())
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert [d for d in diff if any(name in str(d) for name in NEW_TABLES)] == []
