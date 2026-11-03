from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_SECRET = "change-me-in-production-please-use-64-random-bytes"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # "production" refuses to start with unsafe settings (see check_production below).
    environment: Literal["development", "production"] = "development"

    database_url: str = "mysql+pymysql://sms:sms@127.0.0.1:3307/sms?charset=utf8mb4"

    # Shared rate limits and the email/SMS job queue. Empty: rate limits are kept
    # per process and notifications are sent in-process without retries.
    redis_url: str = ""

    # Must be overridden in production. Used to sign JWTs and media URLs.
    secret_key: str = DEFAULT_SECRET
    access_token_minutes: int = 30
    refresh_token_days: int = 7
    reset_token_minutes: int = 30
    media_url_seconds: int = 3600

    # "argon2" upgrades legacy sha1 hashes on login and stores new passwords as argon2.
    # Use "sha1" only while the old CodeIgniter app still runs against the same database.
    password_hash_scheme: str = "argon2"

    # Shared with the legacy app so existing photos and documents keep working.
    upload_dir: Path = BACKEND_DIR.parent.parent / "uploads"
    max_upload_mb: int = 10

    # Exam dates/times entered by staff are interpreted in this zone.
    school_timezone: str = "UTC"

    frontend_url: str = "http://localhost:5173"
    cors_origins: list[str] = ["http://localhost:5173"]
    cookie_secure: bool = False

    stripe_webhook_secret: str = ""

    # Optional error reporting (https://sentry.io or self-hosted); off when empty.
    sentry_dsn: str = ""
    sentry_traces_sample_rate: float = 0.0
    # "json" writes one JSON object per log line.
    log_format: Literal["text", "json"] = "text"

    @model_validator(mode="after")
    def check_production(self) -> "Settings":
        if self.environment != "production":
            return self
        problems = []
        if self.secret_key.startswith("change-me") or len(self.secret_key) < 32:
            problems.append("SECRET_KEY must be a random value of at least 32 characters")
        if not self.cookie_secure:
            problems.append("COOKIE_SECURE must be true (the site must be served over HTTPS)")
        if not self.redis_url:
            problems.append("REDIS_URL must be set (shared rate limits and the email/SMS queue)")
        if problems:
            raise ValueError("Unsafe production settings: " + "; ".join(problems))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
