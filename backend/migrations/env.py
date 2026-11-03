"""Alembic environment. Uses the app's DATABASE_URL and ORM metadata.

The legacy tables come from sqldatabase/sms.sql (revision 0001 is an empty baseline
for them). When autogenerating, review the result: the legacy tables are mapped
loosely (e.g. Text for varchar columns), so drop any changes to them that the
migration did not intend.
"""

from alembic import context
from sqlalchemy import create_engine, pool

import app.models  # noqa: F401  (registers every table on Base.metadata)
from app.core.config import get_settings
from app.db import Base

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=get_settings().database_url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(get_settings().database_url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
