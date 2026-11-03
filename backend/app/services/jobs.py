"""Email/SMS delivery jobs.

With REDIS_URL set, jobs go to the RQ queue `notifications` and a worker sends them
(`rq worker --with-scheduler --url $REDIS_URL notifications`), retrying failures
after 1, 5 and 30 minutes. Jobs survive API restarts and failed ones stay in RQ's
failed-job registry. Without Redis they run in-process after the response
(FastAPI BackgroundTasks) and failures are only logged.
"""

import logging
from collections.abc import Callable
from typing import Any

from fastapi import BackgroundTasks
from rq import Queue, Retry

from app.core.redis import get_redis

log = logging.getLogger("jobs")

QUEUE = "notifications"
RETRY = Retry(max=3, interval=[60, 300, 1800])


def _run_logged(fn: Callable[..., Any], *args: Any) -> None:
    try:
        fn(*args)
    except Exception:
        log.exception("Background job %s failed", fn.__name__)


def enqueue(tasks: BackgroundTasks, fn: Callable[..., Any], *args: Any) -> None:
    redis = get_redis()
    if redis is None:
        tasks.add_task(_run_logged, fn, *args)
        return
    Queue(QUEUE, connection=redis).enqueue(fn, *args, retry=RETRY, job_timeout=60, failure_ttl=7 * 86400)
