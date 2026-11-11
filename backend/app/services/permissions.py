"""Role permissions: seeding the built-in roles, effective levels, and the request check."""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.permissions import BY_KEY, FULL, MODULES, NONE, RANK, ROLES, VIEW, available, default_level, resolve
from app.models import AccessRole, AccessRolePermission, Admin

SYSTEM_NAMES = {
    "admin": "Administrator",
    "teacher": "Teacher",
    "accountant": "Accountant",
    "librarian": "Librarian",
    "student": "Student",
    "parent": "Parent",
}
READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def ensure_system_roles(db: Session) -> None:
    """Create the six built-in roles and any missing default rows. Idempotent: rows an
    administrator has changed are left alone."""
    existing = {r.key: r for r in db.scalars(select(AccessRole).where(AccessRole.is_system.is_(True)))}
    for role in ROLES:
        row = existing.get(role)
        if row is None:
            now = _now()
            row = AccessRole(key=role, name=SYSTEM_NAMES[role], base_role=role, is_system=True, created_at=now, updated_at=now)
            db.add(row)
            db.flush()
        have = set(db.scalars(select(AccessRolePermission.module).where(AccessRolePermission.access_role_id == row.access_role_id)))
        for m in MODULES:
            if m.key not in have and available(role, m.key):
                db.add(AccessRolePermission(access_role_id=row.access_role_id, module=m.key, level=FULL))
    db.flush()


def stored_levels(db: Session, access_role_id: int) -> dict[str, str]:
    rows = db.execute(
        select(AccessRolePermission.module, AccessRolePermission.level).where(AccessRolePermission.access_role_id == access_role_id)
    ).all()
    return {m: lvl for m, lvl in rows if m in BY_KEY}


def role_levels(db: Session, role: AccessRole) -> dict[str, str]:
    """Every module's level for a role. Built-in roles fall back to their defaults for
    modules without a row (a module added after seeding); custom roles to none. A level is
    never above what the base role can have."""
    stored = stored_levels(db, role.access_role_id)
    out = {}
    for m in MODULES:
        if not available(role.base_role, m.key):
            out[m.key] = NONE
        elif role.base_role == "admin" and role.is_system:
            out[m.key] = FULL  # the built-in administrator is never restricted
        else:
            out[m.key] = stored.get(m.key, default_level(role.base_role, m.key) if role.is_system else NONE)
    return out


def user_role(db: Session, role: str, user_id: int) -> AccessRole | None:
    """The role whose permissions apply to this account; None = unrestricted administrator."""
    if role == "admin":
        rid = db.scalar(select(Admin.access_role_id).where(Admin.admin_id == user_id))
        return db.get(AccessRole, rid) if rid else None
    return db.scalar(select(AccessRole).where(AccessRole.key == role, AccessRole.is_system.is_(True)))


def user_levels(db: Session, role: str, user_id: int) -> dict[str, str] | None:
    """Module levels for an account, or None for a full administrator (everything)."""
    access = user_role(db, role, user_id)
    if access is None:
        if role == "admin":
            return None
        return {m.key: default_level(role, m.key) for m in MODULES}  # not seeded yet: the defaults
    return role_levels(db, access)


def is_full_admin(db: Session, role: str, user_id: int) -> bool:
    return role == "admin" and user_role(db, role, user_id) is None


def denial(db: Session, role: str, user_id: int, method: str, path: str) -> str | None:
    """Why this request is not allowed, or None when it is."""
    if role not in ROLES:
        return None
    target = resolve(path)
    reading = method.upper() in READ_METHODS
    # a restricted administrator must not be able to create or change a full administrator
    if role == "admin" and not reading and path.removeprefix("/api").startswith("/admins") and not is_full_admin(db, role, user_id):
        return "Only full administrators can manage administrator accounts"
    if target.module is None:
        # paths outside the modules: built-in roles keep what the endpoint allows; a custom
        # (restricted) administrator gets only what has been given
        if role == "admin" and not target.exempt and not is_full_admin(db, role, user_id):
            return "Your role does not include this part of the system"
        return None
    if reading and target.shared_read:
        return None
    levels = user_levels(db, role, user_id)
    if levels is None:
        return None
    level = levels.get(target.module, NONE)
    needed = VIEW if reading else FULL
    if RANK[level] >= RANK[needed]:
        return None
    label = BY_KEY[target.module].label
    if level == VIEW:
        return f"You have view-only access to {label}"
    return f"Your role does not include {label}"

