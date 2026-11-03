import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.monitoring import init_sentry, setup_logging
from app.core.tenancy import TenantMiddleware
from app.db.session import on_new_sessionmaker
from app.services import audit as audit_trail

setup_logging()
init_sentry("api")

if get_settings().secret_key.startswith("change-me"):
    # Development only: ENVIRONMENT=production refuses to start with this key.
    logging.getLogger("startup").warning("SECRET_KEY is the built-in default. Set a random value before deploying.")

on_new_sessionmaker(audit_trail.install)

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
# Several schools: route each request to its school's database by Host (no-op for one school).
app.add_middleware(TenantMiddleware)

app.include_router(api_router)
