"""Daily fee jobs: apply late fines, then send due reminders.

    python -m scripts.daily_jobs

The `scheduler` service in docker-compose.yml runs this once a day. Admins can also
run it from Fee setup. Safe to run more than once a day: fines are recalculated, not
added again, and each invoice gets at most one reminder per day. On a multi-school
install it runs for every active school in turn; one school failing does not stop the rest.
"""

import asyncio
import logging

from fastapi import BackgroundTasks

from app.core.monitoring import init_sentry, setup_logging
from app.core.tenancy import all_tenants, multi_tenant, use_tenant
from app.db import new_session, on_new_sessionmaker
from app.services import audit as audit_trail
from app.services.fees import run_daily_jobs

log = logging.getLogger("daily_jobs")


def run_once(school: str = "") -> None:
    tasks = BackgroundTasks()
    with new_session() as db:
        result = run_daily_jobs(db, tasks)
    # Without REDIS_URL the emails/SMS were queued here instead of on the job queue; send them now.
    asyncio.run(tasks())
    log.info("%sLate fines updated on %d invoices; reminders sent for %d", school, result["fines_updated"], result["reminders_sent"])


def main() -> None:
    setup_logging()
    init_sentry("scheduler")
    on_new_sessionmaker(audit_trail.install)
    if not multi_tenant():
        run_once()
        return
    for tenant in all_tenants(refresh=True):
        if not tenant.active:
            continue
        try:
            with use_tenant(tenant):
                run_once(f"[{tenant.slug}] ")
        except Exception:
            log.exception("Daily jobs failed for school %s", tenant.slug)


if __name__ == "__main__":
    main()
