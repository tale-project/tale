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
# Severity is a plain text word (no emoji — they render inconsistently across
# terminals and the CLI/dev classifier keys on these words to colour the line).
log_info()    { echo "[$(date '+%Y-%m-%d %H:%M:%S')] INFO  $*"; }
log_ok()      { echo "[$(date '+%Y-%m-%d %H:%M:%S')] OK    $*"; }
log_warn()    { echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN  $*" >&2; }
log_error()   { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR $*" >&2; }
log_section() { echo; echo "════════════════════════════════════"; echo "  $*"; echo "════════════════════════════════════"; }

# ----------------------------------------------------------------------------
# Privilege handling: platform no longer owns /app/data. The only thing the
# re-exec dance still does is make sure we run as the app user so that Bun
# picks up the right HOME etc. Volume ownership is now the convex container's
# problem.
# ----------------------------------------------------------------------------
if [ "$(id -u)" = '0' ]; then
  # Dev image opt-out: the hot-reload watchers (`vite build --watch`) must write
  # to dist/ and read the host-owned bind-mounted source, and running as root
  # sidesteps uid-mismatch permission errors. vite only writes container-local
  # paths (dist/, node_modules cache), never the bind-mounts, so the host tree
  # is not polluted. Set only in compose.dev.yml; prod always drops to `app`.
  if [ "${TALE_DEV_NO_PRIVDROP:-0}" = '1' ]; then
    log_warn "TALE_DEV_NO_PRIVDROP=1 — running as root (dev hot-reload mode)"
  else
    exec gosu app "$0" "$@"
  fi
fi

log_section "Tale Platform starting (version ${TALE_VERSION:-unknown})"

# ============================================================================
# Shutdown handling
# ============================================================================
SHUTDOWN_MARKER="/tmp/platform-shutting-down"
READY_MARKER="/tmp/platform-ready"
rm -f "$SHUTDOWN_MARKER" "$READY_MARKER"

VITE_PID=""
# Set by the dev hot-reload watchers (empty in prod).
CONVEX_DEV_PID=""
FRONTEND_WATCH_PID=""
# Outcome of the dev-login seed step (seeded/skipped/failed, empty when the
# gate is off) — the final banner only prints credentials for "seeded".
DEV_SEED_STATUS=""

shutdown() {
  log_section "Platform graceful shutdown"
  touch "$SHUTDOWN_MARKER"

  # Stop the dev-only watchers first — they are non-critical and must not
  # outlive the entrypoint (an orphaned `convex dev` keeps re-pushing; an
  # orphaned `vite build --watch` keeps rebuilding dist).
  if [ -n "$CONVEX_DEV_PID" ]; then
    log_info "Stopping Convex function watcher..."
    kill -TERM "$CONVEX_DEV_PID" 2>/dev/null || true
  fi
  if [ -n "$FRONTEND_WATCH_PID" ]; then
    log_info "Stopping frontend build watcher..."
    kill -TERM "$FRONTEND_WATCH_PID" 2>/dev/null || true
  fi

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

# ----------------------------------------------------------------------------
# Layout detection (prod runner vs dev image)
# ----------------------------------------------------------------------------
# The production runner flattens the platform into /app: server.ts at
# /app/server.ts, functions at /app/convex, cwd /app. The dev image (Dockerfile
# `dev` stage) is the unpruned `builder` and keeps the monorepo layout:
# server.ts + vite config + functions live under /app/services/platform. One
# entrypoint serves both, so resolve the two roots from a marker that ONLY the
# flat layout has (/app/server.ts) and cd into the platform dir. Bind-mounting
# the convex tree over /app/services/platform/convex (compose.dev.yml) does NOT
# create /app/server.ts, so the detection stays correct under that mount.
if [ -f /app/server.ts ]; then
  PLATFORM_DIR=/app
else
  PLATFORM_DIR=/app/services/platform
fi
CONVEX_DIR="${PLATFORM_DIR}/convex"
cd "$PLATFORM_DIR" || { log_error "Platform dir ${PLATFORM_DIR} missing"; exit 1; }
log_info "Platform dir: ${PLATFORM_DIR} (convex: ${CONVEX_DIR})"

echo "Environment after normalization:"
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

# Admin key + WebDAV HMAC key. Both must be readable from `bun server.ts`'s
# process.env, not just the deploy_convex_functions function. `ADMIN_KEY`
# was previously a `local` and silently went out of scope before the
# platform Hono server started — every `/dav/*` request then 500'd. Both
# are deterministic from $INSTANCE_SECRET so they survive restarts and
# operators don't need to set them by hand.
#
# `WEBDAV_APP_PASSWORD_HMAC_KEY` accepts an explicit override (.env) for
# operators who want a key rotation independent of INSTANCE_SECRET. When
# unset, we derive a 64-char hex via sha256(secret || ':webdav-hmac:v1').
export ADMIN_KEY="$(generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")"
if [ -z "${WEBDAV_APP_PASSWORD_HMAC_KEY:-}" ]; then
  WEBDAV_APP_PASSWORD_HMAC_KEY="$(printf '%s' "${INSTANCE_SECRET}:webdav-hmac:v1" | sha256sum | awk '{print $1}')"
fi
export WEBDAV_APP_PASSWORD_HMAC_KEY

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
  echo "──────── Diagnostics: $ctx ────────"
  echo "  Timestamp:   $(date -Iseconds)"
  echo "  Hostname:    $(hostname)"
  echo "  CONVEX_URL:  ${CONVEX_URL}"
  echo "  Memory:      $(free -h 2>/dev/null | awk '/^Mem:/ {print $3" / "$2}')"
  echo "──────────────────────────────────────"
  echo
}

# Dev-login seeding (docker:dev convenience): coarse gate deciding whether to
# invoke the seed action and print the credentials banner. Dev image only +
# the TALE_DEV_SEED_USER flag (default on in compose.dev.yml, opt out with
# 0/false/no/off). The action itself (convex/provisioning/seed_dev_user.ts)
# owns the real gating, including refusing non-loopback SITE_URLs.
dev_seed_enabled() {
  [ "${NODE_ENV:-}" = "development" ] || return 1
  case "$(printf '%s' "${TALE_DEV_SEED_USER:-}" | tr '[:upper:]' '[:lower:]')" in
    '' | 0 | false | no | off) return 1 ;;
    *) return 0 ;;
  esac
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

# Denylist of env vars that should NOT be synced to Convex. Initially
# empty — we wire the mechanism but ship no entries. Add a name here
# only when a specific var is shown to actively break Convex (e.g.
# conflicts with a same-named convex-side var that needs a different
# value, or causes a deploy failure). Most additions to this list
# should NOT be needed.
#
# Mirrors `bun dev`'s sync-convex-env-from-dotenv.ts behavior: push
# everything we see, exclude only what's known-incompatible.
ENV_SYNC_DENYLIST=()

deploy_convex_functions() {
  log_section "Deploying Convex functions (remote push to ${CONVEX_URL})"

  if [ ! -d "$CONVEX_DIR" ]; then
    log_warn "No ${CONVEX_DIR} directory found, skipping function deployment"
    return 0
  fi

  # Force TALE_CONFIG_DIR to the convex container's internal mount point.
  # The `.env` file may contain a host-side value (e.g.
  # `/home/you/tale/.tale/config`) left over from running `bun scripts/dev.ts`
  # on the host — that path is unreachable inside the convex container.
  #
  # Only TALE_CONFIG_DIR is pushed. The per-domain overrides (AGENTS_DIR/
  # WORKFLOWS_DIR/CONNECTORS_DIR/PROVIDERS_DIR/SKILLS_DIR) are no longer
  # honored anywhere under the uniform org-first layout — resolvers read
  # exclusively from `${TALE_CONFIG_DIR}/<orgSlug>/<domain>/` — which is
  # also why the sync loop below actively purges any of those names it
  # finds still set in the Convex deployment.
  #
  # For local dev against a real writable config dir, bind-mount the host
  # config root into the convex container via compose.dev.yml:
  #   convex:
  #     volumes:
  #       - ./.tale/config:/app/data
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

  # 3. ADMIN_KEY is already exported at module scope (see env section above)
  # so `bun server.ts` inherits it. Used here for the `bunx convex env set` +
  # `convex deploy` CLI calls below.

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

  # Unconditional purge: the per-domain env overrides (AGENTS_DIR /
  # WORKFLOWS_DIR / CONNECTORS_DIR / PROVIDERS_DIR / SKILLS_DIR) are no
  # longer honored by the resolvers under the uniform org-first layout.
  # Remove them from the Convex deployment env on every boot, regardless
  # of whether they look auto-derived or operator-customized. Operators
  # who previously relied on a custom value must now point TALE_CONFIG_DIR
  # at the root and use the `<orgSlug>/<domain>/` subtree.
  local -a LEGACY_DOMAIN_VARS=(
    AGENTS_DIR
    WORKFLOWS_DIR
    CONNECTORS_DIR
    PROVIDERS_DIR
    SKILLS_DIR
  )
  for legacy in "${LEGACY_DOMAIN_VARS[@]}"; do
    if [ "${CONVEX_ENV_MAP[$legacy]+_}" ]; then
      # Match the surrounding env-sync loop's aggregation pattern: track
      # failures in `failed_vars` later, never swallow with `>/dev/null`
      # so a real CLI error doesn't leave the legacy var lingering in
      # Convex without an operator-visible signal.
      if bunx convex env remove "$legacy" --url "$CONVEX_URL" --admin-key "$ADMIN_KEY" >/dev/null; then
        echo "   -$legacy removed (no longer honored under org-first layout)"
        unset 'CONVEX_ENV_MAP[$legacy]'
      else
        log_warn "Failed to remove legacy env var $legacy from Convex; will retry on next boot"
      fi
    fi
  done

  # 5. Push every env var the platform container sees to Convex (denylist
  # semantics — only skip names listed in ENV_SYNC_DENYLIST or names
  # that exceed the 40-char Convex limit). Matches the local-dev sync
  # script's behavior so prod ↔ dev have the same env-propagation
  # surface, and operators can use any env name they want without
  # negotiating a platform-side allowlist.
  local sync_count=0 skip_count=0 unchanged_count=0 remove_count=0
  local failed_vars=()
  local seen_vars=()

  is_denylisted() {
    local name="$1"
    local entry
    for entry in "${ENV_SYNC_DENYLIST[@]}"; do
      [ "$name" = "$entry" ] && return 0
    done
    return 1
  }

  while IFS='=' read -r var_name var_value; do
    [ -z "$var_name" ] && continue
    [ -z "$var_value" ] && continue
    if is_denylisted "$var_name"; then
      skip_count=$((skip_count + 1))
      continue
    fi
    if [ ${#var_name} -gt 40 ]; then
      log_warn "Skipping $var_name: name exceeds Convex 40-char limit"
      skip_count=$((skip_count + 1))
      continue
    fi
    seen_vars+=("$var_name")
    if [ "${CONVEX_ENV_MAP[$var_name]+_}" ] && [ "${CONVEX_ENV_MAP[$var_name]}" = "$var_value" ]; then
      unchanged_count=$((unchanged_count + 1))
      continue
    fi
    local change_type="updated"
    [ -z "${CONVEX_ENV_MAP[$var_name]+_}" ] && change_type="new"
    if bunx convex env set "$var_name" "$var_value" --url "$CONVEX_URL" --admin-key "$ADMIN_KEY" >/dev/null 2>&1; then
      sync_count=$((sync_count + 1))
      echo "   -$var_name ($change_type)"
    else
      failed_vars+=("$var_name")
      log_warn "Failed to set $var_name (value length: ${#var_value})"
    fi
  done < <(env)

  # 5b. Remove vars from Convex that are no longer set on the platform.
  # Without this, env vars unset on the platform side linger in Convex.
  # Skip orphans we already removed above (in the LEGACY_DOMAIN_VARS block).
  for convex_var in "${!CONVEX_ENV_MAP[@]}"; do
    local found=false
    local sv
    for sv in "${seen_vars[@]}"; do
      if [ "$sv" = "$convex_var" ]; then found=true; break; fi
    done
    if [ "$found" = "false" ]; then
      if is_denylisted "$convex_var"; then continue; fi
      if bunx convex env remove "$convex_var" --url "$CONVEX_URL" --admin-key "$ADMIN_KEY" >/dev/null 2>&1; then
        remove_count=$((remove_count + 1))
        echo "   -$convex_var (removed; unset on platform)"
      else
        failed_vars+=("$convex_var")
        log_warn "Failed to remove $convex_var"
      fi
    fi
  done

  if [ ${#failed_vars[@]} -gt 0 ]; then
    log_warn "Failed env vars:"
    for v in "${failed_vars[@]}"; do
      # `${#v}` is the name length. Indirect value-length lookup
      # (`${#!v}`) is invalid bash and would crash this loop under
      # `set -eo pipefail`, taking the entrypoint with it.
      echo "    - $v (name length: ${#v})"
    done
    echo "  Possible causes: name > 40 chars / value > 8 KB / invalid characters"
  fi

  if [ $sync_count -eq 0 ] && [ $remove_count -eq 0 ] && [ $unchanged_count -gt 0 ]; then
    echo "   All $unchanged_count env vars unchanged"
  else
    echo "   Synced $sync_count, removed $remove_count, unchanged $unchanged_count, skipped $skip_count"
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

    # Breaking-cutover backstop: refuse to boot post-0.4-baseline code against
    # a data volume that lived through pre-0.4 releases. The migration history
    # was reset at the 0.4 baseline — there is NO upgrade path. The CLI deploy
    # guard refuses earlier (before touching anything); this catches non-CLI
    # operators and swapped volumes. FATAL, unlike every step below: serving
    # would silently run new code against unmigrated data. Grep-stable marker:
    # [migrations][breaking-cutover]
    log_info "Checking migration-baseline compatibility..."
    local baseline_output baseline_exit=0
    baseline_output=$(timeout 120 bunx convex run migrations/framework/entrypoints:preBaselineLedger \
      --url "$CONVEX_URL" \
      --admin-key "$ADMIN_KEY" 2>&1) || baseline_exit=$?
    if [ $baseline_exit -ne 0 ]; then
      log_warn "Baseline compatibility check could not run (exit code: $baseline_exit) — continuing; the CLI deploy guard is the primary gate."
    elif printf '%s' "$baseline_output" | grep -q '"count": 0'; then
      log_ok "Migration baseline compatible"
    elif [ "${TALE_ACCEPT_DATA_LOSS:-0}" = "1" ]; then
      log_warn "[migrations][breaking-cutover] Pre-baseline migration ledger detected but TALE_ACCEPT_DATA_LOSS=1 — continuing. Pre-0.4 data will NOT be readable by this release."
    else
      log_error "[migrations][breaking-cutover] This data volume was created by a pre-0.4 release. 0.4 is a breaking cutover with NO upgrade path: deploy 0.4 into a FRESH project (new volumes), or keep this instance on the 0.3.x line (hotfixes ship from release/0.3). Set TALE_ACCEPT_DATA_LOSS=1 only if you accept that pre-0.4 data becomes permanently unreadable."
      printf '%s\n' "$baseline_output"
      exit 1
    fi

    # Provision built-in default content (prompt library, task-ops pack) into
    # every org. SEPARATE from data migrations — this is idempotent re-seeding,
    # not a migration. Non-fatal: a transient failure is retried on next boot
    # and must not prevent the platform from serving.
    log_info "Provisioning built-in defaults..."
    local provision_exit=0
    timeout 600 bunx convex run provisioning:provisionAll \
      --url "$CONVEX_URL" \
      --admin-key "$ADMIN_KEY" 2>&1 || provision_exit=$?
    if [ $provision_exit -eq 0 ]; then
      log_ok "Provisioning complete"
    else
      log_error "Provisioning failed (exit code: $provision_exit) — platform will continue; defaults may need manual re-provisioning via 'tale migrate'."
    fi

    # Run Convex data migrations. Non-fatal: each migration is idempotent,
    # so a transient failure here is retried on the next platform boot and
    # must not prevent the platform from serving. runAll itself never throws
    # on a migration failure — it prints a grep-stable
    # [migrations][deploy-failure] line instead — so key the loud banner on
    # that marker, not the exit code.
    log_info "Running Convex data migrations..."
    local migrations_exit=0
    local migrations_output=""
    migrations_output=$(timeout 600 bunx convex run migrations:runAll \
      --url "$CONVEX_URL" \
      --admin-key "$ADMIN_KEY" 2>&1) || migrations_exit=$?
    [ -n "$migrations_output" ] && printf '%s\n' "$migrations_output"
    if [ $migrations_exit -ne 0 ]; then
      log_error "Convex data migrations failed (exit code: $migrations_exit) — platform will continue; legacy data may need manual backfill."
    elif printf '%s' "$migrations_output" | grep -q '\[migrations\]\[deploy-failure\]'; then
      log_error "A DATA MIGRATION FAILED during this deploy. The platform boots on the current schema, but pending data was NOT migrated. Inspect with 'tale migrate status'; re-run with 'tale migrate up' (idempotent, resumable from the ledger)."
    else
      log_ok "Convex data migrations complete"
    fi

    # Validate the deployed built-in config catalog (the configs/ YAML seed
    # tree) against its Zod schemas. Non-fatal like provisioning/migrations
    # above: a broken catalog is a build-time regression CI should already
    # have caught before this image shipped — this is the last-mile safety
    # net for a mismatched image or a hand-edited builtin catalog volume.
    log_info "Validating builtin config catalog..."
    local validate_catalog_exit=0
    timeout 120 bunx convex run lib/config_store/validate_builtin_catalog:validateBuiltinCatalog \
      --url "$CONVEX_URL" \
      --admin-key "$ADMIN_KEY" 2>&1 || validate_catalog_exit=$?
    if [ $validate_catalog_exit -eq 0 ]; then
      log_ok "Builtin config catalog validation complete"
    else
      log_error "Builtin config catalog validation failed (exit code: $validate_catalog_exit) — platform will continue; see issues logged above."
    fi

    # Dev-only: seed a ready-to-log-in account + organization so a fresh
    # docker:dev stack is testable without a manual /setup pass. Idempotent
    # (re-runs no-op) and non-fatal like provisioning: a failure logs, the
    # next boot retries, and /setup keeps working as the fallback. The action
    # may also refuse to seed (e.g. non-loopback SITE_URL) — track the real
    # outcome so the credentials banner never advertises an account that was
    # not created.
    if dev_seed_enabled; then
      log_info "Seeding dev login account (TALE_DEV_SEED_USER)..."
      local seed_output seed_exit=0
      seed_output=$(timeout 120 bunx convex run provisioning/seed_dev_user:seedDevUser \
        --url "$CONVEX_URL" \
        --admin-key "$ADMIN_KEY" 2>&1) || seed_exit=$?
      printf '%s\n' "$seed_output"
      if [ $seed_exit -eq 0 ] && printf '%s' "$seed_output" | grep -q '"status": "seeded"'; then
        DEV_SEED_STATUS=seeded
        log_ok "Dev login ready"
      elif [ $seed_exit -eq 0 ]; then
        DEV_SEED_STATUS=skipped
        log_info "Dev login seeding skipped (see action output above)"
      else
        DEV_SEED_STATUS=failed
        log_warn "Dev login seed failed (exit code: $seed_exit) — continuing; register via /setup or retry on next boot."
      fi
    fi

    return 0
  fi

  # --- Failure classification (three-stage) ---
  log_error "Convex deploy failed (exit code: $deploy_exit)"
  echo
  echo "━━━ Error diagnosis ━━━"

  local retry=false
  # Classification-specific first-retry backoff; empty means use the default
  # 10s in the retry loop below. Declared here so the default is robust even if
  # this function is ever called more than once per process.
  local SEARCH_INDEX_RETRY_BACKOFF=""

  if [ $deploy_exit -eq 124 ]; then
    # wait_for_schema stage
    log_error "Reason: timeout (${CONVEX_DEPLOY_TIMEOUT}s)"
    echo "  → Most likely stuck in wait_for_schema (search-index backfill)."
    if grep -q "Backfilling indexes" "$deploy_log"; then
      echo "  Confirmed: deploy blocked on index backfill."
      grep "Backfilling indexes" "$deploy_log" | tail -1 | sed 's/^/  last progress: /'
    fi
    if grep -q "TextLiveFlusher died" "$deploy_log"; then
      echo "  WARN TextLiveFlusher errors detected in convex logs."
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

  elif grep -qz "InvalidModules.*Function execution timed out" "$deploy_log"; then
    log_error "Reason: module analyze timed out (2s isolate budget) — usually transient deploy-time CPU contention"
    echo "  → A module's import-time evaluation exceeded the 2s analyze budget,"
    echo "    typically because convex was CPU-starved during image pulls / chat drain."
    echo "  fix: auto-retrying; if persistent, set RUST_LOG=debug to find the slow module and defer its top-level work."
    retry=true

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
# Dev-only: Convex function watcher (hot push)
# ----------------------------------------------------------------------------
# In `docker:dev` the host's services/platform/convex tree is bind-mounted over
# /app/convex (see compose.dev.yml — the same path the boot deploy above reads).
# That deploy is ONE-SHOT, so convex edits made after boot never reach the
# running backend without a container restart. When NODE_ENV=development we
# leave a `convex dev` watcher running: it re-pushes changed modules to the
# sibling convex service on every save — the identical push model as the boot
# deploy, just continuous. Never runs in production (the runner sets
# NODE_ENV=production); opt out in dev with TALE_DEV_HOT_RELOAD=0.
#
# Flag choices mirror the boot deploy and keep host state untouched:
#   --codegen disable   never rewrite the bind-mounted convex/_generated/ tree;
#                       that is owned by the host's own `bun dev`/IDE, and the
#                       container app user writing into it causes host-side
#                       churn and ownership surprises.
#   --typecheck disable same as the boot deploy — tsc is the host's job.
#   --tail-logs disable keep this entrypoint's log readable; function logs live
#                       in the convex container (`docker compose logs convex`).
# ============================================================================
start_convex_dev_watcher() {
  if [ "${NODE_ENV:-}" != "development" ] || [ "${TALE_DEV_HOT_RELOAD:-1}" = "0" ]; then
    return 0
  fi
  if [ ! -d "$CONVEX_DIR" ]; then
    log_warn "Hot reload requested but ${CONVEX_DIR} is missing; skipping Convex watcher"
    return 0
  fi

  log_section "Starting Convex function watcher (dev hot reload)"
  log_info "Watching ${CONVEX_DIR} → re-pushing to ${CONVEX_URL} on every save"

  # HOME is already exported to /home/app by deploy_convex_functions above, so
  # the watcher reuses the same Bun/convex CLI home the boot deploy used.
  bunx convex dev \
    --url "$CONVEX_URL" \
    --admin-key "$ADMIN_KEY" \
    --typecheck disable \
    --codegen disable \
    --tail-logs disable &
  CONVEX_DEV_PID=$!
  log_ok "Convex watcher started (pid ${CONVEX_DEV_PID}); convex edits now hot-push"
}

start_convex_dev_watcher

# ============================================================================
# Dev-only: frontend build watcher (hard-refresh hot reload)
# ----------------------------------------------------------------------------
# `server.ts` serves the SPA from ${PLATFORM_DIR}/dist and (in dev) re-reads
# index.html per request, so a fresh `dist/` shows up on the next browser
# refresh. The boot already ships a prebuilt dist/, so the app serves
# immediately; we only rebuild once the host's bind-mounted app/ + lib/ trees
# (compose.dev.yml) actually change. This is intentionally NOT a Vite dev
# server with HMR: it keeps the production server.ts serving path (API routes,
# WebDAV, canvas-preview, …) untouched and avoids proxying an HMR websocket
# through Caddy's self-signed TLS. Trade-off: a manual refresh, no React Fast
# Refresh / state retention. For full HMR use host `bun dev`.
#
# Why a poll loop + full `vite build` (not `vite build --watch`), and why the
# atomic dir swap:
#   * `vite build --watch` (rolldown) crashes the *incremental* rebuild in the
#     vite:css-post plugin ("Unable to get file name for unknown file …") and
#     leaves dist/ without index.html → the SPA 500s. A fresh one-shot
#     `vite build` does not hit that path and is reliable.
#   * But a plain `vite build` into the live dist/ empties it for the ~7s build
#     (emptyOutDir), so a refresh mid-build hits a missing/half-written dist →
#     500/blank. To avoid that we keep two build slots (dist-a / dist-b) and
#     make `dist` a symlink: build into the *inactive* slot, then swap the
#     symlink with a single `mv -T` (rename(2)). A request therefore always
#     resolves dist/ to a *complete* build — the previous one during the
#     rebuild, the new one after the swap — never a half-written tree. server.ts
#     re-reads index.html per request (and uses a fixed dist path), so it needs
#     no change. A failed build never swaps, so the previous build keeps serving.
#   * Polling (vs inotify): Docker Desktop bind mounts deliver host file events
#     unreliably; a 2s mtime poll is plenty for a manual-refresh workflow.
#
# Only runs in the dev image (vite + the source live there); the pruned prod
# runner has neither, and sets NODE_ENV=production. Opt out with
# TALE_DEV_HOT_RELOAD=0. `--mode development` skips minification for speed.
# ============================================================================
start_frontend_watcher() {
  if [ "${NODE_ENV:-}" != "development" ] || [ "${TALE_DEV_HOT_RELOAD:-1}" = "0" ]; then
    return 0
  fi
  if [ ! -f "${PLATFORM_DIR}/vite.config.ts" ]; then
    log_warn "Hot reload requested but ${PLATFORM_DIR}/vite.config.ts is missing (pruned image?); skipping frontend watcher"
    return 0
  fi

  log_section "Starting frontend build watcher (dev hot reload)"
  log_info "Watching app/ + lib/ → full 'vite build' on change (refresh the browser to see changes)"

  # Convert the baked prebuilt dist/ (a real dir) into the symlink + two-slot
  # layout, synchronously (before server.ts starts) so dist/ is never absent
  # under a live request. Idempotent: on restart dist/ is already a symlink.
  if [ -d "${PLATFORM_DIR}/dist" ] && [ ! -L "${PLATFORM_DIR}/dist" ]; then
    rm -rf "${PLATFORM_DIR}/dist-a" "${PLATFORM_DIR}/dist-b"
    mv "${PLATFORM_DIR}/dist" "${PLATFORM_DIR}/dist-a"
    ln -sfn dist-a "${PLATFORM_DIR}/dist"
  fi

  local stamp="/tmp/frontend-build-stamp"
  : > "$stamp" # baseline now: prebuilt dist/ serves until the first real change

  (
    cd "$PLATFORM_DIR" || exit 0
    while [ ! -f "$SHUTDOWN_MARKER" ]; do
      # `|| true` so a transient find error never trips the loop's set -e.
      changed="$(find app lib -type f -newer "$stamp" 2>/dev/null | head -n1 || true)"
      if [ -n "$changed" ]; then
        : > "$stamp" # re-baseline before building so mid-build edits re-fire
        # Build into the inactive slot; the active one keeps serving meanwhile.
        if [ "$(readlink dist 2>/dev/null)" = "dist-a" ]; then
          next="dist-b"
        else
          next="dist-a"
        fi
        log_info "Frontend source changed → rebuilding (${next}) ..."
        if bun --bun vite build --mode development --outDir "$next" --emptyOutDir; then
          # Atomic publish: one rename(2) flips dist/ to the finished build.
          ln -sfn "$next" dist.tmp && mv -T dist.tmp dist
          log_ok "Frontend rebuilt; refresh the browser to see changes"
        else
          log_warn "Frontend rebuild failed (see vite output above); previous build still served"
        fi
      fi
      sleep 2
    done
  ) &
  FRONTEND_WATCH_PID=$!
  log_ok "Frontend watcher started (pid ${FRONTEND_WATCH_PID}); frontend edits rebuild on save"
}

start_frontend_watcher

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
echo "Tale Platform is running!"
echo
echo "   Application:       ${DISPLAY_BASE_URL}"
echo "   Convex API (WS):   ${DISPLAY_BASE_URL}/ws_api"
echo "   Convex Actions:    ${DISPLAY_BASE_URL}/http_api"
echo "   Convex Dashboard:  ${DISPLAY_BASE_URL}/convex-dashboard"
if [ "$DEV_SEED_STATUS" = "seeded" ]; then
  # Defaults mirror convex/provisioning/seed_dev_user.ts (keep in lockstep).
  # A custom password is intentionally never echoed.
  echo "   Dev login:         ${TALE_DEV_SEED_USER_EMAIL:-dev@tale.test}"
  if [ -z "${TALE_DEV_SEED_USER_PASSWORD:-}" ]; then
    echo "   Dev password:      TaleDev!Passw0rd"
  else
    echo "   Dev password:      (from TALE_DEV_SEED_USER_PASSWORD)"
  fi
fi
echo

wait "$VITE_PID"
