#!/bin/bash
# pipefail so silent pipe failures surface instead of producing empty
# downstream values. -u is intentionally omitted to avoid breaking the many
# `${VAR:-default}` patterns.
set -eo pipefail

# ============================================================================
# Tale Platform Docker Entrypoint
# ----------------------------------------------------------------------------
# Platform is the web tier: a Vite/TanStack SPA plus the HTTP server that
# serves it (branding images, the config SSE watch, WebDAV, canvas preview).
# Every application function lives in the `backend-api`/`backend-worker`
# services now — this process pushes nothing anywhere.
#
# Responsibilities:
#   1. Privilege drop (root → uid 1001 app)
#   2. Env normalization (incl. ensure_instance_secret)
#   3. Start the server (`bun server.ts`)
#   4. Touch /tmp/platform-ready (compose healthcheck gate)
#   5. Graceful shutdown on SIGTERM
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
# ============================================================================
# SSRF egress firewall (defense-in-depth) — installed while still root
# ----------------------------------------------------------------------------
# The backend roles below open sockets outside `safe_fetch.ts`'s pinned-IP
# path (yt-dlp, ffmpeg, the crawler's fetch/render lane), and `url_safety.ts`
# resolves DNS once for validation without pinning the IP across a
# re-resolution — a short-TTL rebind can flip a public-looking host to cloud
# IMDS or RFC1918 between the two lookups. Fence the whole egress surface at
# the kernel layer, in one place, exactly as the retired Convex container did.
#
# Skipped without NET_ADMIN (e.g. a local Mac docker) so dev still boots; the
# absence is logged for the operator.
install_ssrf_firewall() {
  if [ "${TALE_SKIP_SSRF_FIREWALL:-0}" = "1" ] || ! command -v iptables >/dev/null 2>&1; then
    log_warn "iptables unavailable or TALE_SKIP_SSRF_FIREWALL=1 — SSRF firewall NOT installed (dev mode)"
    return 0
  fi
  if ! iptables -L OUTPUT >/dev/null 2>&1; then
    log_warn "iptables present but no NET_ADMIN capability — SSRF firewall NOT installed (set cap_add: [NET_ADMIN] in compose.yml)"
    return 0
  fi
  log_info "Installing SSRF egress firewall (REJECT IMDS + link-local + RFC1918)"
  # Cloud instance metadata service (AWS/GCP/Azure IMDSv1 footprint).
  iptables -A OUTPUT -d 169.254.169.254/32 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || \
    log_warn "iptables: failed to reject 169.254.169.254/32 (continuing without IMDS guard)"
  # All link-local — covers Azure 168.63.129.16 and other variants.
  iptables -A OUTPUT -d 169.254.0.0/16 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || true
  # RFC1918 — only external private ranges (corp VPN, cloud VPC peers) are
  # blocked; same-compose traffic leaves via the bridge driver, not OUTPUT to
  # the host netns. Non-default docker-network modes: TALE_SKIP_SSRF_FIREWALL=1.
  iptables -A OUTPUT -d 10.0.0.0/8 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || true
  iptables -A OUTPUT -d 172.16.0.0/12 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || true
  iptables -A OUTPUT -d 192.168.0.0/16 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || true
}

if [ "$(id -u)" = '0' ]; then
  install_ssrf_firewall
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

# ============================================================================
# 0.5 role dispatch
# ----------------------------------------------------------------------------
# The same platform image runs the application backend: compose starts one
# `api` and one `worker` container from it (TALE_ROLE), each horizontally
# scalable. These roles only need DATABASE_URL — the web flow below is
# skipped. `exec` hands PID 1 (under tini) to Node so SIGTERM reaches the
# backend's own graceful shutdown.
# ============================================================================
case "${TALE_ROLE:-web}" in
  api|worker|all)
    log_section "Tale backend starting (role=${TALE_ROLE}, version ${TALE_VERSION:-unknown})"
    export ROLE="${TALE_ROLE}"
    # --experimental-transform-types + the resolve hook let the backend
    # import the shared pure modules (extensionless specifiers, non-erasable
    # TS) from the sibling trees unchanged.
    exec node --experimental-transform-types \
      --disable-warning=ExperimentalWarning \
      --import "${TALE_BACKEND_DIR:-/app/backend}/node-loader.mjs" \
      "${TALE_BACKEND_DIR:-/app/backend}/main.ts"
    ;;
  web)
    # Fall through to the platform web flow below.
    ;;
  *)
    log_error "Unknown TALE_ROLE '${TALE_ROLE}' (expected web|api|worker|all)"
    exit 64
    ;;
esac

log_section "Tale Platform starting (version ${TALE_VERSION:-unknown})"

# ============================================================================
# Shutdown handling
# ============================================================================
SHUTDOWN_MARKER="/tmp/platform-shutting-down"
READY_MARKER="/tmp/platform-ready"
rm -f "$SHUTDOWN_MARKER" "$READY_MARKER"

VITE_PID=""
# Set by the dev hot-reload watchers (empty in prod).
FRONTEND_WATCH_PID=""
# Outcome of the dev-login seed step (seeded/skipped/failed, empty when the
# gate is off) — the final banner only prints credentials for "seeded".

shutdown() {
  log_section "Platform graceful shutdown"
  touch "$SHUTDOWN_MARKER"

  # Stop the dev-only watcher first — non-critical, and an orphaned
  # `vite build --watch` keeps rebuilding dist.
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
cd "$PLATFORM_DIR" || { log_error "Platform dir ${PLATFORM_DIR} missing"; exit 1; }
log_info "Platform dir: ${PLATFORM_DIR}"

echo "Environment after normalization:"
echo "   HOST=${HOST}"
echo "   SITE_URL=${SITE_URL}"
echo "   PORT=${PORT}"

# Auth / encryption / rag env the server itself reads.
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL}"
export ENCRYPTION_SECRET_HEX="${ENCRYPTION_SECRET_HEX}"

# Default RAG DB URL constructed by env_normalize_common.
if [ -z "${RAG_DATABASE_URL:-}" ] && [ -n "${POSTGRES_URL:-}" ]; then
  export RAG_DATABASE_URL="${POSTGRES_URL}/tale_knowledge"
fi

# Admin key + WebDAV HMAC key. Both must be readable from `bun server.ts`'s
# process.env. `ADMIN_KEY` was once a `local` and silently went out of scope
# before the platform Hono server started — every `/dav/*` request then
# 500'd. Both
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
  echo "  Memory:      $(free -h 2>/dev/null | awk '/^Mem:/ {print $3" / "$2}')"
  echo "──────────────────────────────────────"
  echo
}

# ============================================================================
# Config store
# ----------------------------------------------------------------------------
# The org config tree (`$TALE_CONFIG_DIR/<orgSlug>/<domain>/…`) is the shared
# volume the backend writes and this service reads (branding images, the
# config SSE watch). The Convex runtime that used to own this volume — and
# the boot-time `convex deploy` push, the env sync and the dev watcher that
# went with it — is retired: the 0.5 backend owns every function now.
# ============================================================================
export TALE_CONFIG_DIR="${TALE_CONFIG_DIR:-/app/data}"
log_info "Config store: ${TALE_CONFIG_DIR}"

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
echo

wait "$VITE_PID"
