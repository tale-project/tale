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
# Signal Handling - Graceful Shutdown for Blue-Green Deployments
# ============================================================================

# PIDs for background processes
CONVEX_PID=""
NEXTJS_PID=""
DASHBOARD_PID=""
MONITOR_PID=""

# Shutdown marker file - health check will return 503 when this exists
SHUTDOWN_MARKER="/tmp/shutting_down"

# Clear any stale shutdown marker from previous runs
rm -f "$SHUTDOWN_MARKER"

# PID file for Convex process (shared between main script and monitor subshell)
CONVEX_PID_FILE="/app/convex-data/convex.pid"

# Lock file for blue-green deployment coordination
# Prevents restart loops when both blue and green containers are running
CONVEX_LOCK_FILE="/app/convex-data/convex.lock"
CONTAINER_NAME=$(hostname)

# Gracefully shutdown all services with connection draining
# This supports zero-downtime blue-green deployments by:
# 1. Creating shutdown marker (health checks will fail)
# 2. Waiting for load balancer to stop sending traffic
# 3. Waiting for in-flight requests to complete
# 4. Sending SIGTERM to gracefully stop services
shutdown() {
  echo "🛑 Starting graceful shutdown..."

  # Step 1: Signal that we're shutting down
  # The health check endpoint can check for this marker
  touch "$SHUTDOWN_MARKER"
  echo "   ✓ Shutdown marker created"

  # Step 2: Wait for load balancer to detect unhealthy status
  # Caddy health checks run every 3s, so wait 2 health check cycles
  local drain_wait="${SHUTDOWN_DRAIN_SECONDS:-6}"
  echo "   ⏳ Waiting ${drain_wait}s for load balancer to stop routing traffic..."
  sleep "$drain_wait"

  # Step 3: Wait for in-flight requests to complete
  # Give requests a grace period to finish
  local grace_period="${SHUTDOWN_GRACE_SECONDS:-5}"
  echo "   ⏳ Waiting ${grace_period}s for in-flight requests to complete..."
  sleep "$grace_period"

  # Read current Convex PID from file (may have been updated by monitor subshell)
  local current_convex_pid
  current_convex_pid=$(cat "$CONVEX_PID_FILE" 2>/dev/null || echo "")

  # Step 4: Send SIGTERM to all services (including monitor)
  echo "   🔌 Sending SIGTERM to services..."
  kill -TERM "$MONITOR_PID" 2>/dev/null || true
  kill -TERM "$NEXTJS_PID" 2>/dev/null || true
  [ -n "$current_convex_pid" ] && kill -TERM "$current_convex_pid" 2>/dev/null || true
  kill -TERM "$DASHBOARD_PID" 2>/dev/null || true

  # Step 5: Wait for processes to exit gracefully
  local shutdown_timeout="${SHUTDOWN_TIMEOUT_SECONDS:-30}"
  echo "   ⏳ Waiting up to ${shutdown_timeout}s for services to stop..."

  # Wait with timeout
  local waited=0
  while [ "$waited" -lt "$shutdown_timeout" ]; do
    # Check if all processes have exited
    local still_running=0
    kill -0 "$MONITOR_PID" 2>/dev/null && still_running=1
    kill -0 "$NEXTJS_PID" 2>/dev/null && still_running=1
    [ -n "$current_convex_pid" ] && kill -0 "$current_convex_pid" 2>/dev/null && still_running=1
    kill -0 "$DASHBOARD_PID" 2>/dev/null && still_running=1

    if [ $still_running -eq 0 ]; then
      break
    fi

    sleep 1
    waited=$((waited + 1))
  done

  # Force kill if still running
  if [ "$waited" -ge "$shutdown_timeout" ]; then
    echo "   ⚠️  Timeout reached, force killing remaining processes..."
    kill -KILL "$MONITOR_PID" "$NEXTJS_PID" "$current_convex_pid" "$DASHBOARD_PID" 2>/dev/null || true
  fi

  # Cleanup
  rm -f "$SHUTDOWN_MARKER"
  rm -f "$CONVEX_PID_FILE"
  # Only remove lock if we own it (allow other instance to take over)
  lock_holder=$(cat "$CONVEX_LOCK_FILE" 2>/dev/null || echo "")
  if [ "$lock_holder" = "$CONTAINER_NAME" ]; then
    rm -f "$CONVEX_LOCK_FILE"
  fi

  echo "✅ Services stopped gracefully"
  exit 0
}

trap shutdown SIGTERM SIGINT

# ============================================================================
# Environment Variable Normalization
# ============================================================================

# Centralized environment normalization
source "$(dirname "$0")/env.sh"
env_normalize_common

# ============================================================================
# Trust Caddy's Self-Signed CA Certificate (Development Only)
# ============================================================================
# When using self-signed certificates from Caddy, we need to trust the CA
# so that Convex backend (Rust) can make HTTPS requests to tale.local
#
# This supports both old env vars (CADDY_ROOT_CA, NODE_EXTRA_CA_CERTS) and
# new env var (CADDY_CA_CERT_PATH) for blue-green deployment compatibility.

# Determine CA cert path from available environment variables
CA_CERT_PATH="${CADDY_CA_CERT_PATH:-${CADDY_ROOT_CA:-}}"

if [ -n "${CA_CERT_PATH}" ] && [ -f "${CA_CERT_PATH}" ]; then
  echo "🔐 Setting up Caddy root CA certificate for self-signed HTTPS..."
  # Create a combined CA bundle: system CAs + Caddy's CA
  COMBINED_CA_BUNDLE="/tmp/ca-certificates.crt"
  SYSTEM_CA_BUNDLE="/etc/ssl/certs/ca-certificates.crt"

  if [ -f "${SYSTEM_CA_BUNDLE}" ]; then
    # Start with system CA bundle
    cp "${SYSTEM_CA_BUNDLE}" "${COMBINED_CA_BUNDLE}" 2>/dev/null || true
    # Append Caddy's root CA
    cat "${CA_CERT_PATH}" >> "${COMBINED_CA_BUNDLE}" 2>/dev/null || true
    chmod 644 "${COMBINED_CA_BUNDLE}"
    # Set SSL_CERT_FILE for Rust/native TLS libraries
    export SSL_CERT_FILE="${COMBINED_CA_BUNDLE}"
    # Also set REQUESTS_CA_BUNDLE for Python requests library
    export REQUESTS_CA_BUNDLE="${COMBINED_CA_BUNDLE}"
    # Set NODE_EXTRA_CA_CERTS for Node.js - only when file exists
    export NODE_EXTRA_CA_CERTS="${CA_CERT_PATH}"
    echo "   ✓ Combined CA bundle created with Caddy root CA"
    echo "   ✓ SSL_CERT_FILE=${COMBINED_CA_BUNDLE}"
    echo "   ✓ NODE_EXTRA_CA_CERTS=${CA_CERT_PATH}"
  else
    echo "   ⚠️  System CA bundle not found at ${SYSTEM_CA_BUNDLE}"
  fi
else
  # CA cert file not found - this is normal for Let's Encrypt mode
  # Unset any pre-existing NODE_EXTRA_CA_CERTS to avoid Node.js errors
  unset NODE_EXTRA_CA_CERTS 2>/dev/null || true
  if [ -n "${CA_CERT_PATH}" ]; then
    echo "ℹ️  Using public CA certificates (Let's Encrypt or similar)"
    echo "   Self-signed CA not found at: ${CA_CERT_PATH}"
  fi
fi

echo "🔍 Environment after normalization:"
echo "   HOST=${HOST}"
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

# RAG database configuration
# RAG uses a dedicated database (tale_rag) isolated from other services
# This allows safe full-database resets without affecting Convex or other data
if [ -z "${RAG_DATABASE_URL:-}" ]; then
  # Extract connection info from POSTGRES_URL and append /tale_rag
  # POSTGRES_URL format: postgresql://user:pass@host:port
  export RAG_DATABASE_URL="${POSTGRES_URL}/tale_rag"
fi

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
# Write initial PID to file for cross-subshell visibility (used by monitor and shutdown)
echo "$CONVEX_PID" > "$CONVEX_PID_FILE"
# Acquire lock for blue-green deployment coordination
echo "$CONTAINER_NAME" > "$CONVEX_LOCK_FILE"

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

  # List of environment variables to sync to Convex
  # These are the variables that Convex functions need access to
  ENV_VARS_TO_SYNC=(
    "SITE_URL"
    "ENCRYPTION_SECRET_HEX"
    "OPENAI_API_KEY"
    "OPENAI_BASE_URL"
    "OPENAI_MODEL"
    "OPENAI_VISION_MODEL"
    "OPENAI_CODING_MODEL"
    "OPENAI_EMBEDDING_MODEL"
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
    # Debug flag (enables all debug loggers when set to "true")
    "DEBUG_MODE"
  )

  # Incremental sync: only update env vars that have changed
  # This significantly speeds up deployment by avoiding redundant API calls
  ENV_CACHE_DIR="/app/convex-data/.env_cache"
  mkdir -p "$ENV_CACHE_DIR"

  sync_count=0
  skip_count=0
  unchanged_count=0

  for var_name in "${ENV_VARS_TO_SYNC[@]}"; do
    var_value="${!var_name}"
    cache_file="$ENV_CACHE_DIR/$var_name"

    if [ -z "$var_value" ]; then
      skip_count=$((skip_count + 1))
      continue
    fi

    # Calculate hash of current value
    current_hash=$(echo -n "$var_value" | sha256sum | cut -d' ' -f1)
    cached_hash=$(cat "$cache_file" 2>/dev/null || echo "")

    if [ "$current_hash" = "$cached_hash" ]; then
      unchanged_count=$((unchanged_count + 1))
      continue
    fi

    # Value changed or new, sync it
    local change_type="updated"
    [ -z "$cached_hash" ] && change_type="new"

    if npx convex env set "$var_name" "$var_value" \
      --url "http://localhost:${CONVEX_BACKEND_PORT}" \
      --admin-key "$ADMIN_KEY" >/dev/null 2>&1; then
      echo "$current_hash" > "$cache_file"
      sync_count=$((sync_count + 1))
      echo "   ✓ $var_name ($change_type)"
    else
      echo "   ⚠️  Failed to set $var_name"
    fi
  done

  if [ $sync_count -eq 0 ] && [ $unchanged_count -gt 0 ]; then
    echo "   ⏭️  All $unchanged_count env vars unchanged"
  else
    echo "   ✅ Synced $sync_count (new/updated), unchanged $unchanged_count, skipped $skip_count"
  fi

  # Deploy functions
  # Note: --typecheck disable is used because TypeScript is removed from the Docker image to reduce size
  echo "   Deploying functions..."
  if npx convex deploy --url "http://localhost:${CONVEX_BACKEND_PORT}" --admin-key "$ADMIN_KEY" --typecheck disable --yes 2>&1; then
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
# Note: We use SITE_URL without /ws_api suffix because the dashboard's API paths
# are rewritten to /convex-dashboard-api/ and handled by Next.js rewrites.
NEXT_PUBLIC_DEPLOYMENT_URL="${SITE_URL}" \
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

# ============================================================================
# Process Supervisor - Monitor and restart Convex if it crashes
# ============================================================================

CRASH_LOG="/app/convex-data/crash.log"

monitor_convex() {
  local max_restarts=10
  local restart_count=0
  local restart_window=3600  # Reset counter after 1 hour of stability
  local last_restart_time=0

  while true; do
    sleep 10

    # Check if Convex backend is responding
    if ! curl -sf "http://localhost:${CONVEX_BACKEND_PORT}/version" > /dev/null 2>&1; then
      current_time=$(date +%s)

      # Reset counter if stable for restart_window
      if [ $((current_time - last_restart_time)) -gt $restart_window ]; then
        restart_count=0
      fi

      restart_count=$((restart_count + 1))
      last_restart_time=$current_time

      # Log crash event
      echo "[$(date -Iseconds)] Convex backend crash detected (restart #$restart_count)" | tee -a "$CRASH_LOG"

      if [ $restart_count -gt $max_restarts ]; then
        echo "[$(date -Iseconds)] Max restarts ($max_restarts) exceeded, exiting container" | tee -a "$CRASH_LOG"
        exit 1
      fi

      # Check if another instance holds the lock (blue-green deployment in progress)
      lock_holder=$(cat "$CONVEX_LOCK_FILE" 2>/dev/null || echo "")
      if [ -n "$lock_holder" ] && [ "$lock_holder" != "$CONTAINER_NAME" ]; then
        echo "[$(date -Iseconds)] Another instance ($lock_holder) holds the lock, skipping restart" | tee -a "$CRASH_LOG"
        # Don't count this as a restart attempt since it's expected during deployment
        restart_count=$((restart_count - 1))
        continue
      fi

      # Kill stale process if exists (read PID from file for cross-subshell visibility)
      local current_pid
      current_pid=$(cat "$CONVEX_PID_FILE" 2>/dev/null || echo "")
      if [ -n "$current_pid" ] && kill -0 "$current_pid" 2>/dev/null; then
        kill "$current_pid" 2>/dev/null || true
        wait "$current_pid" 2>/dev/null || true
      fi

      # Restart Convex backend
      echo "[$(date -Iseconds)] Restarting Convex backend..." | tee -a "$CRASH_LOG"
      convex-local-backend ${DB_ARGS} --local-storage /app/convex-data ${SITE_ARGS} &
      echo $! > "$CONVEX_PID_FILE"
      # Update lock after restart
      echo "$CONTAINER_NAME" > "$CONVEX_LOCK_FILE"

      # Wait for recovery
      sleep 5

      if curl -sf "http://localhost:${CONVEX_BACKEND_PORT}/version" > /dev/null 2>&1; then
        echo "[$(date -Iseconds)] Convex backend recovered successfully" | tee -a "$CRASH_LOG"
      else
        echo "[$(date -Iseconds)] Convex backend recovery pending..." | tee -a "$CRASH_LOG"
      fi
    fi
  done
}

# Start process supervisor in background
monitor_convex &
MONITOR_PID=$!

# Wait for all background processes
wait "$CONVEX_PID" "$NEXTJS_PID" "$DASHBOARD_PID"
