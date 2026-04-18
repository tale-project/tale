#!/bin/bash
# pipefail so silent pipe failures (e.g. `bunx convex env list | sed ...`)
# surface instead of producing empty downstream values. -u is intentionally
# omitted to avoid breaking the many `${VAR:-default}` patterns.
set -eo pipefail

# ============================================================================
# Tale Platform Docker Entrypoint (Phase 2: split architecture)
# ----------------------------------------------------------------------------
# Platform is a Vite/TanStack Start frontend + HTTP server. It acts as a
# Convex client: on startup it pushes env vars and function code to the
# sibling `convex` service (see services/convex/).
#
# Responsibilities:
#   1. Privilege drop (root → uid 1001 app)
#   2. Env normalization (incl. ensure_instance_secret)
#   3. Wait for the convex service to be reachable (http://convex:3210/version)
#   4. Deploy Convex functions + sync env vars (push model; three-stage error
#      classification on failure)
#   5. Start Vite server (`bun server.ts`)
#   6. Touch /tmp/platform-ready (compose healthcheck gate)
#   7. Graceful shutdown on SIGTERM
#
# NOT done here any more (owned by convex service):
#   - convex-local-backend daemon
#   - Convex Dashboard
#   - Builtin JSON seed
#   - CA certificate trust for the Rust backend
#   - monitor_convex crash loop
# ============================================================================

# ----------------------------------------------------------------------------
# Logging helpers
# ----------------------------------------------------------------------------
log_info()    { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ℹ️  $*"; }
log_ok()      { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ $*"; }
log_warn()    { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️  $*" >&2; }
log_error()   { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ $*" >&2; }
log_section() { echo; echo "════════════════════════════════════"; echo "  $*"; echo "════════════════════════════════════"; }

# ----------------------------------------------------------------------------
# Privilege handling: platform no longer owns /app/data. The only thing the
# re-exec dance still does is make sure we run as the app user so that Bun
# picks up the right HOME etc. Volume ownership is now the convex container's
# problem.
# ----------------------------------------------------------------------------
if [ "$(id -u)" = '0' ]; then
  exec gosu app "$0" "$@"
fi

log_section "Tale Platform starting (version ${TALE_VERSION:-unknown})"

# ============================================================================
# Shutdown handling
# ============================================================================
SHUTDOWN_MARKER="/tmp/platform-shutting-down"
READY_MARKER="/tmp/platform-ready"
rm -f "$SHUTDOWN_MARKER" "$READY_MARKER"

VITE_PID=""

shutdown() {
  log_section "Platform graceful shutdown"
  touch "$SHUTDOWN_MARKER"

  local drain_wait="${SHUTDOWN_DRAIN_SECONDS:-6}"
  log_info "Draining ${drain_wait}s for load balancer to stop routing..."
  sleep "$drain_wait"

  local grace_period="${SHUTDOWN_GRACE_SECONDS:-5}"
  log_info "Waiting ${grace_period}s for in-flight requests..."
  sleep "$grace_period"

  log_info "Sending SIGTERM to Vite server..."
  kill -TERM "$VITE_PID" 2>/dev/null || true

  local shutdown_timeout="${SHUTDOWN_TIMEOUT_SECONDS:-30}"
  local waited=0
  while [ "$waited" -lt "$shutdown_timeout" ]; do
    if ! kill -0 "$VITE_PID" 2>/dev/null; then
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done

  if [ "$waited" -ge "$shutdown_timeout" ]; then
    log_warn "Timeout reached; force killing Vite"
    kill -KILL "$VITE_PID" 2>/dev/null || true
  fi

  rm -f "$SHUTDOWN_MARKER" "$READY_MARKER"
  log_ok "Platform stopped gracefully"
  exit 0
}
trap shutdown SIGTERM SIGINT

# ============================================================================
# Environment normalization
# ============================================================================
source "$(dirname "$0")/env.sh"
env_normalize_common
ensure_instance_secret

echo "🔍 Environment after normalization:"
echo "   HOST=${HOST}"
echo "   SITE_URL=${SITE_URL}"
echo "   PORT=${PORT}"
echo "   CONVEX_URL=${CONVEX_URL:-http://convex:3210}"

# Export auth / encryption / rag env vars that platform itself uses
# (the rest get pushed to Convex via `convex env set` below).
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL}"
export ENCRYPTION_SECRET_HEX="${ENCRYPTION_SECRET_HEX}"

# Default RAG DB URL constructed by env_normalize_common.
if [ -z "${RAG_DATABASE_URL:-}" ] && [ -n "${POSTGRES_URL:-}" ]; then
  export RAG_DATABASE_URL="${POSTGRES_URL}/tale_knowledge"
fi

# ============================================================================
# Helpers
# ============================================================================
wait_for_http() {
  local url="$1" timeout="${2:-60}" name="${3:-Service}" allow_timeout="${4:-false}"
  log_info "Waiting for ${name} at ${url}..."
  local counter=0
  until curl -sf "$url" > /dev/null 2>&1; do
    counter=$((counter + 1))
    if [ $counter -gt $timeout ]; then
      if [ "$allow_timeout" = "true" ]; then
        log_warn "${name} health-check timeout (continuing)"
        return 0
      fi
      log_error "${name} failed to respond within ${timeout}s"
      return 1
    fi
    sleep 1
  done
  log_ok "${name} is reachable"
}

dump_diagnostics() {
  local ctx="$1"
  echo
  echo "──────── 🔍 Diagnostics: $ctx ────────"
  echo "  Timestamp:   $(date -Iseconds)"
  echo "  Hostname:    $(hostname)"
  echo "  CONVEX_URL:  ${CONVEX_URL}"
  echo "  Memory:      $(free -h 2>/dev/null | awk '/^Mem:/ {print $3" / "$2}')"
  echo "──────────────────────────────────────"
  echo
}

# ============================================================================
# Deploy Convex functions (remote push to convex:3210)
# ----------------------------------------------------------------------------
# This is the core Phase 2 change: we run `bunx convex deploy` against the
# sibling convex service, not a local backend. Env vars are synced first so
# functions can read them at runtime (Convex persists them in its own DB).
# ============================================================================
CONVEX_URL="${CONVEX_URL:-http://convex:3210}"
CONVEX_DEPLOY_TIMEOUT="${CONVEX_DEPLOY_TIMEOUT:-300}"

# ENV vars to sync to the convex service so Convex actions/mutations can read
# them at runtime. See services/platform/convex/ code for consumers.
ENV_VARS_TO_SYNC=(
  "SITE_URL"
  "BASE_PATH"
  "ENCRYPTION_SECRET_HEX"
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
  "TRUSTED_HEADERS_ENABLED"
  "TRUSTED_HEADERS_INTERNAL_SECRET"
  "TRUSTED_EMAIL_HEADER"
  "TRUSTED_NAME_HEADER"
  "TRUSTED_ROLE_HEADER"
  "TRUSTED_TEAMS_HEADER"
  # TALE_CONFIG_DIR only — convex `file_utils.ts` derives the 4 sub-dirs
  # (agents/workflows/integrations/providers) from it.
  "TALE_CONFIG_DIR"
  "DEBUG_MODE"
  "SOPS_AGE_KEY"
)

deploy_convex_functions() {
  log_section "Deploying Convex functions (remote push to ${CONVEX_URL})"

  if [ ! -d "/app/convex" ]; then
    log_warn "No /app/convex directory found, skipping function deployment"
    return 0
  fi

  # Force TALE_CONFIG_DIR to the convex container's internal mount point.
  # The `.env` file may contain a host-side value (e.g.
  # `/home/you/tale/examples`) left over from running `bun scripts/dev.ts`
  # on the host — that path is unreachable inside the convex container.
  #
  # Only TALE_CONFIG_DIR is pushed; AGENTS_DIR/WORKFLOWS_DIR/INTEGRATIONS_DIR/
  # PROVIDERS_DIR are derived inside Convex (`convex/*/file_utils.ts` falls
  # back to `${TALE_CONFIG_DIR}/<subdir>` when the specific var is absent).
  #
  # For local dev against real `examples/` edits, bind-mount the host
  # examples dir into the convex container via compose.dev.yml:
  #   convex:
  #     volumes:
  #       - ./examples:/app/data
  export TALE_CONFIG_DIR=/app/data

  # 1. Wait for the convex service to accept HTTP.
  if ! wait_for_http "${CONVEX_URL}/version" 120 "Convex service /version" false; then
    log_error "Convex service is not reachable. Is the \`convex\` container running?"
    dump_diagnostics "Convex unreachable"
    exit 1
  fi

  # 2. Give search-index bootstrap a moment to settle before push.
  log_info "Waiting 10s for search-index workers to initialize..."
  sleep 10

  # 3. Compute admin key locally (generate_key binary is installed in this image).
  local ADMIN_KEY
  ADMIN_KEY=$(generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")

  # 4. Fetch current Convex env vars to compute a diff.
  export HOME=/home/app
  log_info "Fetching current Convex env vars..."
  local CONVEX_ENV_OUTPUT
  CONVEX_ENV_OUTPUT=$(bunx convex env list --url "$CONVEX_URL" --admin-key "$ADMIN_KEY" 2>/dev/null || echo "")

  declare -A CONVEX_ENV_MAP
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local key="${line%%=*}"
    [ "$key" = "$line" ] && continue
    CONVEX_ENV_MAP["$key"]="${line#*=}"
  done <<< "$CONVEX_ENV_OUTPUT"

  # One-shot cleanup: remove env vars that earlier Tale versions auto-pushed
  # but the current architecture derives from TALE_CONFIG_DIR.
  #
  # Safety: only remove the var if its current value matches the auto-derived
  # path (i.e. it's a stale auto-push, not an operator's custom override).
  # An override like AGENTS_DIR=/data/custom-agents is preserved untouched.
  local config_dir="${TALE_CONFIG_DIR:-/app/data}"
  local -A ORPHAN_DERIVED=(
    [AGENTS_DIR]="${config_dir}/agents"
    [WORKFLOWS_DIR]="${config_dir}/workflows"
    [INTEGRATIONS_DIR]="${config_dir}/integrations"
    [PROVIDERS_DIR]="${config_dir}/providers"
  )
  for orphan in "${!ORPHAN_DERIVED[@]}"; do
    if [ "${CONVEX_ENV_MAP[$orphan]+_}" ]; then
      local current="${CONVEX_ENV_MAP[$orphan]}"
      local derived="${ORPHAN_DERIVED[$orphan]}"
      if [ "$current" = "$derived" ]; then
        if bunx convex env remove "$orphan" --url "$CONVEX_URL" --admin-key "$ADMIN_KEY" >/dev/null 2>&1; then
          echo "   ✓ $orphan (orphan removed — derived from TALE_CONFIG_DIR)"
          unset 'CONVEX_ENV_MAP[$orphan]'
        fi
      else
        log_info "$orphan=$current preserved (custom override; not the derived $derived)"
      fi
    fi
  done

  # 5. Sync each var in ENV_VARS_TO_SYNC.
  local sync_count=0 skip_count=0 unchanged_count=0 remove_count=0
  local failed_vars=()

  for var_name in "${ENV_VARS_TO_SYNC[@]}"; do
    local var_value="${!var_name}"

    if [ -z "$var_value" ]; then
      # Unset: remove from Convex if previously present.
      if [ "${CONVEX_ENV_MAP[$var_name]+_}" ]; then
        if bunx convex env remove "$var_name" --url "$CONVEX_URL" --admin-key "$ADMIN_KEY" >/dev/null 2>&1; then
          remove_count=$((remove_count + 1))
          echo "   ✓ $var_name (removed)"
        else
          failed_vars+=("$var_name")
          log_warn "Failed to remove $var_name"
        fi
      else
        skip_count=$((skip_count + 1))
      fi
      continue
    fi

    # Unchanged?
    if [ "${CONVEX_ENV_MAP[$var_name]+_}" ] && [ "${CONVEX_ENV_MAP[$var_name]}" = "$var_value" ]; then
      unchanged_count=$((unchanged_count + 1))
      continue
    fi

    local change_type="updated"
    [ -z "${CONVEX_ENV_MAP[$var_name]+_}" ] && change_type="new"

    if bunx convex env set "$var_name" "$var_value" --url "$CONVEX_URL" --admin-key "$ADMIN_KEY" >/dev/null 2>&1; then
      sync_count=$((sync_count + 1))
      echo "   ✓ $var_name ($change_type)"
    else
      failed_vars+=("$var_name")
      log_warn "Failed to set $var_name (value length: ${#var_value})"
    fi
  done

  if [ ${#failed_vars[@]} -gt 0 ]; then
    log_warn "Failed env vars:"
    for v in "${failed_vars[@]}"; do
      echo "    - $v (value length: ${#v} / ${#!v})"
    done
    echo "  Possible causes: name > 40 chars / value > 8 KB / invalid characters"
  fi

  if [ $sync_count -eq 0 ] && [ $remove_count -eq 0 ] && [ $unchanged_count -gt 0 ]; then
    echo "   ⏭️  All $unchanged_count env vars unchanged"
  else
    echo "   ✅ Synced $sync_count, removed $remove_count, unchanged $unchanged_count, skipped $skip_count"
  fi

  # 6. Deploy functions (three-stage error classification below).
  log_info "Running convex deploy (timeout ${CONVEX_DEPLOY_TIMEOUT}s)..."
  sleep 2  # Avoid RaceDetected (env sync race)

  local deploy_log
  deploy_log=$(mktemp)
  local deploy_exit=0

  timeout "$CONVEX_DEPLOY_TIMEOUT" bunx convex deploy \
    --url "$CONVEX_URL" \
    --admin-key "$ADMIN_KEY" \
    --typecheck disable --yes 2>&1 | tee "$deploy_log" || deploy_exit=$?

  if [ $deploy_exit -eq 0 ]; then
    log_ok "Convex functions deployed successfully"
    rm -f "$deploy_log"

    # Run Convex data migrations. Non-fatal: each migration is idempotent,
    # so a transient failure here is retried on the next platform boot and
    # must not prevent the platform from serving.
    log_info "Running Convex data migrations..."
    local migrations_exit=0
    timeout 600 bunx convex run migrations:runAll \
      --url "$CONVEX_URL" \
      --admin-key "$ADMIN_KEY" 2>&1 || migrations_exit=$?
    if [ $migrations_exit -eq 0 ]; then
      log_ok "Convex data migrations complete"
    else
      log_error "Convex data migrations failed (exit code: $migrations_exit) — platform will continue; legacy data may need manual backfill."
    fi

    return 0
  fi

  # --- Failure classification (three-stage) ---
  log_error "Convex deploy failed (exit code: $deploy_exit)"
  echo
  echo "━━━ Error diagnosis ━━━"

  local retry=false

  if [ $deploy_exit -eq 124 ]; then
    # wait_for_schema stage
    log_error "Reason: timeout (${CONVEX_DEPLOY_TIMEOUT}s)"
    echo "  → Most likely stuck in wait_for_schema (search-index backfill)."
    if grep -q "Backfilling indexes" "$deploy_log"; then
      echo "  ✔ Confirmed: deploy blocked on index backfill."
      grep "Backfilling indexes" "$deploy_log" | tail -1 | sed 's/^/  last progress: /'
    fi
    if grep -q "TextLiveFlusher died" "$deploy_log"; then
      echo "  ⚠️  TextLiveFlusher errors detected in convex logs."
      echo "     docker compose logs convex | grep TextLiveFlusher"
    fi
    echo "  fix: inspect convex-data /app/data/convex/search; see plan section."

  elif grep -q "RaceDetected" "$deploy_log"; then
    log_error "Reason: RaceDetected (env vars modified mid-push)"
    echo "  fix: check for parallel deploys; retry will happen automatically."
    retry=true

  elif grep -q "ConcurrentPush" "$deploy_log"; then
    log_error "Reason: ConcurrentPush (another deploy in progress)"
    echo "  fix: ps -ef | grep convex; ensure only one platform color is pushing."

  elif grep -q "ModulesTooLarge" "$deploy_log"; then
    log_error "Reason: compiled modules exceed the 45 MB gzip limit"
    echo "  fix: du -sh /app/convex; prune unused deps; move big libs behind \"use node\""

  elif grep -q "InvalidSchema" "$deploy_log"; then
    log_error "Reason: schema conflicts with existing data"
    echo "  fix: migrate data first, or make the new field optional."

  elif grep -q "TextIndexTooLarge\|VectorIndexTooLarge" "$deploy_log"; then
    log_error "Reason: search or vector index exceeds memory limit (default 100 MiB)"
    echo "  fix: raise SEARCH_INDEX_SIZE_HARD_LIMIT or reduce index scope."

  elif grep -q "SearchIndexesUnavailable\|VectorIndexesUnavailable" "$deploy_log"; then
    log_error "Reason: search indexes not yet bootstrapped on convex side"
    echo "  → Cold boot: index workers take 30–90s to come up; will back off and retry."
    retry=true
    # Use a bigger backoff specifically for index bootstrap; the standard 10s
    # is rarely enough on first boot.
    SEARCH_INDEX_RETRY_BACKOFF=45

  elif grep -q "AuthConfigMissingEnvironmentVariable" "$deploy_log"; then
    local missing_var
    missing_var=$(grep -oP 'Environment variable \K\w+' "$deploy_log" | head -1)
    log_error "Reason: auth.config.ts references unset env var"
    [ -n "$missing_var" ] && echo "  missing: $missing_var"
    echo "  fix: add it to ENV_VARS_TO_SYNC in this entrypoint + ensure it is exported."

  elif grep -qi "fetch failed\|ECONNREFUSED\|ETIMEDOUT" "$deploy_log"; then
    log_error "Reason: network/connection issue to ${CONVEX_URL}"
    echo "  fix: check convex container health; check docker network."
    retry=true

  elif grep -qi "invalid admin key\|unauthorized" "$deploy_log"; then
    log_error "Reason: admin key invalid"
    echo "  fix: check INSTANCE_NAME and INSTANCE_SECRET match on both services."

  else
    log_error "Reason: unclassified. See full deploy log above."
    echo "  fix: try RUST_LOG=debug on the convex service and re-run deploy."
  fi

  echo
  dump_diagnostics "Convex deploy failure"

  if [ "$retry" = "true" ]; then
    # Up to 3 attempts with exponential backoff (capped); the first sleep is
    # the classification-specific backoff if set (search-index bootstrap),
    # otherwise the default 10s.
    local backoff="${SEARCH_INDEX_RETRY_BACKOFF:-10}"
    local attempt
    for attempt in 1 2 3; do
      log_warn "Retryable error detected; sleeping ${backoff}s before attempt ${attempt}/3..."
      sleep "$backoff"
      if timeout "$CONVEX_DEPLOY_TIMEOUT" bunx convex deploy \
          --url "$CONVEX_URL" \
          --admin-key "$ADMIN_KEY" \
          --typecheck disable --yes 2>&1 | tee -a "$deploy_log"; then
        log_ok "Convex functions deployed on retry attempt ${attempt}"
        rm -f "$deploy_log"
        return 0
      fi
      # Cap at ~90s to avoid runaway waits but still cover the longest
      # observed search-index bootstrap.
      backoff=$(( backoff * 2 ))
      [ $backoff -gt 90 ] && backoff=90
    done
    log_error "All retries failed"
  fi

  rm -f "$deploy_log"
  exit 1
}

deploy_convex_functions

# ============================================================================
# Vite application
# ============================================================================
log_section "Starting Vite server on port ${PORT}"

export SENTRY_RELEASE="${TALE_VERSION:-unknown}"

bun server.ts &
VITE_PID=$!

wait_for_http "http://localhost:${PORT}/api/health" 30 "Vite server" true

# ============================================================================
# Readiness marker (compose healthcheck gate)
# ============================================================================
touch "$READY_MARKER"
log_ok "Platform ready (marker: $READY_MARKER)"

# ============================================================================
# Derived display URLs
# ============================================================================
DISPLAY_BASE_URL="${SITE_URL:-http://localhost:${PORT}}${BASE_PATH:-}"

echo
echo "🎉 Tale Platform is running!"
echo
echo "   📱 Application:       ${DISPLAY_BASE_URL}"
echo "   🔌 Convex API (WS):   ${DISPLAY_BASE_URL}/ws_api"
echo "   ⚡ Convex Actions:     ${DISPLAY_BASE_URL}/http_api"
echo "   📊 Convex Dashboard:  ${DISPLAY_BASE_URL}/convex-dashboard"
echo

wait "$VITE_PID"
