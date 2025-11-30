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

  # Convex backend ports
  export CONVEX_BACKEND_PORT="${CONVEX_BACKEND_PORT:-3210}"
  export CONVEX_SITE_PROXY_PORT="${CONVEX_SITE_PROXY_PORT:-3211}"
  export CONVEX_DASHBOARD_PORT="${CONVEX_DASHBOARD_PORT:-6791}"

  # Domain configuration - auto-derive URLs
  # DOMAIN should include the protocol (e.g., "http://localhost", "https://demo.tale.dev")
  local base_url="${DOMAIN:-http://localhost}"
  local port="${PORT:-3000}"

  # Ensure DOMAIN includes a protocol, if not, add http:// as default
  if [[ ! "$base_url" =~ ^https?:// ]]; then
    base_url="http://${base_url}"
  fi

  # Add port for localhost if not already present
  if [[ "$base_url" == "http://localhost" ]]; then
    base_url="${base_url}:${port}"
  fi

	  # Database configuration
	  export POSTGRES_URL="${POSTGRES_URL}"

	  # Cross-service URLs (inside Docker)
	  # These defaults use Docker service names for inter-service communication.
	  # They can be overridden via environment variables in .env when needed.
	  export RAG_URL="${RAG_URL:-http://rag:8001}"
	  export CRAWLER_URL="${CRAWLER_URL:-http://crawler:8002}"
	  export SEARCH_SERVICE_URL="${SEARCH_SERVICE_URL:-http://search:8080}"

	  # Convex instance configuration
	  export INSTANCE_NAME="${INSTANCE_NAME:-tale_platform}"
	  export INSTANCE_SECRET="${INSTANCE_SECRET}"

  # Convex URLs - backend-to-backend communication (Platform -> Convex)
  # Use the base URL with proxy paths for backend-to-backend communication
  export CONVEX_CLOUD_ORIGIN="${CONVEX_CLOUD_ORIGIN:-${base_url}/ws_api}"
  export CONVEX_SITE_ORIGIN="${CONVEX_SITE_ORIGIN:-${base_url}/http_api}"
  export CONVEX_DEPLOYMENT="${CONVEX_DEPLOYMENT:-local}"

  # AI provider keys
  export OPENAI_API_KEY="${OPENAI_API_KEY}"

  # Frontend configuration - auto-derive from domain
  # Client-side URLs use the base URL (which now includes port for localhost)
  export NEXT_PUBLIC_CONVEX_URL="${NEXT_PUBLIC_CONVEX_URL:-${base_url}/ws_api}"
  export NEXT_PUBLIC_CONVEX_SITE_URL="${NEXT_PUBLIC_CONVEX_SITE_URL:-${base_url}/http_api}"
  export NEXT_PUBLIC_DEPLOYMENT_URL="${NEXT_PUBLIC_DEPLOYMENT_URL:-${base_url}/ws_api}"
  export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-${base_url}}"

  # Site URL for Better Auth (used by Convex functions and Next.js server-side)
  # For internal container-to-self communication within Docker
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

