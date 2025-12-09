#!/bin/bash
set -e

# ============================================================================
# Tale Platform Docker Entrypoint
# ============================================================================
# This script orchestrates the startup of three services:
# 1. Convex backend (local backend server on ports 3210/3211)
# 2. Next.js application (frontend on port 3000)
# 3. Convex Dashboard (admin UI on port 6791)
# ============================================================================

echo "🚀 Starting Tale Platform with integrated Convex backend..."

# ============================================================================
# Signal Handling
# ============================================================================

# PIDs for background processes
CONVEX_PID=""
NEXTJS_PID=""
DASHBOARD_PID=""

# Gracefully shutdown all services
shutdown() {
  echo "🛑 Shutting down services..."
  kill -TERM "$CONVEX_PID" "$NEXTJS_PID" "$DASHBOARD_PID" 2>/dev/null || true
  wait "$CONVEX_PID" "$NEXTJS_PID" "$DASHBOARD_PID" 2>/dev/null || true
  echo "✅ Services stopped"
  exit 0
}

trap shutdown SIGTERM SIGINT

# ============================================================================
# Environment Variable Normalization
# ============================================================================

# Centralized environment normalization
source "$(dirname "$0")/env.sh"
env_normalize_common

echo "🔍 Environment after normalization:"
echo "   DOMAIN=${DOMAIN}"
echo "   SITE_URL=${SITE_URL}"
echo "   PORT=${PORT}"

# Authentication configuration
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL}"
# Note: SITE_URL is already set by env_normalize_common, don't override it here

# Encryption configuration
export ENCRYPTION_SECRET_HEX="${ENCRYPTION_SECRET_HEX}"

# LLM provider configuration
export OPENAI_API_KEY="${OPENAI_API_KEY}"
export OPENAI_BASE_URL="${OPENAI_BASE_URL}"

# ============================================================================
# Helper Functions
# ============================================================================

# Detect database type from connection string
detect_database_type() {
  local url="$1"
  if [[ "$url" == postgresql* || "$url" == postgres* ]]; then
    echo "postgres"
  elif [[ "$url" == mysql* ]]; then
    echo "mysql"
  else
    echo "unknown"
  fi
}

# Extract database host from connection string
extract_db_host() {
  local url="$1"
  local db_type="$2"

  if [ "$db_type" = "postgres" ]; then
    echo "$url" | sed -E 's#^postgres(ql)?://([^@/]+@)?([^:/?]+).*#\3#'
  elif [ "$db_type" = "mysql" ]; then
    echo "$url" | sed -E 's#^mysql://([^@/]+@)?([^:/?]+).*#\2#'
  fi
}

# Extract database port from connection string
extract_db_port() {
  local url="$1"
  local db_type="$2"
  local default_port="$3"

  local port=""
  if [ "$db_type" = "postgres" ]; then
    port=$(echo "$url" | sed -nE 's#^postgres(ql)?://([^@/]+@)?[^:/?]+:([0-9]+).*#\3#p')
  elif [ "$db_type" = "mysql" ]; then
    port=$(echo "$url" | sed -nE 's#^mysql://([^@/]+@)?[^:/?]+:([0-9]+).*#\2#p')
  fi

  echo "${port:-$default_port}"
}

# Wait for a TCP port to be available
wait_for_port() {
  local host="$1"
  local port="$2"
  local timeout="${3:-60}"
  local service_name="${4:-Service}"

  echo "⏳ Waiting for ${service_name} at ${host}:${port}..."

  local counter=0
  while ! (echo > /dev/tcp/${host}/${port}) >/dev/null 2>&1; do
    counter=$((counter + 1))
    if [ $counter -gt $timeout ]; then
      echo "❌ ${service_name} at ${host}:${port} not reachable within ${timeout}s"
      return 1
    fi
    sleep 1
  done

  echo "✅ ${service_name} at ${host}:${port} is reachable"
  return 0
}

# Wait for HTTP endpoint to respond
wait_for_http() {
  local url="$1"
  local timeout="${2:-30}"
  local service_name="${3:-Service}"
  local allow_timeout="${4:-false}"

  echo "⏳ Waiting for ${service_name} at ${url}..."

  local counter=0
  until curl -sf "$url" > /dev/null 2>&1; do
    counter=$((counter + 1))
    if [ $counter -gt $timeout ]; then
      if [ "$allow_timeout" = "true" ]; then
        echo "⚠️  ${service_name} health check timeout (this may be normal)"
        return 0
      else
        echo "❌ ${service_name} failed to start within ${timeout}s"
        return 1
      fi
    fi
    sleep 1
  done

  echo "✅ ${service_name} is ready"
  return 0
}

# ============================================================================
# Database Configuration
# ============================================================================

# Determine which database to use (priority: POSTGRES_URL > MYSQL_URL > DATABASE_URL > SQLite)
configure_database() {
  local db_url=""
  local db_type=""

  # Determine database URL and type
  if [ -n "$POSTGRES_URL" ]; then
    db_url="$POSTGRES_URL"
    db_type="postgres"
  elif [ -n "$DATABASE_URL" ]; then
    db_url="$DATABASE_URL"
    db_type=$(detect_database_type "$db_url")
  elif [ -n "$MYSQL_URL" ]; then
    db_url="$MYSQL_URL"
    db_type="mysql"
  fi

  # Build database arguments for convex-local-backend
  if [ "$db_type" = "postgres" ]; then
    echo "   ✓ Using PostgreSQL database" >&2
    echo "-d postgres-v5 $db_url"
  elif [ "$db_type" = "mysql" ]; then
    echo "   ✓ Using MySQL database" >&2
    echo "-d mysql-v5 $db_url"
  else
    echo "   ✓ Using local SQLite database" >&2
    echo "/app/convex-data/convex_local_backend.sqlite3"
  fi
}

# Wait for external database to be ready
wait_for_database() {
  local db_url=""
  local db_type=""

  # Determine database URL and type
  if [ -n "$POSTGRES_URL" ]; then
    db_url="$POSTGRES_URL"
    db_type="postgres"
  elif [ -n "$DATABASE_URL" ]; then
    db_url="$DATABASE_URL"
    db_type=$(detect_database_type "$db_url")
  elif [ -n "$MYSQL_URL" ]; then
    db_url="$MYSQL_URL"
    db_type="mysql"
  fi

  # Only wait for external databases (not SQLite)
  if [ "$db_type" = "postgres" ] || [ "$db_type" = "mysql" ]; then
    local db_host=$(extract_db_host "$db_url" "$db_type")
    local default_port=5432
    [ "$db_type" = "mysql" ] && default_port=3306
    local db_port=$(extract_db_port "$db_url" "$db_type" "$default_port")

    if [ -n "$db_host" ] && [ -n "$db_port" ]; then
      wait_for_port "$db_host" "$db_port" 60 "Database" || exit 1
    fi
  fi
}

# ============================================================================
# Convex Backend Startup
# ============================================================================

# Hardcoded Convex ports (internal to container, proxied via Next.js)
CONVEX_BACKEND_PORT=3210
CONVEX_SITE_PROXY_PORT=3211
CONVEX_DASHBOARD_PORT=6791

echo "📦 Starting Convex backend on port ${CONVEX_BACKEND_PORT}..."

# Configure Convex backend logging
# Suppress expected retry/operational ERROR logs from the Convex backend:
# - common::errors: OCC (Optimistic Concurrency Control) retry errors from workflow component
# - isolate::client: Memory carry-over messages when isolates restart (normal behavior)
# - application::scheduled_jobs: Job retry/sleep messages (expected retry behavior)
# These are all normal operational messages that the backend handles automatically.
# Set RUST_LOG=info or RUST_LOG=debug in .env to see all logs for troubleshooting.
export RUST_LOG="${RUST_LOG:-info,common::errors=off,isolate::client=off,application::scheduled_jobs=off}"

# Prepare working directory
mkdir -p /app/convex-data
# Ensure temp dir on same filesystem as local storage to avoid cross-device rename (EXDEV)
export TMPDIR=/app/convex-data/tmp
mkdir -p "$TMPDIR"
cd /app

# Configure database
DB_ARGS=$(configure_database)

# Wait for database to be ready
wait_for_database

# Build Convex site arguments
SITE_ARGS="--site-proxy-port ${CONVEX_SITE_PROXY_PORT} --port ${CONVEX_BACKEND_PORT} --interface 0.0.0.0 --do-not-require-ssl"

# Derive Convex origin and site URL from SITE_URL
CONVEX_CLOUD_ORIGIN="${SITE_URL}/ws_api"
CONVEX_SITE_URL="${SITE_URL}/http_api"

SITE_ARGS="$SITE_ARGS --convex-origin $CONVEX_CLOUD_ORIGIN"
SITE_ARGS="$SITE_ARGS --convex-site $CONVEX_SITE_URL"

# Ensure instance secret is present (allows local dev fallback)
ensure_instance_secret

SITE_ARGS="$SITE_ARGS --instance-name $INSTANCE_NAME --instance-secret $INSTANCE_SECRET"

# Start Convex backend
convex-local-backend ${DB_ARGS} --local-storage /app/convex-data ${SITE_ARGS} &
CONVEX_PID=$!

# Wait for Convex backend to be ready
wait_for_http "http://localhost:${CONVEX_BACKEND_PORT}/version" 60 "Convex backend API" false || {
  kill -TERM "$CONVEX_PID" 2>/dev/null || true
  exit 1
}

wait_for_http "http://localhost:${CONVEX_SITE_PROXY_PORT}" 30 "Convex site proxy" true

# ============================================================================
# Convex Function Deployment
# ============================================================================

deploy_convex_functions() {
  echo "📤 Deploying Convex functions..."

  # Check if Convex project exists
  if [ ! -d "/app/convex" ]; then
    echo "⚠️  No convex/ directory found, skipping function deployment"
    return 0
  fi

  # Generate admin key for deployment
  ADMIN_KEY=$(generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")

  # Set HOME for npm to work properly
  export HOME=/home/nextjs

  # Set environment variables in Convex deployment
  echo "   Syncing ALL environment variables to Convex..."

  # List of environment variables to sync to Convex
  # These are the variables that Convex functions need access to
  ENV_VARS_TO_SYNC=(
    "SITE_URL"
    "ENCRYPTION_SECRET_HEX"
    "OPENAI_API_KEY"
    "OPENAI_BASE_URL"
    "OPENAI_MODEL"
    "BETTER_AUTH_SECRET"
    "AUTH_MICROSOFT_ENTRA_ID_ID"
    "AUTH_MICROSOFT_ENTRA_ID_SECRET"
    "AUTH_MICROSOFT_ENTRA_ID_TENANT_ID"
    "AUTH_MICROSOFT_ENTRA_ID_ISSUER"
    "CRAWLER_URL"
    "RAG_URL"
    "SEARCH_SERVICE_URL"
    "POSTGRES_URL"
    "RAG_DATABASE_URL"
    "GRAPH_DB_URL"
    "TRUSTED_HEADERS_ENABLED"
    "TRUSTED_EMAIL_HEADER"
    "TRUSTED_NAME_HEADER"
    "TRUSTED_ROLE_HEADER"
  )

  # Sync each environment variable if it's set
  for var_name in "${ENV_VARS_TO_SYNC[@]}"; do
    # Get the value of the environment variable
    var_value="${!var_name}"

    if [ -n "$var_value" ]; then
      echo "   ✓ Setting $var_name"
      npx convex env set "$var_name" "$var_value" \
        --url "http://localhost:${CONVEX_BACKEND_PORT}" \
        --admin-key "$ADMIN_KEY" 2>&1 || true
    else
      echo "   ⏭️  Skipping $var_name (not set)"
    fi
  done

  echo "   ✅ Environment variables synced to Convex"

  # Deploy functions
  echo "   Deploying functions..."
  if npx convex deploy --url "http://localhost:${CONVEX_BACKEND_PORT}" --admin-key "$ADMIN_KEY" --yes 2>&1; then
    echo "✅ Convex functions deployed successfully"
  else
    echo "⚠️  Convex function deployment failed (this may be normal on first run)"
  fi
}

deploy_convex_functions

# ============================================================================
# Next.js Application Startup
# ============================================================================

echo "🌐 Starting Next.js server on port ${PORT}..."
node server.js &
NEXTJS_PID=$!

wait_for_http "http://localhost:${PORT}/api/health" 30 "Next.js server" true

# ============================================================================
# Convex Dashboard Startup
# ============================================================================

echo "📊 Starting Convex Dashboard on port ${CONVEX_DASHBOARD_PORT}..."
cd /dashboard
# Derive deployment URL from SITE_URL for dashboard
NEXT_PUBLIC_DEPLOYMENT_URL="${SITE_URL}/ws_api" \
  PORT=${CONVEX_DASHBOARD_PORT} \
  HOSTNAME=0.0.0.0 \
  node server.js &
DASHBOARD_PID=$!
cd /app

wait_for_http "http://localhost:${CONVEX_DASHBOARD_PORT}" 30 "Convex Dashboard" true

# ============================================================================
# Startup Complete - Derive display URLs from SITE_URL
# ============================================================================

# Display URLs use SITE_URL (which includes protocol and domain)
# For localhost development, SITE_URL will be like "http://localhost:3000"
# For production, SITE_URL will be like "https://demo.tale.dev"
DISPLAY_BASE_URL="${SITE_URL:-http://localhost:${PORT}}"

echo ""
echo "🎉 Tale Platform is running!"
echo ""
echo "   📱 Next.js Application:  ${DISPLAY_BASE_URL}"
echo "   🔌 Convex API:           ${DISPLAY_BASE_URL}/ws_api"
echo "   ⚡ Convex Actions:        ${DISPLAY_BASE_URL}/http_api"
echo "   📊 Convex Dashboard:     ${DISPLAY_BASE_URL}/convex-dashboard"
echo ""

# Wait for all background processes
wait "$CONVEX_PID" "$NEXTJS_PID" "$DASHBOARD_PID"

