#!/bin/bash
set -e

# Tale DB Entrypoint Wrapper
# This script maps DB_ prefixed environment variables to PostgreSQL configuration
# and then calls the original TimescaleDB entrypoint

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

# TimescaleDB settings
if [ -n "$DB_TIMESCALEDB_TELEMETRY" ]; then
    POSTGRES_ARGS+=("-c" "timescaledb.telemetry_level=${DB_TIMESCALEDB_TELEMETRY}")
    export TIMESCALEDB_TELEMETRY="${DB_TIMESCALEDB_TELEMETRY}"
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
echo "TimescaleDB Telemetry: ${DB_TIMESCALEDB_TELEMETRY:-off}"
echo "=================================================="

# ============================================================================
# Call the original TimescaleDB/PostgreSQL entrypoint
# ============================================================================
exec docker-entrypoint.sh "$@" "${POSTGRES_ARGS[@]}"

