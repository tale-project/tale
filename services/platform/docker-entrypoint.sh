#!/bin/bash
# pipefail so silent pipe failures surface instead of producing empty
# downstream values. -u is intentionally omitted to avoid breaking the many
# `${VAR:-default}` patterns.
set -eo pipefail

# ============================================================================
# Tale Platform Docker Entrypoint
# ----------------------------------------------------------------------------
# One image, four roles (TALE_ROLE), each of them one node process:
#
#   web     the web tier alone: the built Vite/TanStack app, the shell that
#           carries it, the status page, branding images, the config SSE
#           watch and the canvas preview (server.ts). No database, no jobs.
#   api     the application's API, and the web tier beside it in the same
#           process, on a port of its own (APP_PORT, 3000).
#   worker  the job queues.
#   all     api and worker in one process.
#
# Responsibilities:
#   1. The SSRF egress firewall and the run markers, while still root
#   2. Privilege drop (root → uid 1001 app)
#   3. Env normalization (the web role: env.sh, incl. ensure_instance_secret)
#   4. Node's size flags, worked out from the container's memory limit
#   5. `exec node`: the process writes /tmp/platform-ready itself once it
#      serves (the compose healthcheck's gate) and handles SIGTERM itself
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
# Privilege handling: the re-exec dance makes sure we run as the app user so
# that Bun picks up the right HOME etc. (the entrypoint re-asserts config-volume
# ownership earlier, while still root).
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
  log_info "Installing SSRF egress firewall (REJECT IMDS + link-local + external RFC1918)"
  # Cloud instance metadata service (AWS/GCP/Azure IMDSv1 footprint).
  iptables -A OUTPUT -d 169.254.169.254/32 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || \
    log_warn "iptables: failed to reject 169.254.169.254/32 (continuing without IMDS guard)"
  # All link-local — covers Azure 168.63.129.16 and other variants.
  iptables -A OUTPUT -d 169.254.0.0/16 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || true
  # RFC1918 fence. Same-compose peers (db, object-store, the sandbox net)
  # sit on RFC1918 docker bridge subnets, and this netns's OUTPUT chain
  # filters packets to them too — the bridge driver only forwards what
  # netfilter lets out. So ACCEPT the container's directly-connected
  # subnets first, then reject the rest of the private space (corp VPN,
  # cloud VPC peers). Without the ACCEPTs the backend fences off its own
  # database and crash-loops on CONNECT_TIMEOUT: TCP treats the ICMP
  # reject as a soft error and retries SYN until the client gives up.
  # `scope link` keeps the pass-list to genuinely attached subnets — a
  # via-learned route (say 10.0.0.0/8 through some gateway) must not
  # widen it. No derivable subnets (no iproute2, or an empty scope-link
  # table) skips the RFC1918 fence rather than self-severing; IMDS and
  # link-local stay rejected regardless.
  # Non-default docker-network modes: TALE_SKIP_SSRF_FIREWALL=1.
  connected_subnets=""
  if command -v ip >/dev/null 2>&1; then
    connected_subnets="$(ip -4 route show scope link | awk '{print $1}')"
  fi
  if [ -n "$connected_subnets" ]; then
    for subnet in $connected_subnets; do
      iptables -A OUTPUT -d "$subnet" -j ACCEPT 2>/dev/null || \
        log_warn "iptables: failed to accept connected subnet ${subnet}"
    done
    iptables -A OUTPUT -d 10.0.0.0/8 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || true
    iptables -A OUTPUT -d 172.16.0.0/12 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || true
    iptables -A OUTPUT -d 192.168.0.0/16 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || true
  else
    log_warn "no directly-connected IPv4 subnets derivable (iproute2 missing or empty scope-link table) — RFC1918 fence NOT installed; IMDS + link-local guards active"
  fi
  # A reply is not SSRF: accept packets of connections that already exist
  # ahead of every REJECT above (inserted, so it is the first rule), as the
  # sandbox egress does. Without it a peer outside the directly-connected
  # subnets (a sandbox session routed in from another network, as on Incus)
  # opens a connection to this container and never sees its answer.
  iptables -I OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
    iptables -I OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
    log_warn "iptables: failed to accept replies on established connections"
}

# The markers a start must not inherit. /tmp outlives a stop whenever the
# runtime keeps the container's filesystem (`docker restart`, an Incus
# restart): a shutdown or ready marker of the previous run would answer the
# health and admission probes for this one before it serves. The withdrawal
# markers are what a blue/green runtime sets to take a replica out of its
# traffic switch (`/api/admission`, the backend's `/admission`); a restarted
# replica comes back admitted. Deleted here, as root and before the drop to
# `app`, for every role: one an exec created as root in sticky /tmp cannot be
# deleted by `app`. A failed delete warns and never stops the start.
clear_run_markers() {
  rm -f /tmp/platform-withdrawn /tmp/platform-shutting-down \
    /tmp/platform-ready /tmp/backend-withdrawn ||
    log_warn "could not delete the run markers in /tmp"
}

if [ "$(id -u)" = '0' ]; then
  install_ssrf_firewall
  clear_run_markers
  # The org-config volume mounts root-owned on first attach (and volumes a
  # v0.5.0 image ever booted against stayed that way — it never chowned
  # them), while every role runs as `app` and the backend must WRITE the
  # tree (the default object-store connection, governance files, SSO
  # connections). Top level only: everything deeper is app-created once this
  # succeeds, and a recursive walk would tax large config trees on every
  # boot. The web role mounts it read-only — hence best-effort.
  if [ -d /app/data ]; then
    chown app:app /app/data 2>/dev/null || \
      log_warn "could not chown /app/data (read-only mount or unsupported fs)"
  fi
  # The deployment-owned immutable bundle cache is shared by both colours.
  # Fail startup if it cannot be written; partial handovers must not pass
  # readiness without publishing their build artifacts.
  if [ -d /app/static-assets ]; then
    chown app:app /app/static-assets
  fi
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
# Node sizing for the backend
# ----------------------------------------------------------------------------
# Node sizes its heap for the machine, not for the container: under a 256 MiB
# limit V8 still allows itself a 259 MiB heap and a 48 MiB young generation,
# so the kernel kills the container before the collector ever feels short. The
# backend therefore starts with flags worked out from the container's own
# limit. Both functions use shell builtins only.
# ============================================================================

# The memory this container may use, in MiB, from its cgroup (v2 `memory.max`,
# v1 `memory.limit_in_bytes`); nothing when it has no limit.
container_memory_limit_mib() {
  local root="${TALE_CGROUP_ROOT:-/sys/fs/cgroup}" raw=""
  if [ -r "$root/memory.max" ]; then
    read -r raw < "$root/memory.max" || true
  elif [ -r "$root/memory/memory.limit_in_bytes" ]; then
    read -r raw < "$root/memory/memory.limit_in_bytes" || true
  fi
  case "$raw" in
    '' | *[!0-9]*) return 0 ;; # "max", or nothing readable
  esac
  # cgroup v1 writes "no limit" as a number near 2^63: past a petabyte is none.
  [ "${#raw}" -le 15 ] || return 0
  echo $((raw / 1048576))
}

# The node flags the built backend starts with, one per word.
#   BACKEND_NODE_FLAGS set (even empty): exactly those, whatever the limit.
#   No limit, or more than 1 GiB:        none; V8 sizes itself.
#   Up to 1 GiB:                         an 8 MiB semi-space (half the default).
#   Up to 512 MiB:                       a 4 MiB semi-space, code tuned for size,
#                                        and an old space of 55 % of the limit:
#                                        the rest is for the young generation,
#                                        memory outside the heap and the child
#                                        processes that share the container.
backend_node_flags() {
  if [ "${BACKEND_NODE_FLAGS+set}" = set ]; then
    echo "$BACKEND_NODE_FLAGS"
    return 0
  fi
  local limit heap
  limit="$(container_memory_limit_mib)"
  [ -n "$limit" ] || return 0
  if [ "$limit" -le 512 ]; then
    heap=$((limit * 55 / 100))
    [ "$heap" -ge 96 ] || heap=96
    echo "--max-old-space-size=${heap} --max-semi-space-size=4 --optimize-for-size"
  elif [ "$limit" -le 1024 ]; then
    echo "--max-semi-space-size=8"
  fi
}

# ============================================================================
# Starting node
# ----------------------------------------------------------------------------
# Every role ends here. `exec` hands the process over to node, under tini, so
# SIGTERM reaches the role's own graceful shutdown: no shell stays in between
# to forward it, to wait for the listener or to write the ready marker. The
# process does all three itself (backend/main.ts, backend/web-main.ts).
#   $1  the entry: `main` (api, worker, all) or `web-main` (web)
# ============================================================================
start_node() {
  local entry="$1"
  # glibc gives every thread that allocates an arena of its own, up to eight
  # per core, and returns little of one to the kernel. Two serve a process
  # whose JavaScript runs on one thread.
  export MALLOC_ARENA_MAX="${MALLOC_ARENA_MAX:-2}"
  # The dev image has no built backend: it names its sources in
  # TALE_BACKEND_DIR and runs them as they are. --experimental-transform-types
  # + the resolve hook let the backend import the shared pure modules
  # (extensionless specifiers, non-erasable TS) from the sibling trees
  # unchanged.
  if [ -n "${TALE_BACKEND_DIR:-}" ]; then
    exec node --experimental-transform-types \
      --disable-warning=ExperimentalWarning \
      --import "${TALE_BACKEND_DIR}/node-loader.mjs" \
      "${TALE_BACKEND_DIR}/${entry}.ts"
  fi
  # The production image runs the built backend (scripts/build-backend.ts):
  # plain node, no loader, no type transforming, and so none of the source
  # maps that transforming turns on for every module it reads.
  local node_flags memory_limit_mib
  node_flags="$(backend_node_flags)"
  memory_limit_mib="$(container_memory_limit_mib)"
  if [ -n "$memory_limit_mib" ]; then
    log_info "Node flags: ${node_flags:-none} (container memory limit: ${memory_limit_mib} MiB)"
  else
    log_info "Node flags: ${node_flags:-none} (container memory limit: none)"
  fi
  # The flags are words on purpose: one flag each.
  # shellcheck disable=SC2086
  exec node $node_flags "/app/backend-dist/${entry}.js"
}

# ============================================================================
# Role dispatch
# ----------------------------------------------------------------------------
# The backend roles start at once. They still need the in-compose service
# URLs (SANDBOX_URL at minimum): session_client.ts's host-dev default is
# localhost, which nobody serves inside the container. The web role prepares
# its environment first, below.
# ============================================================================
case "${TALE_ROLE:-web}" in
  api|worker|all)
    log_section "Tale backend starting (role=${TALE_ROLE}, version ${TALE_VERSION:-unknown})"
    export ROLE="${TALE_ROLE}"
    # The web role sources env.sh (which defaults SANDBOX_URL). These roles
    # start before that, and session_client.ts falls through to
    # http://localhost:8003 — nobody listens there in-container, so every
    # agent start dies in ~20ms with TypeError: fetch failed.
    export SANDBOX_URL="${SANDBOX_URL:-http://sandbox:8003}"
    start_node main
    ;;
  web)
    # Fall through to the web role below.
    ;;
  *)
    log_error "Unknown TALE_ROLE '${TALE_ROLE}' (expected web|api|worker|all)"
    exit 64
    ;;
esac

log_section "Tale Platform starting (version ${TALE_VERSION:-unknown})"

# The dev frontend watcher below stops when the process says it is stopping.
SHUTDOWN_MARKER="/tmp/platform-shutting-down"

# ============================================================================
# Environment normalization
# ============================================================================
source "$(dirname "$0")/env.sh"
env_normalize_common
ensure_instance_secret

# ----------------------------------------------------------------------------
# Layout detection (prod runner vs dev image)
# ----------------------------------------------------------------------------
# The production runner flattens the platform into /app: the built backend at
# /app/backend-dist, the built app at /app/dist. The dev image (Dockerfile
# `dev` stage) is the unpruned `builder` and keeps the monorepo layout:
# server.ts + vite config + backend live under /app/services/platform. One
# entrypoint serves both, so resolve the platform dir from a marker that ONLY
# the flat layout has (/app/backend-dist). Bind-mounting sources over
# /app/services/platform (compose.dev.yml) does NOT create /app/backend-dist,
# so the detection stays correct under those mounts. Only the dev frontend
# watcher below reads it: the server finds its files from where its own code
# is, whatever the working directory.
if [ -d /app/backend-dist ]; then
  PLATFORM_DIR=/app
else
  PLATFORM_DIR=/app/services/platform
fi
log_info "Platform dir: ${PLATFORM_DIR}"

# The web role has one listener, and PORT named its port before APP_PORT did
# (backend/web-main.ts reads APP_PORT first, then PORT).
echo "Environment after normalization:"
echo "   HOST=${HOST}"
echo "   SITE_URL=${SITE_URL}"
echo "   PORT=${APP_PORT:-${PORT}}"

# Auth / encryption env the server itself reads.
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL}"
export ENCRYPTION_SECRET_HEX="${ENCRYPTION_SECRET_HEX}"

# WebDAV app-password HMAC key. The backend hashes app passwords with it and
# the protocol door verifies against the same value, so it is derived
# deterministically from $INSTANCE_SECRET — it survives restarts and no
# operator has to set it by hand. An explicit override (.env) is honored for
# a rotation independent of INSTANCE_SECRET; otherwise a 64-char hex from
# sha256(secret || ':webdav-hmac:v1').
if [ -z "${WEBDAV_APP_PASSWORD_HMAC_KEY:-}" ]; then
  WEBDAV_APP_PASSWORD_HMAC_KEY="$(printf '%s' "${INSTANCE_SECRET}:webdav-hmac:v1" | sha256sum | awk '{print $1}')"
fi
export WEBDAV_APP_PASSWORD_HMAC_KEY

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
#
# The watcher is a child of this shell and stays one of the node process that
# replaces it. It ends on its own once that process writes the shutdown
# marker, and with the container otherwise.
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
  # layout, synchronously (before the server starts) so dist/ is never absent
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
  log_ok "Frontend watcher started (pid $!); frontend edits rebuild on save"
}

start_frontend_watcher

# ============================================================================
# The web tier
# ============================================================================
log_section "Starting the web tier on port ${APP_PORT:-${PORT}}"
start_node web-main
