from functools import lru_cache

from redis import Redis

from app.core.config import get_settings


@lru_cache
def get_redis() -> Redis | None:
    """Shared Redis connection, or None when REDIS_URL is not set (development)."""
    url = get_settings().redis_url
    # timeouts so a stalled Redis fails requests (and the readiness check) instead of hanging them
    return Redis.from_url(url, socket_connect_timeout=3, socket_timeout=5, health_check_interval=30) if url else None
