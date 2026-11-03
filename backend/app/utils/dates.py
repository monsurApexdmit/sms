from datetime import datetime, timezone


def utc_now() -> datetime:
    """Current UTC time without tzinfo, as stored in the DateTime columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
