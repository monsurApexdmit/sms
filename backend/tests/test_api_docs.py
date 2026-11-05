import pytest

from app.api.openapi import TAGS, docs_kwargs
from app.core.config import Settings
from app.main import app

PRODUCTION = {"environment": "production", "secret_key": "x" * 64, "cookie_secure": True, "redis_url": "redis://redis:6379/0"}


def _operation(path: str, method: str = "get") -> dict:
    return app.openapi()["paths"][path][method]


@pytest.mark.parametrize(("url", "marker"), [("/api/docs", "swagger-ui"), ("/api/redoc", "redoc")])
def test_doc_pages_are_served_under_api(client, url, marker):
    r = client.get(url)
    assert r.status_code == 200 and marker in r.text


def test_schema_explains_sign_in_and_collapses_sections(client):
    schema = client.get("/api/openapi.json").json()
    assert "Authorize" in schema["info"]["description"]
    assert schema["components"]["securitySchemes"]["HTTPBearer"]["bearerFormat"] == "JWT"
    assert '"docExpansion": "none"' in client.get("/api/docs").text


def test_every_tag_is_described_and_every_operation_has_an_access_line():
    schema = app.openapi()
    used = {tag for item in schema["paths"].values() for op in item.values() for tag in op["tags"]}
    described = {t["name"] for t in TAGS}
    assert used == described, f"undescribed: {used - described}, unused: {described - used}"
    assert all(t.get("description") for t in TAGS)
    missing = [op["operationId"] for item in schema["paths"].values() for op in item.values() if not op["description"].startswith("**Access:**")]
    assert missing == []


def test_access_line_comes_from_route_and_router_dependencies():
    # require_roles on the router
    audit = _operation("/api/audit-log")
    assert audit["x-roles"] == ["admin"] and audit["description"].startswith("**Access:** admin")
    assert {"401", "403"} <= set(audit["responses"])
    # the bare signed-in dependency
    me = _operation("/api/auth/me")
    assert me["description"].startswith("**Access:** any signed-in user") and "x-roles" not in me
    assert "401" in me["responses"] and "403" not in me["responses"]
    # checks the bearer token itself, not through get_current_user
    setup = _operation("/api/auth/mfa/setup", "post")
    assert setup["description"].startswith("**Access:** bearer token required") and "401" in setup["responses"]
    # no bearer token; an existing docstring stays below the access line
    forgot = _operation("/api/auth/forgot-password", "post")
    assert forgot["description"].startswith("**Access:** no bearer token") and "401" not in forgot["responses"]
    assert "cannot be used to discover accounts" in forgot["description"]


def test_no_bearer_label_agrees_with_the_schema_security():
    for path, item in app.openapi()["paths"].items():
        for method, op in item.items():
            says_open = op["description"].startswith("**Access:** no bearer token")
            assert says_open == (not op.get("security")), f"{method} {path}"


def test_documented_roles_match_what_the_api_enforces(client, as_role):
    assert client.get("/api/audit-log", headers=as_role("teacher")).status_code == 403
    assert client.get("/api/audit-log", headers=as_role("admin")).status_code == 200


def test_docs_are_off_in_production_unless_asked_for():
    assert docs_kwargs(Settings(environment="development"))["docs_url"] == "/api/docs"
    off = docs_kwargs(Settings(**PRODUCTION))
    assert off == {"docs_url": None, "redoc_url": None, "openapi_url": None}
    assert docs_kwargs(Settings(**PRODUCTION, api_docs_enabled=True))["openapi_url"] == "/api/openapi.json"
    assert docs_kwargs(Settings(environment="development", api_docs_enabled=False))["docs_url"] is None
