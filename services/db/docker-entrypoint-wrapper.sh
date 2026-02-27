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
export POSTGRES_PASSWORD="${DB_PASSWORD:-${POSTGRES_PASSWORD:-tale_password_change_me}}"

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

run_init_scripts() {
    echo "Running init scripts..."
    for script in "$INIT_SCRIPTS_DIR"/*.sql; do
        [ -f "$script" ] || continue
        echo "  $(basename "$script")"
        psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$script" 2>&1 | grep -E "^(ERROR|NOTICE)" || true
    done
    echo "Init scripts complete."
}

# Run init scripts in the background after PostgreSQL starts
(
    until pg_isready -U "$POSTGRES_USER" -q 2>/dev/null; do
        sleep 1
    done
    run_init_scripts
) &

# ============================================================================
# Call the original PostgreSQL entrypoint
# ============================================================================
exec docker-entrypoint.sh "$@" "${POSTGRES_ARGS[@]}"

