import logging
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout

from fastapi import APIRouter, FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.routers import (
    academic,
    accounts,
    admissions,
    ai,
    analytics,
    attendance,
    attendance_capture,
    audit,
    auth,
    calendar,
    cms,
    exams,
    export,
    fees,
    finance,
    gateways,
    homework,
    hr,
    leave,
    library,
    meetings,
    messages,
    mfa,
    notifications,
    notices,
    online_exams,
    records,
    report_cards,
    students,
    system,
    transport,
    years,
)
from app.core.config import get_settings
from app.core.monitoring import init_sentry, setup_logging
from app.core.redis import get_redis
from app.core.tenancy import TenantMiddleware, control_engine, multi_tenant
from app.db.session import engine, on_new_sessionmaker
from app.services import audit as audit_trail

setup_logging()
init_sentry("api")

if get_settings().secret_key.startswith("change-me"):
    # Development only: ENVIRONMENT=production refuses to start with this key.
    logging.getLogger("startup").warning("SECRET_KEY is the built-in default. Set a random value before deploying.")

on_new_sessionmaker(audit_trail.install)

app = FastAPI(
    title="School Management API",
    version="1.0.0",
    description="FastAPI backend for the school management system (shares the legacy `sms` MySQL schema).",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Several schools: route each request to its school's database by Host (no-op for one school).
app.add_middleware(TenantMiddleware)

api = APIRouter(prefix="/api")
# One module per line: each feature adds its own line here.
ROUTERS = (
    auth.router,
    mfa.router,
    students.router,
    academic.router,
    exams.router,
    attendance.router,
    attendance_capture.router,
    finance.router,
    library.router,
    notices.router,
    messages.router,
    online_exams.router,
    system.router,
    audit.router,
    years.router,
    calendar.router,
    homework.router,
    export.router,
    leave.router,
    report_cards.router,
    fees.router,
    meetings.router,
    hr.router,
    transport.router,
    records.router,
    analytics.router,
    notifications.router,
    ai.router,
    gateways.router,
    *accounts.routers,
    cms.public,
    records.public,
    admissions.public,
    admissions.router,
    admissions.enquiries,
    cms.admin,
)
for router in ROUTERS:
    api.include_router(router)


@api.get("/health", tags=["system"])
def health():
    """Liveness: the process answers."""
    return {"status": "ok"}


READY_TIMEOUT = 3  # seconds per dependency


def _check_database() -> None:
    # several schools: the control database must answer (each school's database is checked on use)
    with (control_engine() if multi_tenant() else engine).connect() as conn:
        conn.execute(text("SELECT 1"))


def _check_redis() -> None:
    redis = get_redis()
    if redis is not None:
        redis.ping()


@api.get("/health/ready", tags=["system"])
def ready(response: Response):
    """Readiness: the database (and Redis, when configured) answer within a few seconds. 503 otherwise."""
    checks = {"database": _check_database, "redis": _check_redis}
    results: dict[str, str] = {}
    # not a `with` block: that would wait for a hung check and defeat the timeout
    pool = ThreadPoolExecutor(max_workers=len(checks))
    futures = {name: pool.submit(fn) for name, fn in checks.items()}
    for name, future in futures.items():
        try:
            future.result(timeout=READY_TIMEOUT)
            results[name] = "ok" if name != "redis" or get_redis() is not None else "not configured"
        except FuturesTimeout:
            results[name] = "timeout"
        except Exception:  # noqa: BLE001 - any failure means not ready; details go to the log
            logging.getLogger("health").exception("%s check failed", name)
            results[name] = "error"
    pool.shutdown(wait=False, cancel_futures=True)
    ok = all(v in ("ok", "not configured") for v in results.values())
    if not ok:
        response.status_code = 503
    return {"status": "ok" if ok else "unavailable", "checks": results}


app.include_router(api)
