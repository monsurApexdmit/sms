"""API documentation: Swagger UI at /api/docs, ReDoc at /api/redoc.

Who may call each operation is worked out from its dependencies (require_roles,
get_current_user), so the docs cannot drift from the access rules actually enforced.
"""

from collections.abc import Iterator
from typing import Any

from fastapi import FastAPI, routing
from fastapi.dependencies.models import Dependant

from app.api.deps import get_current_user
from app.core.config import Settings

API_DESCRIPTION = """
REST API behind the school management web app. The web app itself uses these same endpoints.

## Signing in

1. Call `POST /api/auth/login` with `{"email": "...", "password": "..."}`.
2. Copy `access_token` from the response.
3. Click **Authorize** at the top of this page and paste it. Do not add the word `Bearer`.

Access tokens last 30 minutes by default. Login also sets an httpOnly refresh cookie;
`POST /api/auth/refresh` uses it to issue a new access token.

**Two-factor login:** if the account uses it, login returns `mfa_required: true` and an
`mfa_token` instead of an access token. Send that token with the code to
`POST /api/auth/mfa/verify`. If the account's role requires two-factor and it is not set up
yet, login returns `enroll_required: true`; that `mfa_token` works as a bearer token for
`/api/auth/mfa/setup` and `/api/auth/mfa/confirm` only.

## Who can call what

Each operation starts with an **Access** line, generated from the access rules in the code.
It says who may call the endpoint at all. Many endpoints narrow that further to specific
records: students see only their own data, parents only their children's, and teachers only
the classes and subjects they teach.

## Conventions

- **Lists** that page return `{"items": [...], "total": n}` and take `limit` and `offset`.
- **Errors** return `{"detail": "..."}`. Validation failures (422) list each bad field.
- **Downloads:** `/api/export/*.xlsx` returns an Excel file.
- **Several schools:** on a multi-school install, the school is chosen by the web address you
  call, and a token from one school is rejected by the others.
"""

# Order here is the order of the sections in Swagger UI. tests/test_api_docs.py checks that
# every tag used by a route is described here.
TAGS: list[dict[str, str]] = [
    {"name": "auth", "description": "Sign in, tokens, password reset, own profile and two-factor login."},
    {"name": "system", "description": "System settings, dashboard data and health checks."},
    {"name": "accounts", "description": "Teacher, parent, librarian, accountant and admin accounts."},
    {"name": "students", "description": "Students, enrolment, bulk import and promotion."},
    {"name": "admissions", "description": "Admission applications and enquiries, up to enrolling the student."},
    {"name": "student records", "description": "Health profiles, discipline and counselling records, and certificates."},
    {"name": "academic years", "description": "School years and terms."},
    {"name": "academic", "description": "Classes, sections, subjects, class routine, syllabus and study material."},
    {"name": "calendar", "description": "Academic calendar: holidays, exams, events and meetings."},
    {"name": "homework", "description": "Set homework, submit answers and grade them."},
    {"name": "exams", "description": "Exams, grades, marks entry and import, marksheets and tabulation."},
    {"name": "report cards", "description": "Exam timetable, admit cards, report cards, weights and remarks."},
    {"name": "online exams", "description": "Online exams, question bank, taking an exam and results."},
    {"name": "attendance", "description": "Daily student attendance sheets and monthly reports."},
    {"name": "attendance capture", "description": "Per-period attendance, ID cards, check-in kiosk and attendance devices."},
    {"name": "leave", "description": "Leave requests and approvals for students and staff."},
    {"name": "finance", "description": "Invoices, payments, expenses, and Stripe and PayPal checkout."},
    {"name": "fees", "description": "Fee heads, fee plans, instalments, discounts, invoice generation and receipts."},
    {"name": "payment gateways", "description": "bKash, Nagad and SSLCommerz checkout and settings."},
    {"name": "hr", "description": "Staff attendance, salary structures, payroll and payslips."},
    {"name": "library & facilities", "description": "Library books and requests, transport routes and dormitories."},
    {"name": "transport", "description": "Route stops, vehicles, drivers, student assignments and rosters."},
    {"name": "meetings", "description": "Parent-teacher meeting sessions, slots and bookings."},
    {"name": "noticeboard", "description": "School notices."},
    {"name": "messages", "description": "Private and group messages."},
    {"name": "notifications", "description": "In-app notifications, channel preferences, web push and WhatsApp settings."},
    {"name": "analytics", "description": "At-risk students, fee collection, attendance, exam results and teacher workload."},
    {"name": "ai assistant", "description": "AI drafts of remarks, questions and progress summaries, plus usage limits."},
    {"name": "export", "description": "Excel downloads of lists and reports."},
    {"name": "audit", "description": "Log of who changed what."},
    {"name": "website admin", "description": "Manage the public website: pages, news, events and gallery."},
    {"name": "public website", "description": "Public website content and forms. No sign-in needed."},
]

ERROR_BODY = {"application/json": {"schema": {"type": "object", "properties": {"detail": {"type": "string"}}}}}


def docs_kwargs(settings: Settings) -> dict[str, Any]:
    """FastAPI() arguments for the documentation pages, which are off in production by default."""
    if not settings.docs_enabled:
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {
        "docs_url": "/api/docs",
        "redoc_url": "/api/redoc",
        "openapi_url": "/api/openapi.json",
        # Sections start collapsed and searchable: there are over 400 operations. Tokens are
        # deliberately not persisted, so a token does not stay in the browser's localStorage.
        "swagger_ui_parameters": {"docExpansion": "none", "filter": True, "displayRequestDuration": True},
    }


def _calls(dependant: Dependant) -> Iterator[Any]:
    for sub in dependant.dependencies:
        yield sub.call
        yield from _calls(sub)


def _access(calls: list[Any], has_bearer: bool) -> tuple[str, list[str] | None]:
    """The Access line of an operation, and its roles when it is limited to specific roles."""
    # every require_roles on the route must pass, so only roles allowed by all of them count
    limits = [set(call.roles) for call in calls if hasattr(call, "roles")]
    if limits:
        roles = sorted(set.intersection(*limits))
        return ", ".join(roles), roles
    if get_current_user in calls:
        return "any signed-in user", None
    if has_bearer:  # checks the token itself, e.g. two-factor setup, which also takes the mfa_token from login
        return "bearer token required (see the two-factor notes at the top of this page)", None
    return "no bearer token required (see the description for any other credential)", None


def _document_access(schema: dict[str, Any], app: FastAPI) -> None:
    for context in routing.iter_route_contexts(app.routes):
        path_item = schema["paths"].get(getattr(context, "path_format", None))
        if not path_item or not isinstance(context.route, routing.APIRoute):
            continue
        calls = list(_calls(context.route.dependant))
        for method in context.methods or ():
            operation = path_item.get(method.lower())
            if operation is None:
                continue
            secured = bool(operation.get("security"))
            text, roles = _access(calls, secured)
            existing = operation.get("description")
            operation["description"] = f"**Access:** {text}" + (f"\n\n{existing}" if existing else "")
            if roles is not None:
                operation["x-roles"] = roles
            if secured:
                operation["responses"].setdefault("401", {"description": "Not signed in, or the token has expired", "content": ERROR_BODY})
            if roles is not None:
                operation["responses"].setdefault("403", {"description": "Not allowed for your role", "content": ERROR_BODY})


def install_openapi(app: FastAPI) -> None:
    """Add generated access information to the schema FastAPI builds."""

    def openapi() -> dict[str, Any]:
        if app.openapi_schema:
            return app.openapi_schema
        schema = FastAPI.openapi(app)
        bearer = schema.get("components", {}).get("securitySchemes", {}).get("HTTPBearer")
        if bearer:
            bearer["bearerFormat"] = "JWT"
            bearer["description"] = "The `access_token` from `POST /api/auth/login`, without the word Bearer."
        _document_access(schema, app)
        return schema

    app.openapi = openapi  # type: ignore[method-assign]
