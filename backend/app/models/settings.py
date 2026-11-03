"""System and website settings, website content, language phrases and legacy sessions."""

from sqlalchemy import Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import Int, Txt, num, pk, txt


class Setting(Base):
    __tablename__ = "settings"
    settings_id: Mapped[int] = pk()
    type: Txt = txt()
    description: Txt = txt()


class FrontendGeneralSetting(Base):
    __tablename__ = "frontend_general_settings"
    frontend_general_settings_id: Mapped[int] = pk()
    type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Txt = txt()


class FrontendNews(Base):
    __tablename__ = "frontend_news"
    frontend_news_id: Mapped[int] = pk()
    title: Txt = txt()
    description: Txt = txt()
    date_added: Int = num()
    image: Txt = txt()


class FrontendEvent(Base):
    __tablename__ = "frontend_events"
    frontend_events_id: Mapped[int] = pk()
    title: Txt = txt()
    timestamp: Int = num()
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class FrontendGallery(Base):
    __tablename__ = "frontend_gallery"
    frontend_gallery_id: Mapped[int] = pk()
    title: Txt = txt()
    description: Txt = txt()
    date_added: Int = num()
    image: Txt = txt()
    show_on_website: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class FrontendGalleryImage(Base):
    __tablename__ = "frontend_gallery_image"
    frontend_gallery_image_id: Mapped[int] = pk()
    frontend_gallery_id: Int = num()
    title: Txt = txt()
    image: Txt = txt()


class Language(Base):
    __tablename__ = "language"
    id: Mapped[int] = pk()
    english: Mapped[str] = mapped_column(String(255))
    bangali: Mapped[str] = mapped_column(String(255))


class CiSession(Base):
    """Legacy CodeIgniter sessions; not used by the new API."""

    __tablename__ = "ci_sessions"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    ip_address: Mapped[str] = mapped_column(String(45))
    timestamp: Mapped[int] = mapped_column(Integer, default=0)
    data: Mapped[bytes] = mapped_column(LargeBinary)
