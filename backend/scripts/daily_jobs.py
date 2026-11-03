"""Daily fee jobs: apply late fines, then send due reminders.

    python -m scripts.daily_jobs

The `scheduler` service in docker-compose.yml runs this once a day. Admins can also
run it from Fee setup. Safe to run more than once a day: fines are recalculated, not
added again, and each invoice gets at most one reminder per day.
"""

import asyncio
import logging

from fastapi import BackgroundTasks

from app.core.monitoring import init_sentry, setup_logging
from app.db import SessionLocal
from app.services import audit as audit_trail
from app.services.fees import run_daily_jobs

log = logging.getLogger("daily_jobs")


def main() -> None:
    setup_logging()
    init_sentry("scheduler")
    audit_trail.install(SessionLocal)
    tasks = BackgroundTasks()
    with SessionLocal() as db:
        result = run_daily_jobs(db, tasks)
    # Without REDIS_URL the emails/SMS were queued here instead of on the job queue; send them now.
    asyncio.run(tasks())
    log.info("Late fines updated on %(fines_updated)d invoices; reminders sent for %(reminders_sent)d", result)


if __name__ == "__main__":
    main()
