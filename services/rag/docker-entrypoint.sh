#!/bin/bash
set -e

# ============================================================================
# Tale RAG Docker Entrypoint
# ============================================================================
# 1. Build RAG_DATABASE_URL from DB_* env vars if not explicitly set.
# 2. Run dbmate migrations (private_knowledge schema). Retry up to 30× (2s apart)
#    because the DB container's init-scripts create `tale_knowledge` in the
#    background after the DB healthcheck passes, so the first attempts may race.
# 3. Exec uvicorn as PID 1 so signals reach it cleanly.

# --- Build database URL ----------------------------------------------------

if [ -z "${RAG_DATABASE_URL:-}" ]; then
  if [ -z "${DB_PASSWORD:-}" ]; then
    echo "ERROR: DB_PASSWORD or RAG_DATABASE_URL must be set" >&2
    exit 1
  fi
  DB_USER="${DB_USER:-tale}"
  DB_HOST="${DB_HOST:-db}"
  DB_PORT="${DB_PORT:-5432}"
  DB_NAME="${DB_NAME:-tale_knowledge}"
  export RAG_DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
fi

# --- Apply migrations (with retry for DB init race) ------------------------

DBMATE_URL="${RAG_DATABASE_URL}?sslmode=disable"
DBMATE_LOG="$(mktemp)"

echo "Applying RAG (private_knowledge) migrations..."
for attempt in $(seq 1 30); do
  if dbmate \
      --url "${DBMATE_URL}" \
      --migrations-dir /app/migrations \
      --migrations-table private_knowledge.schema_migrations \
      --no-dump-schema \
      up >"${DBMATE_LOG}" 2>&1; then
    cat "${DBMATE_LOG}"
    rm -f "${DBMATE_LOG}"
    break
  fi
  if [ "${attempt}" -eq 30 ]; then
    echo "ERROR: dbmate migrate failed after 30 attempts:" >&2
    cat "${DBMATE_LOG}" >&2
    rm -f "${DBMATE_LOG}"
    exit 1
  fi
  sleep 2
done

# --- Start application -----------------------------------------------------

exec python -m uvicorn app.main:app \
  --host "${RAG_HOST:-0.0.0.0}" \
  --port "${RAG_PORT:-8001}" \
  --workers "${RAG_WORKERS:-1}"
