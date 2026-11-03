"""Settings module for the RQ worker: `rq worker -c app.rq_settings ...`.

Importing it sets up logging and, when SENTRY_DSN is set, error reporting for jobs.
"""

from app.core.monitoring import init_sentry, setup_logging

setup_logging()
init_sentry("worker")
