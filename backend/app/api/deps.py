from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.session import get_db
from app.services.accounts import get_account

bearer = HTTPBearer(auto_error=False)

DB = Annotated[Session, Depends(get_db)]


@dataclass(frozen=True)
class CurrentUser:
    role: str
    id: int
    name: str
    email: str

    @property
    def ref(self) -> str:
        """Legacy "role-id" identifier used by the messaging tables."""
        return f"{self.role}-{self.id}"


def get_current_user(
    db: DB, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]
) -> CurrentUser:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    if creds is None:
        raise unauthorized
    payload = decode_token(creds.credentials, "access")
    if payload is None:
        raise unauthorized
    role, _, raw_id = str(payload.get("sub", "")).partition(":")
    if not raw_id.isdigit():
        raise unauthorized
    row = get_account(db, role, int(raw_id))
    if row is None:
        raise unauthorized
    # the request's endpoint gets this same session; the audit log records changes under this user
    db.info["actor"] = f"{role}-{raw_id}"
    return CurrentUser(role=role, id=int(raw_id), name=row.name or "", email=row.email or "")


Me = Annotated[CurrentUser, Depends(get_current_user)]


def require_roles(*roles: str):
    def checker(user: Me) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed for your role")
        return user

    checker.roles = roles  # type: ignore[attr-defined]  # read by app/api/openapi.py for the API docs
    return checker


def forbid() -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")


def not_found(what: str = "Record") -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")
