import hashlib
import os
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="sms-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp / 'test.db'}"
os.environ["UPLOAD_DIR"] = str(_tmp / "uploads")
os.environ["SECRET_KEY"] = "test-secret-key-that-is-long-enough-for-hs256"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    Admin,
    Enroll,
    Exam,
    Grade,
    Parent,
    SchoolClass,
    Section,
    Setting,
    Student,
    Subject,
    Teacher,
)

PASSWORD = "Secret@123"
YEAR = "2025-2026"


@pytest.fixture(autouse=True)
def fresh_db():
    # in-process rate limits would otherwise carry over between tests
    from app.services import ratelimit

    ratelimit.reset()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        pw = hash_password(PASSWORD)
        db.add(Setting(type="running_year", description=YEAR))
        db.add(Setting(type="system_name", description="Test School"))
        # legacy unsalted sha1 hash, as stored by the CodeIgniter app
        db.add(Admin(name="Admin", email="admin@example.com", password=hashlib.sha1(PASSWORD.encode()).hexdigest()))
        db.add_all(
            [
                Teacher(name="Teacher One", email="t1@example.com", password=pw),
                Teacher(name="Teacher Two", email="t2@example.com", password=pw),
                Parent(name="Parent", email="p@example.com", password=pw),
            ]
        )
        db.flush()
        db.add(SchoolClass(name="Ten", name_numeric="10"))
        db.flush()
        db.add(Section(name="A", class_id=1))
        db.add_all(
            [
                Subject(name="Math", class_id=1, teacher_id=1, year=YEAR),
                Subject(name="Physics", class_id=1, teacher_id=2, year=YEAR),
            ]
        )
        db.add_all(
            [
                Student(name="Kid One", email="s1@example.com", password=pw, parent_id=1),
                Student(name="Kid Two", email="s2@example.com", password=pw),
            ]
        )
        db.flush()
        db.add_all(
            [
                Enroll(student_id=1, class_id=1, section_id=1, roll=1, year=YEAR),
                Enroll(student_id=2, class_id=1, section_id=1, roll=2, year=YEAR),
            ]
        )
        db.add(Exam(name="Term 1", year=YEAR))
        db.add_all(
            [
                Grade(name="A", grade_point="5", mark_from=80, mark_upto=100),
                Grade(name="F", grade_point="0", mark_from=0, mark_upto=79),
            ]
        )
        db.commit()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def login(client: TestClient, email: str, password: str = PASSWORD) -> dict:
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def as_role(client):
    emails = {
        "admin": "admin@example.com",
        "teacher": "t1@example.com",
        "teacher2": "t2@example.com",
        "parent": "p@example.com",
        "student": "s1@example.com",
        "student2": "s2@example.com",
    }
    return lambda role: login(client, emails[role])
