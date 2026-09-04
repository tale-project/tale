#!/bin/bash
# Centralized environment normalization for the Tale platform container.
# Sourced by docker-entrypoint.sh and operator tooling; never prints secrets.
set -eo pipefail

# Normalize and export the environment the platform web tier and the
# application backend expect.
env_normalize_common() {
  # Application configuration
  export NODE_ENV="${NODE_ENV:-production}"
  export PORT="${PORT:-3000}"
  export HOSTNAME="${HOSTNAME:-0.0.0.0}"

  # Database configuration.
  # POSTGRES_URL may be given explicitly; otherwise it is derived from
  # DB_PASSWORD (+ DB_USER/DB_HOST/DB_PORT) for the default self-hosted
  # compose stack. The URL carries NO database name in its path: the
  # knowledge URL below appends `/tale_knowledge`, and the backend tier gets
  # its own DATABASE_URL (`…/tale_app`) from compose.
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

  # Instance identity: the secret every derived key (WebDAV app passwords,
  # sandbox stage tokens) is seeded from.
  export INSTANCE_SECRET="${INSTANCE_SECRET}"

  # Root config directory: per-org subtrees at $TALE_CONFIG_DIR/<orgSlug>/,
  # one subdir per domain. This is the ONLY config-path variable — the legacy
  # per-domain overrides (AGENTS_DIR etc.) are purged by the entrypoint.
  export TALE_CONFIG_DIR="${TALE_CONFIG_DIR:-/app/data}"

  # Canonical base URL; every other public URL is derived from it in code.
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
