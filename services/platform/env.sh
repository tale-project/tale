#!/bin/bash
# Centralized environment normalization for Tale Platform
set -e

# Normalize and export environment variables.
# Does not print or log secret values.
env_normalize_common() {
  # Next.js configuration
  export NODE_ENV="${NODE_ENV:-production}"
  export PORT="${PORT:-3000}"
  export HOSTNAME="${HOSTNAME:-0.0.0.0}"

  # Domain configuration - auto-derive URLs
  # DOMAIN should include the protocol (e.g., "http://localhost", "https://demo.tale.dev")
  local base_url="${DOMAIN:-http://localhost}"

  # Ensure DOMAIN includes a protocol, if not, add http:// as default
  if [[ ! "$base_url" =~ ^https?:// ]]; then
    base_url="http://${base_url}"
  fi

	  # Database configuration
	  # Auto-construct POSTGRES_URL from DB_PASSWORD if not explicitly set
	  # This allows the platform to work with self-hosted PostgreSQL by default
	  if [ -z "${POSTGRES_URL:-}" ]; then
	    local db_user="${DB_USER:-tale}"
	    local db_password="${DB_PASSWORD:-tale_password_change_me}"
	    local db_host="${DB_HOST:-db}"
	    local db_port="${DB_PORT:-5432}"
	    local db_name="${DB_NAME:-tale}"
	    # Convex backend for postgres-v5 expects URL without database name in path
	    # The database name is managed internally by Convex
	    export POSTGRES_URL="postgresql://${db_user}:${db_password}@${db_host}:${db_port}"
	    # Export the full URL with database name for services that need it (like RAG)
	    export POSTGRES_URL_WITH_DB="postgresql://${db_user}:${db_password}@${db_host}:${db_port}/${db_name}"
	  else
	    export POSTGRES_URL="${POSTGRES_URL}"
	    # If POSTGRES_URL is set explicitly, also set WITH_DB version
	    export POSTGRES_URL_WITH_DB="${POSTGRES_URL}"
	  fi

	  # Cross-service URLs (inside Docker)
	  # These defaults use Docker service names for inter-service communication.
	  # They can be overridden via environment variables in .env when needed.
	  export RAG_URL="${RAG_URL:-http://rag:8001}"
	  export CRAWLER_URL="${CRAWLER_URL:-http://crawler:8002}"
	  export SEARCH_SERVICE_URL="${SEARCH_SERVICE_URL:-http://search:8080}"

	  # Convex instance configuration
	  export INSTANCE_NAME="${INSTANCE_NAME:-tale_platform}"
	  export INSTANCE_SECRET="${INSTANCE_SECRET}"

  # AI provider keys
  export OPENAI_API_KEY="${OPENAI_API_KEY}"

  # Site URL - the canonical base URL for the platform
  # All other URLs (Convex HTTP API, WebSocket API, etc.) are derived from this in code
  export SITE_URL="${SITE_URL:-${base_url}}"
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

# Ensure INSTANCE_SECRET is a 64-char hex string; error out if not.
# Use in tools that require a cryptographically valid secret (e.g., generate_admin_key.sh).
ensure_hex_instance_secret() {
  if ! echo "${INSTANCE_SECRET:-}" | grep -Eq '^[0-9a-fA-F]{64}$'; then
    echo "Error: INSTANCE_SECRET must be a 64-character hex string. Set INSTANCE_SECRET in your .env." >&2
    exit 1
  fi
}

