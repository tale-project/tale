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

# --- Deployment-level data-store override (instance data residency) --------
# A deployment.json at the config root can point this service at an EXTERNAL
# knowledge Postgres (set via the admin UI, or hand-edited by an operator).
# When present we derive RAG_DATABASE_URL from it, overriding the DB_* build
# below. Applied at boot only — changing it requires a restart.
#
# FAIL CLOSED: a present-but-unparseable config, an undecryptable secret, or a
# config missing required fields aborts boot rather than silently falling back
# to the bundled DB — mis-routing a customer's regulated data is worse than
# not starting. An ABSENT config means "use the .env default" (unchanged).
# The config is WRITTEN by the Convex action into the convex-data volume and
# surfaced here READ-ONLY via the shared-config mount (TALE_PLATFORM_SHARED_CONFIG_DIR,
# /app/platform-config). Prefer it over the per-service TALE_CONFIG_DIR (which in
# RAG is the unrelated rag-data volume) — mirrors tale_shared/config/providers.py.
DEPLOY_CFG_ROOT="${TALE_PLATFORM_SHARED_CONFIG_DIR:-${TALE_CONFIG_DIR:-/app/data}}"
DEPLOY_CFG="${DEPLOY_CFG_ROOT}/deployment.json"
DEPLOY_SECRETS="${DEPLOY_CFG_ROOT}/deployment.secrets.json"
if [ -f "${DEPLOY_CFG}" ]; then
  if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: ${DEPLOY_CFG} present but 'jq' is not installed in this image." >&2
    exit 1
  fi
  if ! jq -e . "${DEPLOY_CFG}" >/dev/null 2>&1; then
    echo "ERROR: ${DEPLOY_CFG} is present but not valid JSON (fail-closed)." >&2
    exit 1
  fi
  # RFC 3986 percent-encode a string for safe use in a connection URL.
  urlencode() { jq -rn --arg x "$1" '$x|@uri'; }
  kp_host="$(jq -r '.dataStores.knowledgePostgres.host // empty' "${DEPLOY_CFG}")"
  if [ -n "${kp_host}" ]; then
    kp_port="$(jq -r '.dataStores.knowledgePostgres.port // 5432' "${DEPLOY_CFG}")"
    kp_db="$(jq -r '.dataStores.knowledgePostgres.database // empty' "${DEPLOY_CFG}")"
    kp_user="$(jq -r '.dataStores.knowledgePostgres.user // empty' "${DEPLOY_CFG}")"
    kp_sslmode="$(jq -r '.dataStores.knowledgePostgres.sslmode // "require"' "${DEPLOY_CFG}")"
    if [ -z "${kp_db}" ] || [ -z "${kp_user}" ]; then
      echo "ERROR: ${DEPLOY_CFG} knowledgePostgres is missing database/user (fail-closed)." >&2
      exit 1
    fi
    kp_pass=""
    if [ -f "${DEPLOY_SECRETS}" ]; then
      # The secrets sidecar is hybrid: SOPS-encrypted when an age key is
      # configured, plaintext JSON otherwise (a supported mode — see
      # platform/convex/lib/sops.ts isSopsEncryptedShape). Detect the shape
      # before decrypting so plaintext mode doesn't fail-closed on `sops -d`.
      if jq -e 'has("sops")' "${DEPLOY_SECRETS}" >/dev/null 2>&1; then
        if ! dec="$(sops -d --output-type json "${DEPLOY_SECRETS}")"; then
          echo "ERROR: could not decrypt ${DEPLOY_SECRETS} (fail-closed). Is SOPS_AGE_KEY / SOPS_AGE_KEY_FILE set?" >&2
          exit 1
        fi
      else
        dec="$(cat "${DEPLOY_SECRETS}")"
      fi
      kp_pass="$(printf '%s' "${dec}" | jq -r '."dataStores.knowledgePostgres.password" // empty')"
    fi
    # Percent-encode userinfo so a credential with URL-reserved chars
    # (@ : / ? # %) can't corrupt or smuggle into the connection URL.
    export RAG_DATABASE_URL="postgresql://$(urlencode "${kp_user}"):$(urlencode "${kp_pass}")@${kp_host}:${kp_port}/${kp_db}?sslmode=${kp_sslmode}"
    echo "Deployment config: RAG knowledge DB → ${kp_host}:${kp_port}/${kp_db} (sslmode=${kp_sslmode})"
    echo "       Reminder: an external knowledge DB must run ParadeDB (pgvector + pg_search) for full hybrid search; plain pgvector degrades to vector-only."
  fi
fi

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

# Built-in URL has no query string → default sslmode=disable (local DB). An
# external knowledge DB (deployment.json) already carries `?sslmode=…`; use it
# as-is rather than appending a second, conflicting query.
case "${RAG_DATABASE_URL}" in
  *\?*) DBMATE_URL="${RAG_DATABASE_URL}" ;;
  *) DBMATE_URL="${RAG_DATABASE_URL}?sslmode=disable" ;;
esac
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
