from app.core.permissions import MODULES, resolve
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.main import app
from app.models import Admin
from tests.conftest import PASSWORD, login


def _second_admin(client, email="office@example.com") -> tuple[int, dict]:
    with SessionLocal() as db:
        a = Admin(name="Office", email=email, password=hash_password(PASSWORD))
        db.add(a)
        db.commit()
        admin_id = a.admin_id
    return admin_id, login(client, email)


def _role(roles: list[dict], key: str) -> dict:
    return next(r for r in roles if r["key"] == key)


def test_every_api_path_belongs_to_a_module_or_is_exempt():
    unmapped = sorted({p for p in app.openapi()["paths"] if (t := resolve(p)).module is None and not t.exempt})
    assert unmapped == []


def test_builtin_roles_are_seeded_with_todays_access(client, as_role):
    admin = as_role("admin")
    roles = client.get("/api/permissions/roles", headers=admin).json()
    assert [r["key"] for r in roles] == ["admin", "teacher", "accountant", "librarian", "student", "parent"]
    assert all(r["is_system"] for r in roles)
    assert _role(roles, "admin")["locked"] and set(_role(roles, "admin")["permissions"].values()) == {"full"}
    teacher = _role(roles, "teacher")["permissions"]
    assert teacher["students"] == "full" and teacher["invoices"] == "none" and teacher["marks"] == "full"
    assert _role(roles, "parent")["permissions"]["invoices"] == "full"
    assert len(client.get("/api/permissions/modules", headers=admin).json()) == len(MODULES)

    me = client.get("/api/auth/me", headers=as_role("teacher")).json()
    assert me["permissions"]["homework"] == "full" and me["permissions"]["parents"] == "none"
    assert client.get("/api/auth/me", headers=admin).json()["permissions"] is None  # full administrator

    for who in ("teacher", "student", "parent"):
        assert client.get("/api/permissions/roles", headers=as_role(who)).status_code == 403


def test_restricting_a_builtin_role(client, as_role):
    admin, teacher = as_role("admin"), as_role("teacher")
    tid = _role(client.get("/api/permissions/roles", headers=admin).json(), "teacher")["access_role_id"]
    body = {"name": "ignored", "permissions": {"homework": "view", "syllabus": "none"}}
    r = client.put(f"/api/permissions/roles/{tid}", headers=admin, json=body)
    assert r.status_code == 200 and r.json()["name"] == "Teacher"  # built-in names stay
    assert r.json()["permissions"]["homework"] == "view"

    assert client.get("/api/homework", headers=teacher).status_code == 200
    denied = client.post("/api/homework", headers=teacher, json={"title": "x"})
    assert denied.status_code == 403 and "view-only" in denied.json()["detail"]
    assert client.get("/api/syllabus", headers=teacher).status_code == 403
    # lookups other screens need stay readable
    assert client.get("/api/students", headers=teacher).status_code == 200
    # a role cannot be given a module it never had
    bad = client.put(f"/api/permissions/roles/{tid}", headers=admin, json={"name": "x", "permissions": {"invoices": "full"}})
    assert bad.status_code == 422
    aid = _role(client.get("/api/permissions/roles", headers=admin).json(), "admin")["access_role_id"]
    assert client.put(f"/api/permissions/roles/{aid}", headers=admin, json={"name": "x", "permissions": {}}).status_code == 409


def test_custom_role_for_an_administrator(client, as_role):
    admin = as_role("admin")
    office_id, office = _second_admin(client)
    body = {"name": "Office staff", "description": "Front desk", "permissions": {"admissions": "full", "students": "view"}}
    role = client.post("/api/permissions/roles", headers=admin, json=body).json()
    assert role["key"] == "custom-office-staff" and role["base_role"] == "admin" and role["members"] == 0
    assert role["permissions"]["admissions"] == "full" and role["permissions"]["invoices"] == "none"
    assert client.post("/api/permissions/roles", headers=admin, json=body).status_code == 409

    r = client.put(f"/api/permissions/admins/{office_id}", headers=admin, json={"access_role_id": role["access_role_id"]})
    assert r.status_code == 200
    office = login(client, "office@example.com")
    me = client.get("/api/auth/me", headers=office).json()
    assert me["access_role"] == "Office staff" and me["permissions"]["settings"] == "none"

    assert client.get("/api/admissions", headers=office).status_code == 200
    assert client.get("/api/invoices", headers=office).status_code == 403
    assert client.post("/api/classes", headers=office, json={"name": "Nine"}).status_code == 403
    assert client.get("/api/settings", headers=office).status_code == 403
    assert client.get("/api/settings/public", headers=office).status_code == 200
    # cannot manage roles, nor create a full administrator
    assert client.get("/api/permissions/roles", headers=office).status_code == 403
    staff = client.put(f"/api/permissions/roles/{role['access_role_id']}", headers=admin, json={**body, "permissions": {"staff": "full"}})
    assert staff.status_code == 200
    made = client.post("/api/admins", headers=office, json={"name": "X", "email": "x@example.com", "password": "Secret@123"})
    assert made.status_code == 403

    assert client.delete(f"/api/permissions/roles/{role['access_role_id']}", headers=admin).status_code == 409  # still assigned
    client.put(f"/api/permissions/admins/{office_id}", headers=admin, json={"access_role_id": None})
    assert client.get("/api/invoices", headers=office).status_code == 200
    assert client.delete(f"/api/permissions/roles/{role['access_role_id']}", headers=admin).status_code == 204


def test_admin_assignment_guards(client, as_role):
    admin = as_role("admin")
    role = client.post("/api/permissions/roles", headers=admin, json={"name": "Exams", "permissions": {"exams": "full"}}).json()
    assert client.put("/api/permissions/admins/1", headers=admin, json={"access_role_id": role["access_role_id"]}).status_code == 409  # self
    other_id, other = _second_admin(client, "second@example.com")
    teacher_role = _role(client.get("/api/permissions/roles", headers=admin).json(), "teacher")["access_role_id"]
    assert client.put(f"/api/permissions/admins/{other_id}", headers=admin, json={"access_role_id": teacher_role}).status_code == 422
    # a restricted administrator cannot use the role screens at all
    assert client.put(f"/api/permissions/admins/{other_id}", headers=admin, json={"access_role_id": role["access_role_id"]}).status_code == 200
    other = login(client, "second@example.com")
    assert client.put("/api/permissions/admins/1", headers=other, json={"access_role_id": None}).status_code == 403
    admins = client.get("/api/permissions/admins", headers=admin).json()
    assert {a["admin_id"]: a["access_role_id"] for a in admins} == {1: None, other_id: role["access_role_id"]}
