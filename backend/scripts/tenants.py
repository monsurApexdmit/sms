"""Manage the schools of a multi-school install (needs CONTROL_DATABASE_URL).

    python -m scripts.tenants create-db-sql greenfield      # SQL for a new MySQL database + user
    python -m scripts.tenants import-sql greenfield         # how to load sqldatabase/sms.sql into it
    python -m scripts.tenants add greenfield --name "Greenfield School" \\
        --hosts greenfield.example.com,www.greenfield.example.com \\
        --database-url "mysql+pymysql://sms_greenfield:...@db:3306/sms_greenfield?charset=utf8mb4"
    python -m scripts.tenants migrate greenfield             # alembic upgrade head for one school
    python -m scripts.tenants migrate-all                    # ... for every active school
    python -m scripts.tenants list
    python -m scripts.tenants set greenfield --hosts new.example.com
    python -m scripts.tenants disable greenfield             # its hosts answer 404; data is kept
    python -m scripts.tenants enable greenfield

Running API processes pick up changes within 30 seconds.
"""

import argparse
import re
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import select
from sqlalchemy.engine import make_url

from app.core.tenancy import TenantRow, control_session, multi_tenant, split_hosts

BACKEND = Path(__file__).resolve().parents[1]
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")


def _masked(url: str) -> str:
    try:
        return make_url(url).render_as_string(hide_password=True)
    except Exception:
        return "<invalid url>"


def _row(db, slug: str) -> TenantRow:
    row = db.get(TenantRow, slug)
    if row is None:
        sys.exit(f"No school {slug!r} (python -m scripts.tenants list)")
    return row


def _check_hosts(db, hosts: str, own_slug: str) -> str:
    wanted = split_hosts(hosts)
    if not wanted:
        sys.exit("Give at least one host name")
    for other in db.scalars(select(TenantRow).where(TenantRow.slug != own_slug)):
        clash = set(wanted) & set(split_hosts(other.hosts))
        if clash:
            sys.exit(f"{', '.join(sorted(clash))} already belongs to school {other.slug!r}")
    return ",".join(wanted)


def _check_url(url: str) -> str:
    try:
        make_url(url)
    except Exception:
        sys.exit("--database-url is not a valid SQLAlchemy URL")
    return url


def cmd_add(args) -> None:
    if not SLUG.match(args.slug):
        sys.exit("The slug must be 2-40 lowercase letters, digits or dashes")
    with control_session() as db:
        if db.get(TenantRow, args.slug) is not None:
            sys.exit(f"School {args.slug!r} already exists")
        db.add(
            TenantRow(
                slug=args.slug, name=args.name, hosts=_check_hosts(db, args.hosts, args.slug),
                database_url=_check_url(args.database_url), upload_dir=args.upload_dir, frontend_url=args.frontend_url,
                timezone=args.timezone, active=True, created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            )  # fmt: skip
        )
        db.commit()
    print(f"Added {args.slug}. Next: python -m scripts.tenants migrate {args.slug}")


def cmd_set(args) -> None:
    with control_session() as db:
        row = _row(db, args.slug)
        if args.name:
            row.name = args.name
        if args.hosts:
            row.hosts = _check_hosts(db, args.hosts, row.slug)
        if args.database_url:
            row.database_url = _check_url(args.database_url)
        for key in ("upload_dir", "frontend_url", "timezone"):
            value = getattr(args, key)
            if value is not None:
                setattr(row, key, value or None)
        db.commit()
    print(f"Updated {args.slug}")


def cmd_active(args, active: bool) -> None:
    with control_session() as db:
        _row(db, args.slug).active = active
        db.commit()
    print(f"{'Enabled' if active else 'Disabled'} {args.slug}")


def cmd_list(_args) -> None:
    with control_session() as db:
        rows = list(db.scalars(select(TenantRow).order_by(TenantRow.slug)))
    if not rows:
        print("No schools yet (python -m scripts.tenants add ...)")
    for r in rows:
        state = "active" if r.active else "DISABLED"
        print(f"{r.slug:<20} {state:<9} {r.name}\n    hosts: {r.hosts}\n    db:    {_masked(r.database_url)}")
        if r.upload_dir or r.frontend_url or r.timezone:
            print(f"    uploads: {r.upload_dir or '-'}  url: {r.frontend_url or '-'}  tz: {r.timezone or '-'}")


def migrate(url: str) -> None:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.attributes["database_url"] = url
    command.upgrade(cfg, "head")


def cmd_migrate(args) -> None:
    with control_session() as db:
        if args.slug:
            rows = [_row(db, args.slug)]
        else:
            rows = list(db.scalars(select(TenantRow).where(TenantRow.active).order_by(TenantRow.slug)))
    failed = []
    for r in rows:
        print(f"== {r.slug}")
        try:
            migrate(r.database_url)
        except Exception as exc:  # keep going: report every school that failed
            print(f"   FAILED: {exc}")
            failed.append(r.slug)
    if failed:
        sys.exit(f"Migration failed for: {', '.join(failed)}")


def cmd_create_db_sql(args) -> None:
    name = args.database or f"sms_{args.slug.replace('-', '_')}"
    user = args.user or name
    password = secrets.token_urlsafe(24)
    print(f"""-- Run as a MySQL admin, e.g.  mysql -h <host> -u root -p
CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER '{user}'@'%' IDENTIFIED BY '{password}';
GRANT ALL PRIVILEGES ON `{name}`.* TO '{user}'@'%';
FLUSH PRIVILEGES;

-- Then load the schema (python -m scripts.tenants import-sql {args.slug}) and register the school with
--   --database-url "mysql+pymysql://{user}:{password}@<host>:3306/{name}?charset=utf8mb4"
""")


def cmd_import_sql(args) -> None:
    name = args.database or f"sms_{args.slug.replace('-', '_')}"
    sql = BACKEND.parent.parent / "sqldatabase" / "sms.sql"
    print(f"""Every school starts from the legacy schema, then gets this system's tables from the migrations:

  mysql -h <host> -u <user> -p {name} < {sql}
  python -m scripts.tenants migrate {args.slug}

sms.sql contains one admin account whose password is unknown; set a new password for it,
or for a demo school run  python -m scripts.seed_demo --yes --school {args.slug}""")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    add = sub.add_parser("add", help="register a school")
    add.add_argument("slug")
    add.add_argument("--name", required=True)
    add.add_argument("--hosts", required=True, help="comma-separated host names")
    add.add_argument("--database-url", required=True)
    add.add_argument("--upload-dir", help="default: UPLOAD_DIR/<slug>")
    add.add_argument("--frontend-url", help="for links in emails; default https://<first host>")
    add.add_argument("--timezone", help="default: SCHOOL_TIMEZONE")
    add.set_defaults(fn=cmd_add)

    upd = sub.add_parser("set", help="change a school's settings")
    upd.add_argument("slug")
    upd.add_argument("--name")
    upd.add_argument("--hosts")
    upd.add_argument("--database-url")
    upd.add_argument("--upload-dir", help='"" to use the default')
    upd.add_argument("--frontend-url", help='"" to use the default')
    upd.add_argument("--timezone", help='"" to use SCHOOL_TIMEZONE')
    upd.set_defaults(fn=cmd_set)

    for name, active in (("enable", True), ("disable", False)):
        p = sub.add_parser(name, help=f"{name} a school")
        p.add_argument("slug")
        p.set_defaults(fn=lambda a, active=active: cmd_active(a, active))

    sub.add_parser("list", help="list schools").set_defaults(fn=cmd_list)

    mig = sub.add_parser("migrate", help="alembic upgrade head for one school")
    mig.add_argument("slug")
    mig.set_defaults(fn=cmd_migrate)
    sub.add_parser("migrate-all", help="alembic upgrade head for every active school").set_defaults(fn=cmd_migrate, slug=None)

    for name, fn, text in (
        ("create-db-sql", cmd_create_db_sql, "print SQL creating a MySQL database and user for a school"),
        ("import-sql", cmd_import_sql, "print how to load sqldatabase/sms.sql into a school's database"),
    ):
        p = sub.add_parser(name, help=text)
        p.add_argument("slug")
        p.add_argument("--database", help="database name; default sms_<slug>")
        if name == "create-db-sql":
            p.add_argument("--user", help="MySQL user; default: the database name")
        p.set_defaults(fn=fn)

    args = parser.parse_args()
    if not multi_tenant() and args.cmd not in ("create-db-sql", "import-sql"):
        sys.exit("Set CONTROL_DATABASE_URL first (the database that lists the schools)")
    args.fn(args)


if __name__ == "__main__":
    main()
