#!/bin/bash
set -e

# ============================================================================
# Tale Crawler Docker Entrypoint
# ============================================================================
# 1. Build CRAWLER_DATABASE_URL from DB_* env vars if not explicitly set.
# 2. Run dbmate migrations (public_web schema). Retry up to 30× (2s apart) to
#    tolerate the race with the DB container's background init-scripts that
#    create `tale_knowledge`.
# 3. Exec uvicorn under tini (ENTRYPOINT passes tini; we exec the app here).

# --- Build database URL ----------------------------------------------------

if [ -z "${CRAWLER_DATABASE_URL:-}" ]; then
  if [ -z "${DB_PASSWORD:-}" ]; then
    echo "ERROR: DB_PASSWORD or CRAWLER_DATABASE_URL must be set" >&2
    exit 1
  fi
  DB_USER="${DB_USER:-tale}"
  DB_HOST="${DB_HOST:-db}"
  DB_PORT="${DB_PORT:-5432}"
  DB_NAME="${DB_NAME:-tale_knowledge}"
  export CRAWLER_DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
fi

# --- Apply migrations (with retry for DB init race) ------------------------

DBMATE_URL="${CRAWLER_DATABASE_URL}?sslmode=disable"
DBMATE_LOG="$(mktemp)"

echo "Applying crawler (public_web) migrations..."
for attempt in $(seq 1 30); do
  if dbmate \
      --url "${DBMATE_URL}" \
      --migrations-dir /app/migrations \
      --migrations-table public_web.schema_migrations \
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

exec uvicorn app.main:app \
  --host "${CRAWLER_HOST:-0.0.0.0}" \
  --port "${CRAWLER_PORT:-8002}" \
  --workers "${CRAWLER_WORKERS:-1}"
