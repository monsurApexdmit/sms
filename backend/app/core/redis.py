from functools import lru_cache

from redis import Redis

from app.core.config import get_settings


@lru_cache
def get_redis() -> Redis | None:
    """Shared Redis connection, or None when REDIS_URL is not set (development)."""
    url = get_settings().redis_url
    return Redis.from_url(url) if url else None
