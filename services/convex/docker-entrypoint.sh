#!/bin/bash
# pipefail catches the common pattern of `cmd | sed ...` silently producing
# empty output when cmd fails. -u (nounset) is intentionally NOT enabled —
# it would break the many `${VAR:-default}` patterns and conditional tests
# below; turning it on without an audit risks regressions worse than the
# noise it would catch.
set -eo pipefail

# ============================================================================
# Tale Convex Service Entrypoint
# ----------------------------------------------------------------------------
# Responsibilities (see plan: "Convex as a database"):
#   1. Privilege drop (root → uid 1001 app)
#   2. CA cert trust (for Rust backend → tale.local outbound HTTPS)
#   3. Builtin JSON seed (version-marker gated, idempotent)
#   4. Start convex-local-backend
#   5. Start Convex Dashboard (Next.js standalone) with basePath injection
#   6. Crash monitor (restart via Docker; we only observe & diagnose)
#   7. Touch /tmp/convex-ready when everything above is done (healthcheck gate)
#
# NOT done here:
#   - `bunx convex deploy` / `env set`  (platform service pushes remotely)
#   - Application-level env consumption  (BETTER_AUTH_SECRET, SOPS_AGE_KEY…
#     are pushed to Convex via `convex env set` and persisted in its DB)
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
# Privilege handling: fix data directory ownership, then drop to app user.
# When /app/data is a Docker volume, it may be mounted with root ownership.
# ----------------------------------------------------------------------------
if [ "$(id -u)" = '0' ]; then
  data_dir="${TALE_CONFIG_DIR:-/app/data}"
  mkdir -p "$data_dir/convex" "$data_dir/agents" "$data_dir/workflows" \
           "$data_dir/integrations" "$data_dir/providers" "$data_dir/branding"
  chown -R app:app "$data_dir"

  # ----------------------------------------------------------------------------
  # SSRF egress firewall (defense-in-depth)
  # ----------------------------------------------------------------------------
  # yt-dlp opens its own sockets (outside `safe_fetch.ts`'s pinned-IP path);
  # `url_safety.ts` resolves DNS once for validation but does NOT pin the
  # IP across yt-dlp's re-resolution. A short-TTL DNS rebind can flip a
  # public-looking host to cloud IMDS or RFC1918 between the two lookups.
  # Block at the kernel layer so the entire egress surface (yt-dlp,
  # ffmpeg, deno, safe_fetch fallbacks) is fenced in one place.
  #
  # Skipped when iptables isn't available (e.g. local Mac docker without
  # NET_ADMIN) so dev environments still boot — production compose grants
  # NET_ADMIN; absence here is logged for the operator.
  if [ "${TALE_SKIP_SSRF_FIREWALL:-0}" != "1" ] && command -v iptables >/dev/null 2>&1; then
    if iptables -L OUTPUT >/dev/null 2>&1; then
      log_info "Installing SSRF egress firewall (REJECT IMDS + link-local + RFC1918)"
      # Cloud instance metadata service (AWS/GCP/Azure IMDSv1 footprint).
      iptables -A OUTPUT -d 169.254.169.254/32 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || \
        log_warn "iptables: failed to reject 169.254.169.254/32 (continuing without IMDS guard)"
      # All link-local — covers Azure 168.63.129.16 and other variants.
      iptables -A OUTPUT -d 169.254.0.0/16 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || true
      # RFC1918 — Docker bridge subnets in the same compose network are
      # exempt via the `-o lo` and the docker0 default acceptance; only
      # external private ranges (corp VPN, cloud VPC peers) get blocked.
      # If the convex container itself shares a docker network with
      # platform/rag and they're on 172.16/12, this still works because
      # those flows leave via the bridge driver, not OUTPUT to the host
      # netns. If the operator runs in a non-default docker-network mode
      # set TALE_SKIP_SSRF_FIREWALL=1 to bypass.
      iptables -A OUTPUT -d 10.0.0.0/8 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || true
      iptables -A OUTPUT -d 172.16.0.0/12 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || true
      iptables -A OUTPUT -d 192.168.0.0/16 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || true
    else
      log_warn "iptables present but no NET_ADMIN capability — SSRF firewall NOT installed (set cap_add: [NET_ADMIN] in compose.yml)"
    fi
  else
    log_warn "iptables unavailable or TALE_SKIP_SSRF_FIREWALL=1 — SSRF firewall NOT installed (dev mode)"
  fi

  exec gosu app "$0" "$@"
fi

log_section "Tale Convex service starting (version ${TALE_VERSION:-unknown})"

# ============================================================================
# Shutdown marker + signal handling
# ============================================================================
SHUTDOWN_MARKER="/tmp/convex-shutting-down"
READY_MARKER="/tmp/convex-ready"
rm -f "$SHUTDOWN_MARKER" "$READY_MARKER"

CONVEX_PID=""
DASHBOARD_PID=""
MONITOR_PID=""
CONVEX_PID_FILE="/app/data/convex/convex.pid"

shutdown() {
  log_section "Convex service graceful shutdown"
  touch "$SHUTDOWN_MARKER"

  # Give Caddy health checks (2s interval) time to drain before we terminate.
  local drain_wait="${SHUTDOWN_DRAIN_SECONDS:-6}"
  log_info "Draining ${drain_wait}s for load balancer to stop routing..."
  sleep "$drain_wait"

  local current_convex_pid
  current_convex_pid=$(cat "$CONVEX_PID_FILE" 2>/dev/null || echo "")

  log_info "Sending SIGTERM to child processes..."
  # Every kill is guarded on a non-empty PID: `kill -TERM ""` is invalid and
  # would be silently swallowed by `|| true`, leaving an orphan process.
  [ -n "$MONITOR_PID" ]        && kill -TERM "$MONITOR_PID" 2>/dev/null || true
  [ -n "$DASHBOARD_PID" ]      && kill -TERM "$DASHBOARD_PID" 2>/dev/null || true
  [ -n "$current_convex_pid" ] && kill -TERM "$current_convex_pid" 2>/dev/null || true

  local shutdown_timeout="${SHUTDOWN_TIMEOUT_SECONDS:-30}"
  local waited=0
  while [ "$waited" -lt "$shutdown_timeout" ]; do
    local still_running=0
    [ -n "$MONITOR_PID" ]        && kill -0 "$MONITOR_PID" 2>/dev/null && still_running=1
    [ -n "$DASHBOARD_PID" ]      && kill -0 "$DASHBOARD_PID" 2>/dev/null && still_running=1
    [ -n "$current_convex_pid" ] && kill -0 "$current_convex_pid" 2>/dev/null && still_running=1
    [ $still_running -eq 0 ] && break
    sleep 1; waited=$((waited + 1))
  done

  if [ "$waited" -ge "$shutdown_timeout" ]; then
    log_warn "Timeout reached; force killing remaining processes"
    # Collect only non-empty PIDs so `kill -KILL ""` doesn't short-circuit.
    local force_pids=()
    [ -n "$MONITOR_PID" ]        && force_pids+=("$MONITOR_PID")
    [ -n "$DASHBOARD_PID" ]      && force_pids+=("$DASHBOARD_PID")
    [ -n "$current_convex_pid" ] && force_pids+=("$current_convex_pid")
    [ ${#force_pids[@]} -gt 0 ] && kill -KILL "${force_pids[@]}" 2>/dev/null || true
  fi

  rm -f "$SHUTDOWN_MARKER" "$READY_MARKER" "$CONVEX_PID_FILE"
  log_ok "Convex service stopped"
  exit 0
}
trap shutdown SIGTERM SIGINT

# ============================================================================
# Environment normalization
# ============================================================================
source "$(dirname "$0")/env.sh"
env_normalize_common
ensure_instance_secret

# ============================================================================
# CA certificate trust (self-signed Caddy → Rust backend HTTPS out)
# ============================================================================
CA_CERT_PATH="${CADDY_CA_CERT_PATH:-}"

if [ "${TLS_MODE:-selfsigned}" != "letsencrypt" ] && \
   [ "${TLS_MODE:-selfsigned}" != "external" ] && \
   [ -n "${CA_CERT_PATH}" ]; then
  CA_WAIT_TIMEOUT="${CA_WAIT_TIMEOUT:-60}"
  CA_WAIT_INTERVAL=2
  waited=0

  log_info "Waiting for Caddy CA certificate at ${CA_CERT_PATH}..."
  while [ ! -f "${CA_CERT_PATH}" ] && [ "$waited" -lt "$CA_WAIT_TIMEOUT" ]; do
    # Trigger certificate generation by making an insecure request to Caddy
    curl -sk "https://${HOST:-tale.local}/health" >/dev/null 2>&1 || true
    sleep "$CA_WAIT_INTERVAL"
    waited=$((waited + CA_WAIT_INTERVAL))
  done

  if [ -f "${CA_CERT_PATH}" ]; then
    log_ok "CA certificate ready after ${waited}s"
  else
    log_warn "CA certificate not found after ${CA_WAIT_TIMEOUT}s, continuing without it"
  fi
fi

if [ -n "${CA_CERT_PATH}" ] && [ -f "${CA_CERT_PATH}" ]; then
  log_info "Installing Caddy root CA for outbound HTTPS (Rust native-tls + Node)..."
  COMBINED_CA_BUNDLE="/tmp/ca-certificates.crt"
  SYSTEM_CA_BUNDLE="/etc/ssl/certs/ca-certificates.crt"
  if [ -f "${SYSTEM_CA_BUNDLE}" ]; then
    cp "${SYSTEM_CA_BUNDLE}" "${COMBINED_CA_BUNDLE}" 2>/dev/null || true
    cat "${CA_CERT_PATH}" >> "${COMBINED_CA_BUNDLE}" 2>/dev/null || true
    chmod 644 "${COMBINED_CA_BUNDLE}"
    export SSL_CERT_FILE="${COMBINED_CA_BUNDLE}"
    export REQUESTS_CA_BUNDLE="${COMBINED_CA_BUNDLE}"
    export NODE_EXTRA_CA_CERTS="${CA_CERT_PATH}"
    log_ok "CA bundle: ${COMBINED_CA_BUNDLE}"
  else
    log_warn "System CA bundle missing at ${SYSTEM_CA_BUNDLE}"
  fi
else
  unset NODE_EXTRA_CA_CERTS 2>/dev/null || true
fi

# ============================================================================
# Database wait (shared with platform/crawler/rag; already handled by
# compose depends_on, but we double-check for safety)
# ============================================================================
wait_for_port() {
  local host="$1" port="$2" timeout="${3:-60}" name="${4:-Service}"
  log_info "Waiting for ${name} at ${host}:${port}..."
  local counter=0
  while ! (echo > /dev/tcp/${host}/${port}) >/dev/null 2>&1; do
    counter=$((counter + 1))
    if [ $counter -gt $timeout ]; then
      log_error "${name} at ${host}:${port} not reachable within ${timeout}s"
      return 1
    fi
    sleep 1
  done
  log_ok "${name} at ${host}:${port} is reachable"
}

wait_for_http() {
  local url="$1" timeout="${2:-30}" name="${3:-Service}" allow_timeout="${4:-false}"
  log_info "Waiting for ${name} at ${url}..."
  local counter=0
  until curl -sf "$url" > /dev/null 2>&1; do
    counter=$((counter + 1))
    if [ $counter -gt $timeout ]; then
      if [ "$allow_timeout" = "true" ]; then
        log_warn "${name} health-check timeout (continuing)"
        return 0
      fi
      log_error "${name} failed to start within ${timeout}s"
      return 1
    fi
    sleep 1
  done
  log_ok "${name} is ready"
}

# Extract DB host:port from POSTGRES_URL for a TCP probe.
db_host=$(echo "$POSTGRES_URL" | sed -E 's#^postgres(ql)?://([^@/]+@)?([^:/?]+).*#\3#')
db_port=$(echo "$POSTGRES_URL" | sed -nE 's#^postgres(ql)?://([^@/]+@)?[^:/?]+:([0-9]+).*#\3#p')
db_port="${db_port:-5432}"
if [ -n "$db_host" ]; then
  wait_for_port "$db_host" "$db_port" 60 "PostgreSQL" || exit 1
fi

# ============================================================================
# Prepare working directories
# ============================================================================
mkdir -p /app/data/convex
export TMPDIR=/app/data/convex/tmp
mkdir -p "$TMPDIR"

# Orphan video-link tmp dirs from crashed/killed ingest_video_link.ts actions.
# Each job creates /app/data/convex/tmp/vlink-<uuid>/; on success the action's
# finally-block rm -rfs it, but kill -9 / OOM / container restart can leak.
# 60min cutoff is well past the 15min audio-extract wall-clock.
find "$TMPDIR" -mindepth 1 -maxdepth 1 -name 'vlink-*' -mmin +60 -exec rm -rf {} + 2>/dev/null || true

# yt-dlp version log — no network call, just confirms the binary baked
# into the image at build time. Real "is video ingestion working?" check
# happens at first ingest attempt (ENOENT → binary_not_installed fail-
# fast in convex/video_links/ytdlp.ts; upstream extractor regression →
# transient error visible on the chip within ~30s of a paste).
if [ -f /etc/yt-dlp-version ]; then
  log_info "yt-dlp $(cat /etc/yt-dlp-version) baked into image"
fi

# ============================================================================
# Builtin seed (version-marker gated)
# ----------------------------------------------------------------------------
# Marker: /app/data/.seeded-${TALE_VERSION}
# - Fresh volume or new version → run 4 seed loops
# - Same version restart → skip (already seeded)
# - FORCE_SEED=true → re-run regardless
# ----------------------------------------------------------------------------
seed_marker="/app/data/.seeded-${TALE_VERSION:-dev}"
data_dir="/app/data"

run_seed() {
  log_section "Seeding builtin configs (TALE_VERSION=${TALE_VERSION:-dev})"

  # --- Agents ---
  local agents_dir="${data_dir}/agents"
  local agents_builtin="/app/agents-builtin"
  mkdir -p "$agents_dir"
  if [ -d "$agents_builtin" ] && [ "$(ls -A "$agents_builtin" 2>/dev/null)" ]; then
    for src in "$agents_builtin"/*.json; do
      [ -f "$src" ] || continue
      local name="$(basename "$src")"
      local slug="$(basename "$src" .json)"
      local dest="$agents_dir/$name"
      local history_dir="$agents_dir/.history/$slug"
      if [ "$FORCE_SEED" = "true" ]; then
        cp "$src" "$dest"; echo "   ✓ Seeded $name (forced)"
      elif [ -f "$dest" ]; then
        echo "   ⏭ Skipping $name (already exists)"
      elif [ -d "$history_dir" ] && [ "$(ls -A "$history_dir" 2>/dev/null)" ]; then
        echo "   ⏭ Skipping $name (user has modifications in .history)"
      else
        cp "$src" "$dest"; echo "   ✓ Seeded agent $name"
      fi
    done
  fi

  # --- Workflows (nested paths allowed) ---
  local workflows_dir="${data_dir}/workflows"
  local workflows_builtin="/app/workflows-builtin"
  mkdir -p "$workflows_dir"
  if [ -d "$workflows_builtin" ] && [ "$(ls -A "$workflows_builtin" 2>/dev/null)" ]; then
    find "$workflows_builtin" -name '*.json' -type f | while read -r src; do
      local rel_path="${src#$workflows_builtin/}"
      local dest="$workflows_dir/$rel_path"
      local dest_dir="$(dirname "$dest")"
      local slug="${rel_path%.json}"
      local flat_slug="$(echo "$slug" | sed 's|/|__|g')"
      local history_dir="$workflows_dir/.history/$flat_slug"

      if [ "$FORCE_SEED" = "true" ]; then
        mkdir -p "$dest_dir"; cp "$src" "$dest"; echo "   ✓ Seeded workflow $rel_path (forced)"; continue
      fi
      if [ -f "$dest" ]; then echo "   ⏭ Skipping workflow $rel_path (already exists)"; continue; fi
      if [ -d "$history_dir" ] && [ "$(ls -A "$history_dir" 2>/dev/null)" ]; then
        echo "   ⏭ Skipping workflow $rel_path (user has modifications in .history)"; continue
      fi
      mkdir -p "$dest_dir"; cp "$src" "$dest"; echo "   ✓ Seeded workflow $rel_path"
    done
  fi

  # --- Integrations (directory-based) ---
  local integrations_dir="${data_dir}/integrations"
  local integrations_builtin="/app/integrations-builtin"
  mkdir -p "$integrations_dir"
  if [ -d "$integrations_builtin" ] && [ "$(ls -A "$integrations_builtin" 2>/dev/null)" ]; then
    for src_dir in "$integrations_builtin"/*/; do
      [ -d "$src_dir" ] || continue
      local name="$(basename "$src_dir")"
      local dest_dir="$integrations_dir/$name"
      if [ "$FORCE_SEED" = "true" ]; then
        cp -r "$src_dir" "$dest_dir"; echo "   ✓ Seeded integration $name (forced)"; continue
      fi
      if [ -d "$dest_dir" ]; then echo "   ⏭ Skipping integration $name (already exists)"; continue; fi
      cp -r "$src_dir" "$dest_dir"; echo "   ✓ Seeded integration $name"
    done
  fi

  # --- Providers (skip encrypted .secrets.json) ---
  local providers_dir="${data_dir}/providers"
  local providers_builtin="/app/providers-builtin"
  mkdir -p "$providers_dir"
  if [ -d "$providers_builtin" ] && [ "$(ls -A "$providers_builtin" 2>/dev/null)" ]; then
    for src in "$providers_builtin"/*.json; do
      [ -f "$src" ] || continue
      local name="$(basename "$src")"
      [[ "$name" == *.secrets.json ]] && continue
      local slug="$(basename "$src" .json)"
      local dest="$providers_dir/$name"
      local history_dir="$providers_dir/.history/$slug"
      if [ "$FORCE_SEED" = "true" ]; then
        cp "$src" "$dest"; echo "   ✓ Seeded provider $name (forced)"
      elif [ -f "$dest" ]; then
        echo "   ⏭ Skipping provider $name (already exists)"
      elif [ -d "$history_dir" ] && [ "$(ls -A "$history_dir" 2>/dev/null)" ]; then
        echo "   ⏭ Skipping provider $name (user has modifications in .history)"
      else
        cp "$src" "$dest"; echo "   ✓ Seeded provider $name"
      fi
    done
  fi

  # --- Retention (per-org JSON files: $TALE_CONFIG_DIR/retention/{slug}.json) ---
  # Default org's slug is hardcoded to `default`, so default.json fits
  # the {orgSlug}.json convention. Retention has no secrets to skip
  # (compare with providers' .secrets.json branch above).
  local retention_dir="${data_dir}/retention"
  local retention_builtin="/app/retention-builtin"
  mkdir -p "$retention_dir"
  if [ -d "$retention_builtin" ] && [ "$(ls -A "$retention_builtin" 2>/dev/null)" ]; then
    for src in "$retention_builtin"/*.json; do
      [ -f "$src" ] || continue
      local name="$(basename "$src")"
      local slug="$(basename "$src" .json)"
      local dest="$retention_dir/$name"
      local history_dir="$retention_dir/.history/$slug"
      if [ "$FORCE_SEED" = "true" ]; then
        cp "$src" "$dest"; echo "   ✓ Seeded retention $name (forced)"
      elif [ -f "$dest" ]; then
        echo "   ⏭ Skipping retention $name (already exists)"
      elif [ -d "$history_dir" ] && [ "$(ls -A "$history_dir" 2>/dev/null)" ]; then
        echo "   ⏭ Skipping retention $name (user has modifications in .history)"
      else
        cp "$src" "$dest"; echo "   ✓ Seeded retention $name"
      fi
    done
  fi

  touch "$seed_marker"
  log_ok "Builtin seed complete"
}

if [ "$FORCE_SEED" = "true" ] || [ ! -f "$seed_marker" ]; then
  run_seed
else
  log_info "Builtin seed already applied for version ${TALE_VERSION:-dev} (marker: $seed_marker)"
fi

# ============================================================================
# Crash diagnostics helpers
# ============================================================================
dump_diagnostics() {
  local ctx="$1"
  echo
  echo "──────── 🔍 Diagnostics: $ctx ────────"
  echo "  Timestamp:     $(date -Iseconds)"
  echo "  Hostname:      $(hostname)"
  echo "  Convex PID:    $(cat "$CONVEX_PID_FILE" 2>/dev/null || echo 'N/A')"
  echo "  Disk usage:    $(df -h /app/data 2>/dev/null | tail -1 | awk '{print $5" used ("$4" free)"}')"
  echo "  Memory:        $(free -h 2>/dev/null | awk '/^Mem:/ {print $3" / "$2}')"
  if [ -f /app/data/convex/backend.log ]; then
    echo "  Recent backend logs (last 20 lines):"
    tail -20 /app/data/convex/backend.log | sed 's/^/    /'
  fi
  if [ -d /app/data/convex/search ]; then
    echo "  Search segments: $(find /app/data/convex/search -type f 2>/dev/null | wc -l) files"
  else
    echo "  Search dir:    ❗ MISSING (search index will rebuild on next deploy)"
  fi
  echo "──────────────────────────────────────"
  echo
}

# ============================================================================
# Start convex-local-backend
# ============================================================================
# Build command args as arrays so values with spaces / special chars don't
# word-split at expansion time. Quoting variables in a single string does not
# protect against this — only `"${array[@]}"` does.
DB_ARGS=()
if [[ "$POSTGRES_URL" == postgresql* || "$POSTGRES_URL" == postgres* ]]; then
  DB_ARGS=(-d postgres-v5 "$POSTGRES_URL")
  log_info "Using PostgreSQL backend"
else
  DB_ARGS=("/app/data/convex/convex_local_backend.sqlite3")
  log_warn "POSTGRES_URL not a postgres URL; falling back to local SQLite (not recommended for production)"
fi

# NOTE: --instance-secret is passed via argv because convex-local-backend has
# no env-var channel for it. This exposes the secret to `ps`/`/proc/*/cmdline`
# for the life of the process; callers must treat the container's process
# table as sensitive. Investigate an env-var upstream before re-evaluating.
SITE_ARGS=(
  --site-proxy-port "${CONVEX_SITE_PROXY_PORT}"
  --port            "${CONVEX_BACKEND_PORT}"
  --interface       0.0.0.0
  --do-not-require-ssl
  --instance-name   "$INSTANCE_NAME"
  --instance-secret "$INSTANCE_SECRET"
)

# Log rotation: truncate backend.log if > 50MB (keep last 10MB).
if [ -f /app/data/convex/backend.log ] && \
   [ "$(stat -c%s /app/data/convex/backend.log 2>/dev/null || echo 0)" -gt 52428800 ]; then
  tail -c 10485760 /app/data/convex/backend.log > /app/data/convex/backend.log.tmp
  mv /app/data/convex/backend.log.tmp /app/data/convex/backend.log
  log_info "Truncated backend.log (was > 50MB)"
fi

log_section "Starting convex-local-backend on port ${CONVEX_BACKEND_PORT}"
export RUST_LOG="${RUST_LOG:-info,common::errors=off,isolate::client=off,application::scheduled_jobs=off}"

convex-local-backend "${DB_ARGS[@]}" --local-storage /app/data/convex "${SITE_ARGS[@]}" \
  > >(tee -a /app/data/convex/backend.log) \
  2> >(tee -a /app/data/convex/backend.log >&2) &
CONVEX_PID=$!
echo "$CONVEX_PID" > "$CONVEX_PID_FILE"

if ! wait_for_http "http://localhost:${CONVEX_BACKEND_PORT}/version" 60 "Convex backend /version" false; then
  log_error "Convex backend failed to start within 60s"
  echo
  echo "Possible causes:"
  echo "  1. Database connection failed (check POSTGRES_URL / DB credentials)"
  echo "  2. Port ${CONVEX_BACKEND_PORT} in use"
  echo "  3. Data directory permission issue (/app/data/convex)"
  echo "  4. instance_secret mismatch with existing DB state"
  echo "  5. Search index corruption blocking bootstrap"
  echo
  dump_diagnostics "Convex backend startup failure"
  kill -TERM "$CONVEX_PID" 2>/dev/null || true
  exit 1
fi
log_ok "Convex backend is healthy"

# Site proxy (3211) — optional probe; it sometimes stays "connecting" for a
# few seconds in local mode, so allow timeout.
wait_for_http "http://localhost:${CONVEX_SITE_PROXY_PORT}" 30 "Convex site proxy" true

# ============================================================================
# Start Convex Dashboard (Next.js standalone)
# ============================================================================
log_section "Starting Convex Dashboard on port ${CONVEX_DASHBOARD_PORT}"

# Patch the Next.js config on first boot (idempotent — sed matches only the
# empty placeholder strings). Dashboard image SHA is pinned in Dockerfile;
# if Convex changes the config format upstream, this sed may need updating.
if [ -f /dashboard/server.js ]; then
  sed -i "s|\"basePath\":\"\"|\"basePath\":\"${DASHBOARD_BASE_PATH}\"|g" /dashboard/server.js
  sed -i "s|\"assetPrefix\":\"\"|\"assetPrefix\":\"${DASHBOARD_BASE_PATH}\"|g" /dashboard/server.js
else
  log_warn "/dashboard/server.js not found; skipping Dashboard launch"
fi

# Capture the Dashboard PID in the parent shell directly. The previous
# implementation forked a subshell and wrote `$!` to /tmp/dashboard.pid, then
# read it back in the parent — a race where the parent could read before the
# subshell wrote, leaving DASHBOARD_PID empty and the process un-shutdownable.
if [ -f /dashboard/server.js ]; then
  ( cd /dashboard && exec env \
      NEXT_PUBLIC_DEPLOYMENT_URL="${SITE_URL}" \
      PORT="${CONVEX_DASHBOARD_PORT}" \
      HOSTNAME=0.0.0.0 \
      node server.js > /dev/null ) &
  DASHBOARD_PID=$!
  if [ -z "$DASHBOARD_PID" ]; then
    log_error "Failed to capture Convex Dashboard PID — cannot manage lifecycle"
    exit 1
  fi
fi

wait_for_http "http://localhost:${CONVEX_DASHBOARD_PORT}" 30 "Convex Dashboard" true

# ============================================================================
# Readiness marker — compose healthcheck gate
# ============================================================================
touch "$READY_MARKER"
log_ok "Convex service ready (marker: $READY_MARKER)"

# ============================================================================
# Monitor — observe backend crashes; rely on Docker restart policy for recovery
# ----------------------------------------------------------------------------
# This monitor NEVER deletes /app/data/convex/search (would desync DB metadata
# with file state — flusher would loop forever). It only classifies the crash
# and emits structured logs so operators can diagnose.
# ============================================================================
CRASH_LOG="/app/data/convex/crash.log"

monitor_convex() {
  local max_restarts=10
  local restart_count=0
  local restart_window=3600
  local last_restart_time=0

  while true; do
    sleep 10

    if curl -sf "http://localhost:${CONVEX_BACKEND_PORT}/version" > /dev/null 2>&1; then
      continue
    fi

    local current_time=$(date +%s)
    if [ $((current_time - last_restart_time)) -gt $restart_window ]; then
      restart_count=0
    fi
    restart_count=$((restart_count + 1))
    last_restart_time=$current_time

    local disk_free=$(df -h /app/data 2>/dev/null | tail -1 | awk '{print $4}')
    local search_exists="no"
    [ -d /app/data/convex/search ] && search_exists="yes"

    {
      echo "[$(date -Iseconds)] CRASH_DETECTED"
      echo "  restart_count:      $restart_count"
      echo "  disk_free:          $disk_free"
      echo "  search_dir_exists:  $search_exists"
    } | tee -a "$CRASH_LOG"

    # Analyze backend.log tail for likely root cause
    local log_tail=""
    [ -f /app/data/convex/backend.log ] && log_tail=$(tail -80 /app/data/convex/backend.log 2>/dev/null || echo "")
    if echo "$log_tail" | grep -qi "OOM\|out of memory\|killed"; then
      log_error "Suspected OOM — consider increasing container memory limit"
    elif echo "$log_tail" | grep -qi "postgres.*closed\|connection refused\|db.*error"; then
      log_error "Suspected database connection issue — check PostgreSQL"
    elif echo "$log_tail" | grep -q "panicked at"; then
      log_error "Rust panic detected:"
      echo "$log_tail" | grep -A 3 "panicked at" | head -10 | sed 's/^/  /'
    elif echo "$log_tail" | grep -qi "storage key not found\|segment.*not found"; then
      log_error "Search index segment missing"
      log_error "Manual intervention needed. Inspect backend.log; if indexes are truly lost:"
      log_error "  docker exec <convex-container> bash /app/scripts/force-rebuild-search-indexes.sh"
    else
      log_warn "Unidentified crash cause — see full backend.log"
    fi

    if [ $restart_count -le 3 ]; then
      log_warn "Convex backend crashed $restart_count time(s). Docker restart policy will recover."
    else
      log_error "Convex backend crashed $restart_count times within $restart_window s — manual intervention recommended"
    fi

    if [ $restart_count -gt $max_restarts ]; then
      log_error "Max restarts ($max_restarts) exceeded; exiting container to let Docker re-run"
      exit 1
    fi

    # We DO NOT restart here; Docker restart policy (unless-stopped) handles it.
    # Clean ONLY orphaned vlink-* dirs older than 5 min — NOT every tmp file.
    # The previous wildcard `rm -rf /app/data/convex/tmp/*` would wipe
    # arbitrary scratch files belonging to other Node actions (Whisper
    # chunks, image preprocessing, etc.) on every backend health-check
    # blip. Pattern + age filter mirrors the boot sweep at the top of
    # this file.
    find /app/data/convex/tmp -mindepth 1 -maxdepth 1 -name 'vlink-*' -mmin +5 -exec rm -rf {} + 2>/dev/null || true

    # Wait and re-check — if still down, container will exit next loop
    # when max_restarts exceeded. Meanwhile dump diagnostics.
    dump_diagnostics "Convex backend down (restart #$restart_count)"
    sleep 5
  done
}

monitor_convex &
MONITOR_PID=$!

# ============================================================================
# Wait on children
# ============================================================================
log_section "Convex service running"
echo "   Backend:    http://localhost:${CONVEX_BACKEND_PORT}"
echo "   Site proxy: http://localhost:${CONVEX_SITE_PROXY_PORT}"
echo "   Dashboard:  http://localhost:${CONVEX_DASHBOARD_PORT}  (base path: ${DASHBOARD_BASE_PATH})"
echo

# Only wait on PIDs that were actually captured. `wait ""` is a silent no-op
# and would mask a child that failed to start; enumerating explicitly ensures
# we surface the correct exit status.
wait_pids=()
[ -n "$CONVEX_PID" ]    && wait_pids+=("$CONVEX_PID")
[ -n "$DASHBOARD_PID" ] && wait_pids+=("$DASHBOARD_PID")
[ -n "$MONITOR_PID" ]   && wait_pids+=("$MONITOR_PID")
[ -n "$CONVEX_PID" ] || { log_error "CONVEX_PID missing; cannot wait on backend"; exit 1; }
wait "${wait_pids[@]}"
