"""Email/SMS delivery jobs.

With REDIS_URL set, jobs go to the RQ queue `notifications` and a worker sends them
(`rq worker --with-scheduler --url $REDIS_URL notifications`), retrying failures
after 1, 5 and 30 minutes. Jobs survive API restarts and failed ones stay in RQ's
failed-job registry. Without Redis they run in-process after the response
(FastAPI BackgroundTasks) and failures are only logged.

With several schools (app/core/tenancy.py) a job runs for the school that queued it:
it is wrapped in `run_for_school`, which switches to that school's database first.
"""

import logging
from collections.abc import Callable
from typing import Any

from fastapi import BackgroundTasks
from rq import Queue, Retry

from app.core.redis import get_redis
from app.core.tenancy import current_slug, tenant_by_slug, use_tenant

log = logging.getLogger("jobs")

QUEUE = "notifications"
RETRY = Retry(max=3, interval=[60, 300, 1800])


def _run_logged(fn: Callable[..., Any], *args: Any) -> None:
    try:
        fn(*args)
    except Exception:
        log.exception("Background job %s failed", fn.__name__)


def run_for_school(school: str, fn: Callable[..., Any], *args: Any) -> Any:
    """Run a queued job for one school of a multi-school install."""
    tenant = tenant_by_slug(school, refresh=True)
    if tenant is None or not tenant.active:
        log.warning("Dropped job %s for unknown or disabled school %r", getattr(fn, "__name__", fn), school)
        return None
    with use_tenant(tenant):
        return fn(*args)


def enqueue(tasks: BackgroundTasks, fn: Callable[..., Any], *args: Any) -> None:
    school = current_slug()
    if school is not None:
        fn, args = run_for_school, (school, fn, *args)
    redis = get_redis()
    if redis is None:
        tasks.add_task(_run_logged, fn, *args)
        return
    Queue(QUEUE, connection=redis).enqueue(fn, *args, retry=RETRY, job_timeout=60, failure_ttl=7 * 86400)
