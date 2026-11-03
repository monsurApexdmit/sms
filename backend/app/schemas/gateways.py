"""Request and response models for app/api/v1/endpoints/gateways.py."""

from typing import Any

from pydantic import BaseModel, Field

REF =r"^[A-Za-z0-9_-]{1,100}$"


class GatewaySettingsIn(BaseModel):
    bkash: dict[str, Any] | None = None
    nagad: dict[str, Any] | None = None
    sslcommerz: dict[str, Any] | None = None


class ConfirmIn(BaseModel):
    ref: str = Field(pattern=REF)
