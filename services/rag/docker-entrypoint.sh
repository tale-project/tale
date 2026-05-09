#!/bin/bash
set -e

# ============================================================================
# Tale RAG Docker Entrypoint
# ============================================================================
# 1. Verify /app/data is writable as the unprivileged `app` user (UID 1001).
# 2. Build RAG_DATABASE_URL from DB_* env vars if not explicitly set.
# 3. Run dbmate migrations (private_knowledge schema). Retry up to 30× (2s apart)
#    because the DB container's init-scripts create `tale_knowledge` in the
#    background after the DB healthcheck passes, so the first attempts may race.
# 4. Exec uvicorn as PID 1 so signals reach it cleanly.

# --- Verify writable data dir ----------------------------------------------
# The container runs as UID 1001 (see Dockerfile). A host bind mount whose
# owner UID differs from 1001 will silently strip write access — fail fast
# here with a clear remediation hint rather than crashing mid-request.

DATA_DIR="/app/data"
if ! touch "${DATA_DIR}/.write-probe" 2>/dev/null; then
  echo "ERROR: ${DATA_DIR} is not writable as $(id -un) (uid=$(id -u), gid=$(id -g))." >&2
  echo "       If you bind-mount a host directory at ${DATA_DIR}, run:" >&2
  echo "         sudo chown -R 1001:1001 <host-path>" >&2
  echo "       The default named volume (rag-data) inherits container ownership and needs no action." >&2
  exit 1
fi
rm -f "${DATA_DIR}/.write-probe"

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
    # Round-2 V9 P1-Z: redact the connection-URL password before
    # streaming the dbmate log to stderr. Without this, a single
    # failed deploy leaks `password=<secret>` into container logs that
    # often persist on the host's `journalctl` history. Pattern is
    # `:<password>@` in `postgres://<user>:<password>@<host>...`.
    sed -E 's#(postgres(ql)?://[^:]+:)[^@]+@#\1***REDACTED***@#g' \
      "${DBMATE_LOG}" >&2
    rm -f "${DBMATE_LOG}"
    exit 1
  fi
  sleep 2
done

# --- Auth-token presence warning -------------------------------------------
# Round-2 v16 / B2 follow-up: the app code falls back to presence-based
# auth (no token = no auth required). That is intentional for dev /
# in-network deployments, but operators upgrading without setting
# RAG_AUTH_TOKEN expose every endpoint to the container LAN. Loud
# stderr line at startup so the operator log makes the choice explicit.

if [ -z "${RAG_AUTH_TOKEN:-}" ]; then
  echo "[SECURITY] RAG_AUTH_TOKEN is unset — RAG endpoints accept unauthenticated requests on the container network. Set RAG_AUTH_TOKEN before exposing this deployment to untrusted clients." >&2
fi

# --- Start application -----------------------------------------------------

exec python -m uvicorn app.main:app \
  --host "${RAG_HOST:-0.0.0.0}" \
  --port "${RAG_PORT:-8001}" \
  --workers "${RAG_WORKERS:-1}"
