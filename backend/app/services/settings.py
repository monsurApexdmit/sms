import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Setting

SECRET_KEYS = {
    "smtp_pass",
    "twilio_auth_token",
    "clickatell_password",
    "payumoney_salt_id",
    "msg91_authentication_key",
    "purchase_code",
}
PUBLIC_KEYS = {
    "system_name", "system_title", "currency", "language", "text_align", "running_year", "address", "phone",
    "system_email", "disable_frontend", "weekly_off_days",
}  # fmt: skip
MASK = "********"


def get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.scalars(select(Setting).where(Setting.type == key)).first()
    return row.description if row is not None and row.description is not None else default


def set_setting(db: Session, key: str, value: str | None) -> None:
    row = db.scalars(select(Setting).where(Setting.type == key)).first()
    if row is None:
        db.add(Setting(type=key, description=value))
    else:
        row.description = value


def running_year(db: Session) -> str:
    return get_setting(db, "running_year")


def all_settings(db: Session, *, masked: bool = True) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for row in db.scalars(select(Setting)):
        key, value = row.type or "", row.description
        if masked and key in SECRET_KEYS and value:
            value = MASK
        out[key] = value
    if masked:
        out["stripe_keys"] = json.dumps([_mask_stripe(get_stripe_config(db))])
        out["paypal"] = mask_paypal(get_paypal_config(db))
    return out


def get_stripe_config(db: Session) -> dict[str, str]:
    try:
        data = json.loads(get_setting(db, "stripe_keys", "[]"))
        return data[0] if data else {}
    except (ValueError, IndexError, TypeError):
        return {}


def _mask_stripe(cfg: dict[str, str]) -> dict[str, str]:
    return {k: (MASK if k.startswith("secret") and v else v) for k, v in cfg.items()}


def stripe_secret(db: Session) -> str | None:
    cfg = get_stripe_config(db)
    if cfg.get("active") != "1":
        return None
    return cfg.get("secret_key") if cfg.get("testmode") == "on" else cfg.get("secret_live_key")


# --- PayPal -------------------------------------------------------------------
# Stored like the legacy app: a JSON list with one object. The API exposes the object.

PAYPAL_FIELDS = (
    "active", "mode", "sandbox_client_id", "sandbox_secret_key", "production_client_id", "production_secret_key",
)  # fmt: skip


def get_paypal_config(db: Session) -> dict[str, str]:
    try:
        data = json.loads(get_setting(db, "paypal", "[]"))
        cfg = data[0] if isinstance(data, list) and data else data
        return {k: str(v) for k, v in cfg.items() if k in PAYPAL_FIELDS and v is not None} if isinstance(cfg, dict) else {}
    except (ValueError, IndexError, TypeError):
        return {}


def mask_paypal(cfg: dict[str, str]) -> dict[str, str]:
    out = {k: cfg.get(k, "") for k in PAYPAL_FIELDS}
    return {k: (MASK if k.endswith("secret_key") and v else v) for k, v in out.items()}


def paypal_credentials(db: Session) -> tuple[str, str, str] | None:
    """(mode, client_id, secret) when PayPal is switched on and configured for the selected mode."""
    cfg = get_paypal_config(db)
    if cfg.get("active") != "1":
        return None
    mode = "sandbox" if cfg.get("mode", "sandbox") == "sandbox" else "production"
    client_id, secret = cfg.get(f"{mode}_client_id", ""), cfg.get(f"{mode}_secret_key", "")
    return (mode, client_id, secret) if client_id and secret else None


def paypal_enabled(db: Session) -> bool:
    cfg = get_paypal_config(db)
    mode = "sandbox" if cfg.get("mode", "sandbox") == "sandbox" else "production"
    return cfg.get("active") == "1" and bool(cfg.get(f"{mode}_client_id"))
