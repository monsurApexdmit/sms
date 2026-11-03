"""Request and response models for app/api/v1/endpoints/notices.py."""

from app.models import Noticeboard
from app.schemas.common import out_schema

NoticeBase = out_schema(Noticeboard)


class NoticeOut(NoticeBase):  # type: ignore[misc,valid-type]
    image_url: str | None = None
