"""Roles and their module permissions (see app/core/permissions.py)."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.columns import pk


class AccessRole(Base):
    """A role. The six built-in ones (`is_system`) have `key` = the account type (admin,
    teacher, ...); custom roles are admin-based and are given to admin accounts through
    `admin.access_role_id`."""

    __tablename__ = "access_role"
    access_role_id: Mapped[int] = pk()
    key: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_role: Mapped[str] = mapped_column(String(20), nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AccessRolePermission(Base):
    """One module's level for a role: full | view | none."""

    __tablename__ = "access_role_permission"
    access_role_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("access_role.access_role_id", ondelete="CASCADE"), primary_key=True
    )
    module: Mapped[str] = mapped_column(String(40), primary_key=True)
    level: Mapped[str] = mapped_column(String(10), nullable=False)
