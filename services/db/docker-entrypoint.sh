#!/bin/bash
set -e

# Tale DB Entrypoint Wrapper
# This script maps DB_ prefixed environment variables to PostgreSQL configuration
# and then calls the original PostgreSQL entrypoint

# ============================================================================
# Map DB_ environment variables to PostgreSQL standard variables
# ============================================================================

# Database credentials
export POSTGRES_DB="${DB_NAME:-${POSTGRES_DB:-tale}}"
export POSTGRES_USER="${DB_USER:-${POSTGRES_USER:-tale}}"
if [ -z "${DB_PASSWORD:-${POSTGRES_PASSWORD:-}}" ]; then
  echo "ERROR: DB_PASSWORD or POSTGRES_PASSWORD must be set" >&2
  exit 1
fi
export POSTGRES_PASSWORD="${DB_PASSWORD:-${POSTGRES_PASSWORD}}"

# ============================================================================
# Build PostgreSQL command-line arguments from DB_ variables
# ============================================================================

POSTGRES_ARGS=()

# Connection settings
if [ -n "$DB_MAX_CONNECTIONS" ]; then
    POSTGRES_ARGS+=("-c" "max_connections=${DB_MAX_CONNECTIONS}")
fi

# Memory settings
if [ -n "$DB_SHARED_BUFFERS" ]; then
    POSTGRES_ARGS+=("-c" "shared_buffers=${DB_SHARED_BUFFERS}")
fi

if [ -n "$DB_EFFECTIVE_CACHE_SIZE" ]; then
    POSTGRES_ARGS+=("-c" "effective_cache_size=${DB_EFFECTIVE_CACHE_SIZE}")
fi

if [ -n "$DB_MAINTENANCE_WORK_MEM" ]; then
    POSTGRES_ARGS+=("-c" "maintenance_work_mem=${DB_MAINTENANCE_WORK_MEM}")
fi

if [ -n "$DB_WORK_MEM" ]; then
    POSTGRES_ARGS+=("-c" "work_mem=${DB_WORK_MEM}")
fi

# Logging settings
if [ -n "$DB_LOG_STATEMENT" ]; then
    POSTGRES_ARGS+=("-c" "log_statement=${DB_LOG_STATEMENT}")
fi

if [ -n "$DB_LOG_MIN_DURATION_STATEMENT" ]; then
    POSTGRES_ARGS+=("-c" "log_min_duration_statement=${DB_LOG_MIN_DURATION_STATEMENT}")
fi

# ============================================================================
# Load custom configuration file
# ============================================================================
POSTGRES_ARGS+=("-c" "config_file=/etc/postgresql/postgresql.conf")

# ============================================================================
# Print configuration info (for debugging)
# ============================================================================
echo "=================================================="
echo "Tale DB Starting"
echo "=================================================="
echo "Database: ${POSTGRES_DB}"
echo "User: ${POSTGRES_USER}"
echo "Max Connections: ${DB_MAX_CONNECTIONS:-100}"
echo "Shared Buffers: ${DB_SHARED_BUFFERS:-256MB}"
echo "Effective Cache Size: ${DB_EFFECTIVE_CACHE_SIZE:-1GB}"
echo "=================================================="

# ============================================================================
# Post-start init scripts (idempotent, run on every startup)
# ============================================================================
# Init scripts create shared infrastructure: databases, extensions, schema
# namespaces, and role grants. They use IF NOT EXISTS / CREATE OR REPLACE /
# DROP IF EXISTS so they are safe to re-run on every container start.
#
# After the init scripts, the migration set for this container's role is applied
# from the dbmate migrations baked into the image — see apply_migrations_for_role
# below. The db and knowledge-db services run the same image, so TALE_DB_ROLE (set
# per-service in compose.yml), not the image, decides which set applies:
#   knowledge → migrations/knowledge-db/<schema>/ against the `tale_knowledge` DB
#   platform  → migrations/db/ (empty: the platform DB `tale_app` is migrated by
#               the platform backend at boot, not by dbmate)
# Gating /tmp/.db_ready on this (not just pg_isready) is what lets dependents wait
# for the tables, not just the socket.

INIT_SCRIPTS_DIR="/etc/postgresql/init-scripts"
MIGRATIONS_DIR="/etc/postgresql/migrations"
KNOWLEDGE_MIGRATIONS_DIR="${MIGRATIONS_DIR}/knowledge-db"
KNOWLEDGE_DB_NAME="${KNOWLEDGE_DB_NAME:-tale_knowledge}"
# Which migration set this container applies. Default `knowledge` so a
# misconfigured or standalone run never leaves the corpus DB tableless; the
# platform `db` service sets TALE_DB_ROLE=platform in compose.yml to skip.
TALE_DB_ROLE="${TALE_DB_ROLE:-knowledge}"

run_init_scripts() {
    echo "Running init scripts..."
    for script in "$INIT_SCRIPTS_DIR"/*.sql; do
        [ -f "$script" ] || continue
        echo "  $(basename "$script")"
        # ON_ERROR_STOP + an explicit exit-code check: a failing init script (e.g.
        # the connection dropping mid-run, or a bad statement) MUST propagate so
        # the caller never publishes /tmp/.db_ready against a half-initialized
        # cluster. The previous `psql ... | grep || true` swallowed both psql's
        # exit code (it became grep's) and every SQL error, which let a failed
        # database-creating script set readiness with that database missing.
        if ! psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$script"; then
            echo "ERROR: init script failed: $(basename "$script")" >&2
            return 1
        fi
    done
    echo "Init scripts complete."
}

# Apply one schema's dbmate migrations against the local tale_knowledge DB, with
# a retry loop: the corpus DB is created by the init scripts that ran just above,
# and on first-time init PostgreSQL briefly bounces from its temporary bootstrap
# server to the real one, so the first connection attempts can fail transiently.
# Each schema keeps its own schema-scoped tracking table (private_knowledge.
# schema_migrations / public_web.schema_migrations) — hence one dbmate run per
# per-schema subdirectory.
dbmate_up_schema() {
    local schema="$1"
    local dir="${KNOWLEDGE_MIGRATIONS_DIR}/${schema}"
    if [ ! -d "$dir" ]; then
        echo "  WARN: no migrations directory for ${schema} (${dir}); skipping." >&2
        return 0
    fi
    # Local connection; sslmode=disable (no TLS on the in-container loopback).
    # nosemgrep: tools.opengrep.rules.trailofbits.generic.postgres-insecure-sslmode.postgres-insecure-sslmode -- intentional: 127.0.0.1 in-container loopback to the same pod's Postgres; TLS is not configured on the local socket and adds no security across the loopback
    local url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${KNOWLEDGE_DB_NAME}?sslmode=disable"
    local log
    log="$(mktemp)"
    local attempt
    echo "  Applying ${schema} migrations (dbmate)..."
    for attempt in $(seq 1 30); do
        if dbmate \
            --url "$url" \
            --migrations-dir "$dir" \
            --migrations-table "${schema}.schema_migrations" \
            --no-dump-schema \
            up >"$log" 2>&1; then
            cat "$log"
            rm -f "$log"
            return 0
        fi
        if [ "$attempt" -eq 30 ]; then
            echo "ERROR: dbmate (${schema}) failed after 30 attempts:" >&2
            # Redact the connection-URL password before streaming the log to stderr.
            sed -E 's#(postgres(ql)?://[^:]+:)[^@]+@#\1***REDACTED***@#g' "$log" >&2
            rm -f "$log"
            return 1
        fi
        sleep 2
    done
}

# Create the knowledge-corpus tables by applying the baked-in dbmate migrations.
# Idempotent, so it runs on every start (and harmlessly on the platform `db`
# container too, whose tale_knowledge DB is otherwise unused). Fails loudly so
# /tmp/.db_ready is never set on a half-migrated corpus DB.
apply_knowledge_migrations() {
    echo "Applying knowledge-corpus migrations..."
    dbmate_up_schema "private_knowledge" || return 1
    dbmate_up_schema "public_web" || return 1
    echo "Knowledge-corpus migrations complete."
}

# Apply the migration set for this container's role (TALE_DB_ROLE). The db and
# knowledge-db services share this image, so the role — not the image — selects
# which set runs.
apply_migrations_for_role() {
    case "$TALE_DB_ROLE" in
        knowledge)
            apply_knowledge_migrations || return 1
            ;;
        platform)
            echo "TALE_DB_ROLE=platform: the tale_app schema is migrated by the platform backend at boot; no dbmate migrations to apply."
            ;;
        *)
            echo "WARN: unknown TALE_DB_ROLE='${TALE_DB_ROLE}'; defaulting to knowledge migrations." >&2
            apply_knowledge_migrations || return 1
            ;;
    esac
}

# Run init scripts in the background, once the REAL server is up.
#
# On first-time init the upstream postgres entrypoint runs a TEMPORARY bootstrap
# server to create POSTGRES_USER/POSTGRES_DB, then stops it before exec'ing the
# real server. That bootstrap server is started with `listen_addresses=''`, so it
# is reachable on the local UNIX socket but NEVER on TCP. Gating on a socket probe
# (`psql -d "$POSTGRES_DB"`) therefore races first-time init: the loop can latch
# onto the bootstrap server and run the init scripts against it just as the
# entrypoint tears it down — a database-creating script dies mid-run, its
# database (`tale_knowledge`, `tale_app`) is never created, yet readiness still
# gets published. Probing TCP on 127.0.0.1 instead proves the *real* server is
# up (the bootstrap server can't answer there), eliminating the race.
#
# Init + migrations are then retried as a unit, and /tmp/.db_ready is touched ONLY
# after both genuinely succeed, so dependents (gated on `.db_ready`) never start
# against a half-initialized cluster.
(
    trap 'exit 0' SIGTERM SIGINT
    until pg_isready -h 127.0.0.1 -p 5432 -U "$POSTGRES_USER" >/dev/null 2>&1; do
        sleep 1
    done
    attempt=0
    until run_init_scripts && apply_migrations_for_role; do
        attempt=$((attempt + 1))
        if [ "$attempt" -ge 30 ]; then
            echo "ERROR: database init did not complete after ${attempt} attempts; not marking ready." >&2
            exit 1
        fi
        echo "Database init incomplete (attempt ${attempt}); retrying in 2s..." >&2
        sleep 2
    done
    touch /tmp/.db_ready
    echo "Database ready."
) &

# ============================================================================
# Call the original PostgreSQL entrypoint
# ============================================================================
# Renamed from `docker-entrypoint.sh` in the Dockerfile so this `exec` doesn't
# resolve back to this very script and spin forever.
exec postgres-entrypoint.sh "$@" "${POSTGRES_ARGS[@]}"

