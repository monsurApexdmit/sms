from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

from app.db import Base

BACKEND = Path(__file__).resolve().parents[1]
NEW_TABLES = {
    "audit_log", "academic_year", "term", "calendar_event", "homework", "homework_submission", "leave_request",
}
NEW_TABLES |= {"fee_head", "fee_plan", "fee_plan_item", "fee_instalment", "fee_discount", "fee_invoice"}


def _table_of(diff) -> str | None:
    """Table name a compare_metadata entry is about."""
    if isinstance(diff, list):  # column modifications come grouped
        diff = diff[0]
    obj = diff[1]
    if hasattr(obj, "name") and diff[0].endswith("_table"):
        return obj.name
    if hasattr(obj, "table"):
        return obj.table.name
    return diff[2] if len(diff) > 2 and isinstance(diff[2], str) else None


def test_migrations_upgrade_a_legacy_database(tmp_path, monkeypatch):
    """A database holding only the legacy schema upgrades to match the models."""
    url = f"sqlite:///{tmp_path / 'legacy.db'}"
    engine = create_engine(url)
    Base.metadata.create_all(engine, tables=[t for name, t in Base.metadata.tables.items() if name not in NEW_TABLES])
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO settings (type, description) VALUES ('running_year', '2025-2026')"))
        conn.execute(text("INSERT INTO enroll (student_id, year) VALUES (1, '2024-2025'), (2, '2025-2026')"))
        conn.execute(text("INSERT INTO invoice (student_id, year) VALUES (1, 'not-a-year')"))

    monkeypatch.setenv("DATABASE_URL", url)
    from app.core.config import get_settings

    get_settings.cache_clear()
    try:
        command.upgrade(Config(str(BACKEND / "alembic.ini")), "head")
    finally:
        get_settings.cache_clear()

    assert NEW_TABLES <= set(inspect(engine).get_table_names())
    with engine.connect() as conn:
        years = conn.execute(text("SELECT name, is_current FROM academic_year ORDER BY name")).all()
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert [(n, bool(c)) for n, c in years] == [("2024-2025", False), ("2025-2026", True)]
    assert [d for d in diff if _table_of(d) in NEW_TABLES] == []
