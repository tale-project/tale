#!/bin/bash
# Centralized environment normalization for the Tale Convex service.
# This is the minimal subset needed for convex-local-backend + Dashboard.
# Application-level secrets (BETTER_AUTH_SECRET, SOPS_AGE_KEY, etc.) are
# pushed from the platform service via `bunx convex env set` and are NOT
# consumed by this container directly.
set -e

env_normalize_common() {
  # Database configuration
  # Auto-construct POSTGRES_URL from DB_PASSWORD if not explicitly set.
  if [ -z "${POSTGRES_URL:-}" ]; then
    local db_user="${DB_USER:-tale}"
    if [ -z "${DB_PASSWORD:-}" ]; then
      echo "ERROR: DB_PASSWORD or POSTGRES_URL must be set" >&2
      exit 1
    fi
    local db_password="${DB_PASSWORD}"
    local db_host="${DB_HOST:-db}"
    local db_port="${DB_PORT:-5432}"
    # Convex backend (postgres-v5 driver) expects URL without database name.
    export POSTGRES_URL="postgresql://${db_user}:${db_password}@${db_host}:${db_port}"
  else
    export POSTGRES_URL="${POSTGRES_URL}"
  fi

  # Convex instance configuration.
  # INSTANCE_NAME is hardcoded; matches the database name created by
  # init-scripts/02-create-convex-database.sql in the bundled db image.
  export INSTANCE_NAME="tale_platform"
  export INSTANCE_SECRET="${INSTANCE_SECRET}"

  # Dashboard NEXT_PUBLIC_DEPLOYMENT_URL is derived from SITE_URL.
  if [ -z "${SITE_URL:-}" ]; then
    echo "Error: SITE_URL is required. Set it in your .env file." >&2
    exit 1
  fi
  export SITE_URL="${SITE_URL}"
}

# Ensure INSTANCE_SECRET exists; if not, set an insecure local default.
# Use only in entrypoint to allow local dev without a configured secret.
ensure_instance_secret() {
  if [ -z "${INSTANCE_SECRET:-}" ]; then
    echo "⚠️  INSTANCE_SECRET not set; using insecure local default."
    echo "   Set INSTANCE_SECRET in .env for production."
    export INSTANCE_SECRET="local-dev-insecure-secret"
  fi
}
