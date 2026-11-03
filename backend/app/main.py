import logging

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import (
    academic,
    accounts,
    admissions,
    attendance,
    audit,
    auth,
    calendar,
    cms,
    exams,
    export,
    fees,
    finance,
    homework,
    hr,
    leave,
    library,
    meetings,
    messages,
    notices,
    online_exams,
    records,
    report_cards,
    students,
    system,
    transport,
    years,
)
from app.core.config import get_settings
from app.db import SessionLocal
from app.services import audit as audit_trail

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

if get_settings().secret_key.startswith("change-me"):
    # Development only: ENVIRONMENT=production refuses to start with this key.
    logging.getLogger("startup").warning("SECRET_KEY is the built-in default. Set a random value before deploying.")

audit_trail.install(SessionLocal)

app = FastAPI(
    title="School Management API",
    version="1.0.0",
    description="FastAPI backend for the school management system (shares the legacy `sms` MySQL schema).",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")
# One module per line: each feature adds its own line here.
ROUTERS = (
    auth.router,
    students.router,
    academic.router,
    exams.router,
    attendance.router,
    finance.router,
    library.router,
    notices.router,
    messages.router,
    online_exams.router,
    system.router,
    audit.router,
    years.router,
    calendar.router,
    homework.router,
    export.router,
    leave.router,
    report_cards.router,
    fees.router,
    meetings.router,
    hr.router,
    transport.router,
    records.router,
    *accounts.routers,
    cms.public,
    records.public,
    admissions.public,
    admissions.router,
    admissions.enquiries,
    cms.admin,
)
for router in ROUTERS:
    api.include_router(router)


@api.get("/health", tags=["system"])
def health():
    return {"status": "ok"}


app.include_router(api)
