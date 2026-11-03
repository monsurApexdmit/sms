"""Sliding-window rate limits.

Kept in Redis when REDIS_URL is set, so limits hold across workers, replicas and
restarts. Without Redis they are kept per process (development and tests only:
ENVIRONMENT=production requires Redis).
"""

import time
import uuid
from collections import defaultdict, deque

from fastapi import HTTPException, status

from app.core.redis import get_redis
from app.core.tenancy import current_slug

_local: dict[str, deque[float]] = defaultdict(deque)


def _allow_local(key: str, limit: int, window: int, now: float) -> bool:
    q = _local[key]
    while q and q[0] < now - window:
        q.popleft()
    if len(q) >= limit:
        return False
    q.append(now)
    return True


def _allow_redis(redis, key: str, limit: int, window: int, now: float) -> bool:
    rkey = f"ratelimit:{key}"
    pipe = redis.pipeline()
    pipe.zremrangebyscore(rkey, 0, now - window)
    pipe.zcard(rkey)
    _, count = pipe.execute()
    if count >= limit:
        return False
    pipe = redis.pipeline()
    pipe.zadd(rkey, {f"{now}:{uuid.uuid4().hex}": now})
    pipe.expire(rkey, window)
    pipe.execute()
    return True


def throttle(key: str, limit: int, window: int, message: str) -> None:
    """Record one hit for `key`; raise 429 when it already had `limit` hits in the last `window` seconds."""
    if (school := current_slug()) is not None:
        key = f"{school}:{key}"
    now = time.time()
    redis = get_redis()
    allowed = _allow_redis(redis, key, limit, window, now) if redis else _allow_local(key, limit, window, now)
    if not allowed:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, message)


def reset() -> None:
    _local.clear()
