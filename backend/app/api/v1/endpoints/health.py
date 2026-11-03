"""Liveness and readiness checks (used by the container health checks)."""

import logging
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout

from fastapi import APIRouter, Response
from sqlalchemy import text

from app.core.redis import get_redis
from app.core.tenancy import control_engine, multi_tenant
from app.db.session import engine

router = APIRouter()


@router.get("/health", tags=["system"])
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


@router.get("/health/ready", tags=["system"])
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
