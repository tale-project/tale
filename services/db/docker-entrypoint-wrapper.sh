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
# All init scripts use IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS
# so they are safe to re-run. This ensures schema, extensions, and indexes
# converge to the desired state on every container start — not just first init.

INIT_SCRIPTS_DIR="/etc/postgresql/init-scripts"
MIGRATIONS_DIR="/etc/postgresql/migrations/db/migrations"

run_init_scripts() {
    echo "Running init scripts..."
    for script in "$INIT_SCRIPTS_DIR"/*.sql; do
        [ -f "$script" ] || continue
        echo "  $(basename "$script")"
        psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$script" 2>&1 | grep -E "^(ERROR|FATAL|NOTICE)" || true
    done
    echo "Init scripts complete."
}

run_migrations() {
    if [ ! -d "$MIGRATIONS_DIR" ] || [ -z "$(ls -A "$MIGRATIONS_DIR" 2>/dev/null)" ]; then
        echo "No migrations found, skipping."
        return
    fi

    echo "Running tale_knowledge migrations..."
    dbmate --url "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/tale_knowledge?sslmode=disable" \
           --migrations-dir "$MIGRATIONS_DIR" \
           --no-dump-schema \
           migrate
    echo "Migrations complete."
}

# Run init scripts and migrations in the background after PostgreSQL starts.
# We wait until the target database is actually accessible (not just pg_isready)
# to avoid racing with docker-entrypoint.sh's first-time init which creates
# the POSTGRES_USER and POSTGRES_DB after starting a temporary server.
(
    trap 'exit 0' SIGTERM SIGINT
    until psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\q' 2>/dev/null; do
        sleep 1
    done
    run_init_scripts
    # dbmate connects via TCP — wait for the server to accept TCP connections
    # (the temp server during first-time init only listens on Unix socket)
    until pg_isready -U "$POSTGRES_USER" -h localhost -q 2>/dev/null; do
        sleep 1
    done
    run_migrations
    touch /tmp/.db_ready
    echo "Database ready."
) &

# ============================================================================
# Call the original PostgreSQL entrypoint
# ============================================================================
exec docker-entrypoint.sh "$@" "${POSTGRES_ARGS[@]}"

