FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts
COPY alembic.ini ./
COPY alembic ./alembic

RUN useradd --create-home appuser
USER appuser

EXPOSE 8000
# Applies pending migrations, then starts the API. The worker service overrides this command.
# Several schools (CONTROL_DATABASE_URL set): migrates every active school; a school whose
# migration fails is reported and the API still starts for the others.
CMD ["sh", "-c", "if [ -n \"$CONTROL_DATABASE_URL\" ]; then python -m scripts.tenants migrate-all || echo 'WARNING: some schools were not migrated'; else alembic upgrade head; fi && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips '*'"]
