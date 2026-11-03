"""Container health checks (used by docker-compose.yml).

    python -m scripts.healthcheck api      # the API answers /api/health/ready (database + Redis)
    python -m scripts.healthcheck worker   # Redis answers and an RQ worker on this host is registered

Exits 0 when healthy, 1 otherwise.
"""

import socket
import sys
import urllib.request

API_READY_URL = "http://127.0.0.1:8000/api/health/ready"


def api() -> bool:
    try:
        with urllib.request.urlopen(API_READY_URL, timeout=5) as r:
            return r.status == 200
    except OSError:
        return False


def worker() -> bool:
    from redis import Redis
    from rq import Worker

    from app.core.config import get_settings

    url = get_settings().redis_url
    if not url:
        return False
    try:
        conn = Redis.from_url(url, socket_connect_timeout=3, socket_timeout=5)
        conn.ping()
        host = socket.gethostname()
        return any(w.hostname == host for w in Worker.all(connection=conn))
    except OSError:
        return False


if __name__ == "__main__":
    checks = {"api": api, "worker": worker}
    if len(sys.argv) != 2 or sys.argv[1] not in checks:
        sys.exit(f"usage: python -m scripts.healthcheck {{{'|'.join(checks)}}}")
    sys.exit(0 if checks[sys.argv[1]]() else 1)
