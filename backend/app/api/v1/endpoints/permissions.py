"""Roles & permissions: the built-in roles' module levels, custom roles, and which
administrator account has which role. Only full administrators may use these endpoints."""

import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from app.api.deps import DB, CurrentUser, Me
from app.core.permissions import BY_KEY, LEVELS, MODULES, NONE, ROLES, available
from app.models import AccessRole, AccessRolePermission, Admin
from app.services.permissions import ensure_system_roles, is_full_admin, role_levels

router = APIRouter(prefix="/permissions", tags=["permissions"])


def full_admin(user: Me, db: DB) -> CurrentUser:
    if not is_full_admin(db, user.role, user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only full administrators can manage roles and permissions")
    return user


FullAdmin = Depends(full_admin)


class ModuleOut(BaseModel):
    key: str
    group: str
    label: str
    roles: list[str]


class RoleOut(BaseModel):
    access_role_id: int
    key: str
    name: str
    description: str | None
    base_role: str
    is_system: bool
    locked: bool
    members: int | None
    permissions: dict[str, str]


class RoleIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(None, max_length=2000)
    permissions: dict[str, str] = {}

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("Name is required")
        return v

    @field_validator("permissions")
    @classmethod
    def _levels(cls, v: dict[str, str]) -> dict[str, str]:
        for module, level in v.items():
            if module not in BY_KEY:
                raise ValueError(f"Unknown module: {module}")
            if level not in LEVELS:
                raise ValueError(f"Unknown level for {module}: {level}")
        return v


class AdminAccessOut(BaseModel):
    admin_id: int
    name: str
    email: str
    access_role_id: int | None


class AdminAccessIn(BaseModel):
    access_role_id: int | None


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def _out(db: DB, role: AccessRole) -> RoleOut:
    members = None
    if not role.is_system:
        members = db.scalar(select(func.count()).select_from(Admin).where(Admin.access_role_id == role.access_role_id)) or 0
    return RoleOut(
        access_role_id=role.access_role_id,
        key=role.key,
        name=role.name,
        description=role.description,
        base_role=role.base_role,
        is_system=role.is_system,
        locked=role.is_system and role.base_role == "admin",
        members=members,
        permissions=role_levels(db, role),
    )


def _save_levels(db: DB, role: AccessRole, levels: dict[str, str]) -> None:
    for module, level in levels.items():
        if not available(role.base_role, module):
            if level != NONE:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    f"{BY_KEY[module].label} is not available to the {role.base_role} role",
                )
            continue
        row = db.get(AccessRolePermission, (role.access_role_id, module))
        if row is None:
            db.add(AccessRolePermission(access_role_id=role.access_role_id, module=module, level=level))
        else:
            row.level = level


def _role(db: DB, access_role_id: int) -> AccessRole:
    role = db.get(AccessRole, access_role_id)
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    return role


def _unique_key(db: DB, name: str) -> str:
    base = "custom-" + (re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:28] or "role")
    key, n = base, 2
    while db.scalar(select(AccessRole.access_role_id).where(AccessRole.key == key)):
        key, n = f"{base}-{n}", n + 1
    return key


@router.get("/modules", response_model=list[ModuleOut], dependencies=[FullAdmin])
def modules():
    """Every module, its menu group, and the built-in roles that can have it."""
    return [ModuleOut(key=m.key, group=m.group, label=m.label, roles=list(m.roles)) for m in MODULES]


@router.get("/roles", response_model=list[RoleOut], dependencies=[FullAdmin])
def list_roles(db: DB):
    """The six built-in roles first, then custom roles by name, each with every module's level."""
    ensure_system_roles(db)
    db.commit()
    rows = db.scalars(select(AccessRole)).all()
    order = {r: i for i, r in enumerate(ROLES)}
    rows = sorted(rows, key=lambda r: (not r.is_system, order.get(r.key, 99), r.name.lower()))
    return [_out(db, r) for r in rows]


@router.post("/roles", response_model=RoleOut, status_code=201, dependencies=[FullAdmin])
def create_role(body: RoleIn, db: DB):
    """A custom role for administrator accounts. Modules left out are `none`."""
    if db.scalar(select(AccessRole.access_role_id).where(func.lower(AccessRole.name) == body.name.lower())):
        raise HTTPException(status.HTTP_409_CONFLICT, "A role with this name already exists")
    now = _now()
    role = AccessRole(
        key=_unique_key(db, body.name), name=body.name, description=body.description, base_role="admin", is_system=False, created_at=now, updated_at=now
    )
    db.add(role)
    db.flush()
    _save_levels(db, role, {m.key: body.permissions.get(m.key, NONE) for m in MODULES})
    db.commit()
    return _out(db, role)


@router.put("/roles/{access_role_id}", response_model=RoleOut, dependencies=[FullAdmin])
def update_role(access_role_id: int, body: RoleIn, db: DB):
    """Rename a custom role and set module levels. Built-in roles keep their name; the
    built-in Administrator role cannot be restricted."""
    ensure_system_roles(db)
    role = _role(db, access_role_id)
    if role.is_system and role.base_role == "admin":
        raise HTTPException(status.HTTP_409_CONFLICT, "The Administrator role always has full access")
    if not role.is_system:
        clash = db.scalar(
            select(AccessRole.access_role_id).where(func.lower(AccessRole.name) == body.name.lower(), AccessRole.access_role_id != role.access_role_id)
        )
        if clash:
            raise HTTPException(status.HTTP_409_CONFLICT, "A role with this name already exists")
        role.name = body.name
    role.description = body.description
    role.updated_at = _now()
    _save_levels(db, role, body.permissions)
    db.commit()
    return _out(db, role)


@router.delete("/roles/{access_role_id}", status_code=204, dependencies=[FullAdmin])
def delete_role(access_role_id: int, db: DB):
    role = _role(db, access_role_id)
    if role.is_system:
        raise HTTPException(status.HTTP_409_CONFLICT, "Built-in roles cannot be deleted")
    members = db.scalar(select(func.count()).select_from(Admin).where(Admin.access_role_id == role.access_role_id)) or 0
    if members:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{members} administrator account(s) still have this role")
    db.delete(role)
    db.commit()


@router.get("/admins", response_model=list[AdminAccessOut], dependencies=[FullAdmin])
def list_admins(db: DB):
    """Administrator accounts and their custom role (null = full administrator)."""
    rows = db.scalars(select(Admin).order_by(Admin.name)).all()
    return [AdminAccessOut(admin_id=a.admin_id, name=a.name or "", email=a.email or "", access_role_id=a.access_role_id) for a in rows]


@router.put("/admins/{admin_id}", response_model=AdminAccessOut, dependencies=[FullAdmin])
def set_admin_role(admin_id: int, body: AdminAccessIn, user: Me, db: DB):
    """Give an administrator account a custom role, or `null` for full access. You cannot
    change your own role, and at least one full administrator must remain."""
    admin = db.get(Admin, admin_id)
    if admin is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Administrator not found")
    if admin_id == user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "You cannot change your own role")
    if body.access_role_id is not None:
        role = _role(db, body.access_role_id)
        if role.is_system:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a custom role, or none for full access")
        full_left = db.scalar(
            select(func.count()).select_from(Admin).where(Admin.access_role_id.is_(None), Admin.admin_id != admin_id)
        )
        if not full_left:
            raise HTTPException(status.HTTP_409_CONFLICT, "At least one full administrator must remain")
    admin.access_role_id = body.access_role_id
    db.commit()
    return AdminAccessOut(admin_id=admin.admin_id, name=admin.name or "", email=admin.email or "", access_role_id=admin.access_role_id)
