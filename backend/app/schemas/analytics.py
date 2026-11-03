"""Request and response models for app/api/v1/endpoints/analytics.py."""

from app.schemas.common import Page


class AtRiskPage(Page):
    counts: dict[str, int]
    params: dict


class DefaulterPage(Page):
    amount: float
