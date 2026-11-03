"""Logging setup and optional error reporting to Sentry.

LOG_FORMAT=json writes one JSON object per log line (for log collectors); the default is
plain text. Sentry is enabled only when SENTRY_DSN is set. Events carry no personal data:
request bodies, cookies, query strings, auth headers and user details are removed before
sending.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any

from app.core.config import get_settings

TEXT_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
# Header names whose values never leave the server.
SECRET_HEADERS = {"authorization", "cookie", "set-cookie", "x-device-key", "x-api-key", "stripe-signature"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


def setup_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter() if get_settings().log_format == "json" else logging.Formatter(TEXT_FORMAT))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)


def scrub_event(event: dict, _hint: dict | None = None) -> dict:
    """Sentry before_send: drop anything that could identify a student, parent or staff member."""
    request = event.get("request")
    if isinstance(request, dict):
        for key in ("data", "cookies", "query_string", "env"):
            request.pop(key, None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {k: ("[removed]" if k.lower() in SECRET_HEADERS else v) for k, v in headers.items()}
    event.pop("user", None)
    return event


def init_sentry(component: str) -> bool:
    """Start Sentry for `component` ("api" or "worker") when SENTRY_DSN is set. Returns whether it started."""
    s = get_settings()
    if not s.sentry_dsn:
        return False
    import sentry_sdk

    sentry_sdk.init(
        dsn=s.sentry_dsn,
        environment=s.environment,
        server_name=component,
        send_default_pii=False,
        max_request_body_size="never",
        traces_sample_rate=s.sentry_traces_sample_rate,
        before_send=scrub_event,
        before_send_transaction=scrub_event,
    )
    sentry_sdk.set_tag("component", component)
    return True
