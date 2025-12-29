#!/bin/bash
set -e

# ============================================================================
# Tale RAG Docker Entrypoint
# ============================================================================
# Auto-construct RAG_DATABASE_URL from DB_PASSWORD if not explicitly set
# This matches the pattern used in the platform service

# Auto-construct RAG_DATABASE_URL from DB_* env vars if not explicitly set
if [ -z "${RAG_DATABASE_URL:-}" ]; then
  DB_USER="${DB_USER:-tale}"
  DB_PASSWORD="${DB_PASSWORD:-tale_password_change_me}"
  DB_HOST="${DB_HOST:-db}"
  DB_PORT="${DB_PORT:-5432}"
  DB_NAME="${DB_NAME:-tale}"
  export RAG_DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
fi

# Start the application with environment variables
exec python -m uvicorn app.main:app \
  --host "${RAG_HOST:-0.0.0.0}" \
  --port "${RAG_PORT:-8001}" \
  --workers "${RAG_WORKERS:-2}" \
  --limit-max-requests "${RAG_MAX_REQUESTS_PER_WORKER:-100000}"
