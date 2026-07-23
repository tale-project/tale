#!/bin/bash
# Centralized environment normalization for the Tale platform container.
# Sourced by docker-entrypoint.sh and operator tooling; never prints secrets.
set -eo pipefail

# Normalize and export the environment the platform + Convex backend expect.
env_normalize_common() {
  # Application configuration
  export NODE_ENV="${NODE_ENV:-production}"
  export PORT="${PORT:-3000}"
  export HOSTNAME="${HOSTNAME:-0.0.0.0}"

  # Database configuration.
  # POSTGRES_URL may be given explicitly; otherwise it is derived from
  # DB_PASSWORD (+ DB_USER/DB_HOST/DB_PORT) for the default self-hosted
  # compose stack. The Convex postgres backend expects the URL WITHOUT a
  # database name in the path — it manages its own database.
  if [ -z "${POSTGRES_URL:-}" ]; then
    local db_user="${DB_USER:-tale}"
    if [ -z "${DB_PASSWORD:-}" ]; then
      echo "ERROR: DB_PASSWORD or POSTGRES_URL must be set" >&2
      exit 1
    fi
    local db_host="${DB_HOST:-db}"
    local db_port="${DB_PORT:-5432}"
    export POSTGRES_URL="postgresql://${db_user}:${DB_PASSWORD}@${db_host}:${db_port}"
    # Knowledge corpus lives in the separate tale_knowledge database
    # (ParadeDB image; private_knowledge + public_web schemas).
    export RAG_DATABASE_URL="postgresql://${db_user}:${DB_PASSWORD}@${db_host}:${db_port}/tale_knowledge"
  else
    export POSTGRES_URL="${POSTGRES_URL}"
    if [ -z "${RAG_DATABASE_URL:-}" ]; then
      export RAG_DATABASE_URL="${POSTGRES_URL}/tale_knowledge"
    fi
  fi

  # Cross-service URLs (Docker service names by default; override in .env).
  export SANDBOX_URL="${SANDBOX_URL:-http://sandbox:8003}"

  # Convex instance identity. INSTANCE_NAME is pinned to the database created
  # by init-scripts/02-create-convex-database.sql.
  export INSTANCE_NAME="tale_platform"
  export INSTANCE_SECRET="${INSTANCE_SECRET}"

  # Root config directory: per-org subtrees at $TALE_CONFIG_DIR/<orgSlug>/,
  # one subdir per domain. This is the ONLY config-path variable — the legacy
  # per-domain overrides (AGENTS_DIR etc.) are purged by the entrypoint.
  export TALE_CONFIG_DIR="${TALE_CONFIG_DIR:-/app/data}"

  # Canonical base URL; every other URL (Convex HTTP/WS) is derived in code.
  if [ -z "${SITE_URL:-}" ]; then
    echo "Error: SITE_URL is required. Set it in your .env file." >&2
    exit 1
  fi
  export SITE_URL="${SITE_URL}"
}

# Allow local dev without a configured secret; production must set one.
ensure_instance_secret() {
  if [ -z "${INSTANCE_SECRET:-}" ]; then
    echo "⚠️  INSTANCE_SECRET not set; using insecure local default."
    echo "   Set INSTANCE_SECRET in .env for production."
    export INSTANCE_SECRET="local-dev-insecure-secret"
  fi
}

# Tools that derive keys (generate-admin-key) need a real 64-hex secret.
ensure_hex_instance_secret() {
  if ! echo "${INSTANCE_SECRET:-}" | grep -Eq '^[0-9a-fA-F]{64}$'; then
    echo "Error: INSTANCE_SECRET must be a 64-character hex string. Set INSTANCE_SECRET in your .env." >&2
    exit 1
  fi
}
