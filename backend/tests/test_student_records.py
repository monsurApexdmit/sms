from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import AuditLog, SchoolClass, Student, Subject, Teacher
from tests.conftest import PASSWORD, YEAR, login


def _outsider(client) -> dict:
    """A teacher who teaches only in another class."""
    with SessionLocal() as db:
        db.add(SchoolClass(name="Nine", name_numeric="9"))
        db.add(Teacher(name="Other Teacher", email="t3@example.com", password=hash_password(PASSWORD)))
        db.flush()
        db.add(Subject(name="Biology", class_id=2, teacher_id=3, year=YEAR))
        db.commit()
    return login(client, "t3@example.com")


def _profile(client, headers, student_id=1):
    return client.get(f"/api/student-profile/{student_id}", headers=headers)


# --- health -----------------------------------------------------------------------


def test_health_profile_access(client, as_role):
    admin = as_role("admin")
    with SessionLocal() as db:
        db.get(Student, 1).blood_group = "O+"
        db.commit()
    assert _profile(client, admin).json()["health"]["blood_group"] == "O+"  # legacy value until saved

    r = client.put("/api/student-profile/1/health", headers=admin, json={"blood_group": "A+", "allergies": "Peanuts", "height_cm": 140})
    assert r.status_code == 200 and r.json()["updated_by"] == "admin-1"

    assert _profile(client, as_role("teacher")).json()["health"]["allergies"] == "Peanuts"
    assert _profile(client, as_role("parent")).json()["health"]["blood_group"] == "A+"
    assert _profile(client, as_role("student")).status_code == 200
    assert _profile(client, as_role("student2")).status_code == 403
    assert _profile(client, as_role("parent"), student_id=2).status_code == 403
    assert _profile(client, _outsider(client)).status_code == 403
    assert client.put("/api/student-profile/1/health", headers=as_role("teacher"), json={"blood_group": "B+"}).status_code == 403


# --- records ----------------------------------------------------------------------


def _add(client, headers, **body):
    body = {"date": "2026-03-01", "title": body.get("title", body["kind"]), **body}
    return client.post("/api/student-profile/1/records", headers=headers, json=body)


def test_record_visibility_matrix(client, as_role):
    admin, t1, t2 = as_role("admin"), as_role("teacher"), as_role("teacher2")
    assert _add(client, admin, kind="discipline", title="Late").status_code == 201
    assert _add(client, admin, kind="achievement", title="Prize").status_code == 201
    assert _add(client, admin, kind="health", title="Checkup").status_code == 201
    counselling = _add(client, admin, kind="counselling", title="Session", confidential=False).json()
    assert counselling["confidential"] is True  # always confidential
    assert _add(client, t1, kind="discipline", title="T1 private", confidential=True).status_code == 201
    assert _add(client, _outsider(client), kind="discipline").status_code == 403

    titles = lambda h: {r["title"] for r in _profile(client, h).json()["records"]}  # noqa: E731
    assert titles(admin) == {"Late", "Prize", "Checkup", "Session", "T1 private"}
    assert titles(t1) == {"Late", "Prize", "Checkup", "T1 private"}
    assert titles(t2) == {"Late", "Prize", "Checkup"}
    assert titles(as_role("parent")) == {"Late", "Prize"}
    assert titles(as_role("student")) == {"Prize"}


def test_only_author_or_admin_edits_records(client, as_role):
    t1, t2 = as_role("teacher"), as_role("teacher2")
    rec = _add(client, t1, kind="other", title="Note").json()
    body = {"kind": "other", "date": "2026-03-02", "title": "Edited"}
    assert client.put(f"/api/student-records/{rec['record_id']}", headers=t2, json=body).status_code == 403
    assert client.put(f"/api/student-records/{rec['record_id']}", headers=t1, json=body).json()["title"] == "Edited"
    assert client.delete(f"/api/student-records/{rec['record_id']}", headers=t2).status_code == 403
    assert client.delete(f"/api/student-records/{rec['record_id']}", headers=as_role("admin")).status_code == 204


def test_audit_hides_counselling_text(client, as_role):
    admin = as_role("admin")
    _add(client, admin, kind="counselling", title="Family trouble", details="Very private words")
    _add(client, admin, kind="achievement", title="Chess winner")
    with SessionLocal() as db:
        changes = [r.changes for r in db.scalars(select(AuditLog).where(AuditLog.table_name == "student_record"))]
    assert len(changes) == 2
    assert not any("private words" in c or "Family trouble" in c for c in changes)
    assert any('"details": "[hidden]"' in c for c in changes)
    assert any("Chess winner" in c for c in changes)


# --- certificates -------------------------------------------------------------------


def _templates(client, admin) -> dict[str, int]:
    assert client.post("/api/certificate-templates/defaults", headers=admin).json()["added"] == 3
    assert client.post("/api/certificate-templates/defaults", headers=admin).json()["added"] == 0
    return {t["kind"]: t["template_id"] for t in client.get("/api/certificate-templates", headers=admin).json()}


def _issue(client, admin, template_id, student_id=1, issued_on="2026-05-10", **extra):
    body = {"template_id": template_id, "student_id": student_id, "issued_on": issued_on, **extra}
    r = client.post("/api/certificates", headers=admin, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_serials_per_kind_and_year_and_rendering(client, as_role):
    admin = as_role("admin")
    ids = _templates(client, admin)
    first = _issue(client, admin, ids["transfer"], reason="Family moved", conduct="Good")
    assert first["serial_no"] == "TC-2026-0001"
    assert _issue(client, admin, ids["transfer"], student_id=2)["serial_no"] == "TC-2026-0002"
    assert _issue(client, admin, ids["bonafide"])["serial_no"] == "BC-2026-0001"
    assert _issue(client, admin, ids["transfer"], issued_on="2027-01-03")["serial_no"] == "TC-2027-0001"

    text = first["rendered_body"]
    for expected in ("Kid One", "Parent", "class Ten, section A (roll 1)", YEAR, "Test School", "Family moved", "Good"):
        assert expected in text
    assert "{" not in text
    assert "school records: ________." in text  # no birthday on file: a line to fill in by hand

    custom = client.post(
        "/api/certificate-templates", headers=admin,
        json={"kind": "custom", "name": "Sports", "body": "{student_name} won {medal} on {issue_date} ({serial})"},
    ).json()  # fmt: skip
    assert custom["unknown_placeholders"] == ["medal"]
    preview = client.post("/api/certificates/preview", headers=admin, json={"template_id": custom["template_id"], "student_id": 1, "issued_on": "2026-05-10"}).json()
    assert preview["rendered_body"] == "Kid One won {medal} on 10 May 2026 ((assigned when issued))"
    assert client.get("/api/certificates", headers=admin).json()["total"] == 4  # preview issues nothing

    assert client.delete(f"/api/certificate-templates/{ids['transfer']}", headers=admin).status_code == 409
    assert client.delete(f"/api/certificate-templates/{custom['template_id']}", headers=admin).status_code == 204


def test_certificate_access_cancel_and_public_verify(client, as_role):
    admin = as_role("admin")
    ids = _templates(client, admin)
    cert = _issue(client, admin, ids["character"], conduct="good")
    url = f"/api/certificates/{cert['certificate_id']}"

    assert client.get(url, headers=as_role("student")).status_code == 200
    assert client.get(url, headers=as_role("parent")).status_code == 200
    assert client.get(url, headers=as_role("student2")).status_code == 403
    assert client.get(url, headers=as_role("teacher")).status_code == 403
    assert [c["serial_no"] for c in client.get("/api/certificates/mine", headers=as_role("parent")).json()] == ["CC-2026-0001"]
    assert client.post("/api/certificates", headers=as_role("teacher"), json={"template_id": ids["character"], "student_id": 1}).status_code == 403

    r = client.get("/api/public/certificates/verify", params={"serial": "cc-2026-0001"})
    assert r.status_code == 200
    assert r.json() == {"valid": True, "kind": "character", "issued_on": "2026-05-10", "student_initials": "K.O."}
    unknown = client.get("/api/public/certificates/verify", params={"serial": "CC-2026-9999"}).json()
    assert unknown == {"valid": False, "kind": None, "issued_on": None, "student_initials": None}

    assert client.post(f"{url}/cancel", headers=admin, json={"reason": "Issued by mistake"}).json()["cancelled"] is True
    assert client.get(url, headers=as_role("student")).status_code == 403
    assert client.get(url, headers=admin).status_code == 200
    assert client.get("/api/certificates/mine", headers=as_role("student")).json() == []
    assert client.get("/api/public/certificates/verify", params={"serial": "CC-2026-0001"}).json()["valid"] is False
    assert _profile(client, as_role("parent")).json()["certificates"] == []
    assert len(_profile(client, admin).json()["certificates"]) == 1
