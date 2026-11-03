import logging

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import (
    academic,
    accounts,
    attendance,
    audit,
    auth,
    calendar,
    cms,
    exams,
    finance,
    library,
    messages,
    notices,
    online_exams,
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
for module in (auth, students, academic, exams, attendance, finance, library, notices, messages, online_exams, system, audit, years, calendar):
    api.include_router(module.router)
for router in accounts.routers:
    api.include_router(router)
api.include_router(cms.public)
api.include_router(cms.admin)
api.include_router(transport.router)


@api.get("/health", tags=["system"])
def health():
    return {"status": "ok"}


app.include_router(api)
