#!/bin/sh
# services/sandbox-runtime/entrypoint.sh
#
# Per-call entrypoint inside an ephemeral sandbox container.
#
# Args (from spawner's docker run):
#   $1 = language ('python' | 'node' | 'bash' | 'polyglot')
#   $2 = path to packages.json (JSON array of pip/npm specs).
#        Polyglot mode IGNORES this file and reads
#        /user/code/packages-python.json + /user/code/packages-node.json
#        instead (either may be missing or empty).
#   $3 = path to options.json   (currently unused — kept for wire-shape stability)
#   $4 = entry path: either a relative POSIX path resolved under
#        /user/code/, or an absolute path under /user/code/ or
#        /user/.runtime/tale/ (the latter is the spawner-generated multi-step
#        wrapper). Anything else exits 65.
#
# Env (set by spawner via --env):
#   HTTPS_PROXY / HTTP_PROXY  -> http://sandbox-egress:3128
#   PIP_CACHE_DIR             -> /cache/pip (per-org named volume)
#   NPM_CONFIG_CACHE          -> /cache/npm
#
# Conventions:
#   - User code at /user/code/<path> — staged 1:1 from the spawner's
#     `files[]`. The runtime exec()s the file at $4; no synthetic mirror.
#   - Multi-step wrapper (when used) at /user/.runtime/tale/runner.{py,js} —
#     hidden segment is unreachable from user-supplied paths, so user files
#     can be named anything (including main.py).
#   - Output files in /user/output/
#   - install-stderr.log at /user/.runtime/install-stderr.log — captured stderr
#     from the package install step, tailed to container stderr on failure
#     (exit 64) so the spawner can surface it. Nothing reads stdout: install
#     stdout flows directly to the container stdout for live streaming.
#   - PHASE markers on stdout so the spawner can split install vs run timing.
#
# Exit codes:
#   0   = user code completed successfully
#   64  = install failed (spawner classifies as INSTALL_FAILED / PACKAGE_NOT_FOUND)
#   65  = bad invocation (unknown language / missing args / bad entry path)
#   >0  = user code exit code (RUNTIME_ERROR)

set -e

# ---------------------------------------------------------------------------
# Docker-in-container (DinD) helpers — used only when the spawner launches the
# session with TALE_DIND=1 (a sysbox/kata tier with SANDBOX_DOCKER_IN_CONTAINER;
# see config.ts + docker-session-args.ts). The container then starts as root
# (--user 0:0) so it can run an inner dockerd; we drop back to uid 10001 for
# runnerd. Everything here is dead code on the default (non-DinD) path.
# ---------------------------------------------------------------------------

# Controlled address pool for the inner daemon's bridges (docker0 +
# compose-created networks). Known so inner service-to-service traffic can be
# left direct (matched as the source pool by the transparent-egress redirect,
# see setup_inner_transparent_egress).
TALE_DIND_INNER_POOL="172.31.0.0/16"

# iptables/ip6tables live in /usr/sbin, which the image ENV PATH deliberately
# drops (keeps sbin tools off the agent PATH); call them by absolute path.
_IPTABLES=/usr/sbin/iptables
_IP6TABLES=/usr/sbin/ip6tables

# Resolve a proxy URL's host to an IP. CRITICAL: the session reaches the egress
# proxy by its Docker DNS name (e.g. http://sandbox-egress:3128), but INNER
# build containers are on the inner docker network and can't resolve outer
# Docker names — so a hostname proxy makes every inner apt/apk/pip fail with
# "temporary error" / "connection closed prematurely". Rewriting the host to its
# IP (resolved here, in the session netns) makes the proxy reachable from inner
# containers (the IP routes via the inner NAT to tale-sandbox-net). Falls back to
# the original URL if it's already an IP or resolution fails.
_proxy_to_ip() {
  _url="$1"
  [ -n "$_url" ] || return 0
  _hostport="${_url#*://}"            # sandbox-egress:3128
  _scheme="${_url%%://*}"             # http
  _host="${_hostport%%:*}"            # sandbox-egress
  _rest="${_hostport#"$_host"}"       # :3128 (preserve port if any)
  # Already an IP? leave it.
  case "$_host" in
    *[!0-9.]*) ;; # has non-digit/dot → a hostname, resolve it
    *) printf '%s' "$_url"; return 0 ;;
  esac
  _ip="$(getent hosts "$_host" 2>/dev/null | awk 'NR==1{print $1}')"
  if [ -n "$_ip" ]; then
    printf '%s://%s%s' "$_scheme" "$_ip" "$_rest"
  else
    printf '%s' "$_url"
  fi
}

# Egress proxy endpoint (IP + port), resolved once in the session netns. The
# session reaches the proxy by Docker DNS name (sandbox-egress:3128); we resolve
# it to an IP that inner containers can also route to. The same host also serves
# DNS on :53. Sets TALE_EGRESS_IP / TALE_EGRESS_PORT (IP empty if unresolved).
resolve_egress_endpoint() {
  _u="$(_proxy_to_ip "${HTTP_PROXY:-${HTTPS_PROXY:-}}")"
  _hp="${_u#*://}"
  TALE_EGRESS_IP="${_hp%%:*}"
  _p="${_hp#*:}"
  TALE_EGRESS_PORT="${_p%%/*}"
  case "${TALE_EGRESS_PORT}" in '' | *[!0-9]*) TALE_EGRESS_PORT=3128 ;; esac
  case "${TALE_EGRESS_IP}" in '' | *[!0-9.]*) TALE_EGRESS_IP='' ;; esac
}

# Transparent egress for nested containers. We deliberately do NOT inject
# HTTP(S)_PROXY env into inner containers: that hijacks ALL their HTTP traffic
# including localhost/sibling — busybox wget (e.g. a Caddy self healthcheck
# against 127.0.0.1) ignores no_proxy and proxies it, so the check can never
# reach itself — and proxy env can't carry DNS at all. Instead redsocks tunnels
# inner *public* TCP through the egress proxy transparently while internal /
# private traffic stays direct, and the egress proxy's dnsmasq (wired via the
# inner daemon's --dns) resolves external names. Inner apps then reach the
# internet with zero proxy config and their internal healthchecks work
# unchanged. Both :80 and :443 tunnel through CONNECT (redsocks http-connect;
# http-relay is CVE-discouraged and mangles responses) — the egress tinyproxy
# is configured with ConnectPort 80 + 443 to match.
setup_inner_transparent_egress() {
  if [ -z "${TALE_EGRESS_IP}" ]; then
    echo "[entrypoint] WARN: no egress proxy IP resolved; nested containers will have no internet egress" >&2
    return 0
  fi
  # A previous (proxy-injection era) session may have left a docker client config
  # that sets HTTP(S)_PROXY on every inner container, persisted in the workspace;
  # that hijacks inner localhost/sibling traffic (busybox ignores no_proxy). With
  # transparent egress there must be no proxy env — drop the stale file.
  rm -f /user/.runtime/home/.docker/config.json 2>/dev/null || true
  cat >/etc/redsocks.conf <<EOF
base { log_debug = off; log_info = off; log = "stderr"; daemon = off; redirector = iptables; }
redsocks { local_ip = 0.0.0.0; local_port = 12346; ip = ${TALE_EGRESS_IP}; port = ${TALE_EGRESS_PORT}; type = http-connect; }
EOF
  # redsocks lives in /usr/sbin, which the image PATH drops — call it absolute.
  /usr/sbin/redsocks -c /etc/redsocks.conf >/var/log/redsocks.log 2>&1 &
  # nat REDSOCKS chain: leave internal / private / link-local DIRECT (so inner
  # service-to-service, localhost healthchecks and the inner embedded DNS are
  # untouched), tunnel everything public through redsocks.
  "$_IPTABLES" -t nat -N REDSOCKS 2>/dev/null || "$_IPTABLES" -t nat -F REDSOCKS
  for _cidr in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16; do
    "$_IPTABLES" -t nat -A REDSOCKS -d "$_cidr" -j RETURN
  done
  "$_IPTABLES" -t nat -A REDSOCKS -p tcp -j REDIRECT --to-ports 12346
  # Apply to every nested container regardless of which inner compose bridge it
  # lands on (all draw from the inner pool); PREROUTING sees the original source
  # before the inner daemon's MASQUERADE rewrites it.
  "$_IPTABLES" -t nat -C PREROUTING -s "${TALE_DIND_INNER_POOL}" -p tcp -j REDSOCKS 2>/dev/null \
    || "$_IPTABLES" -t nat -A PREROUTING -s "${TALE_DIND_INNER_POOL}" -p tcp -j REDSOCKS
  echo "[entrypoint] transparent egress installed (redsocks -> ${TALE_EGRESS_IP}:${TALE_EGRESS_PORT}; nested public TCP tunneled, internal direct, DNS via egress :53)"
}

# Block inner containers from the cloud metadata endpoint (IMDS) + link-local —
# never legitimate; cheap defense-in-depth. Installed in DOCKER-USER, which
# Docker evaluates BEFORE its own per-bridge ACCEPT rules, so it actually takes
# effect (a plain FORWARD append is shadowed by Docker's rules and does nothing).
# Must run AFTER dockerd starts (dockerd creates the DOCKER-USER chain). Egress
# is otherwise OPEN: inner containers reach the internet through the egress proxy
# (transparently, see setup_inner_transparent_egress). Broader internal lockdown
# (RFC1918 / cross-tenant) is a follow-up tied to an egress allowlist.
# Best-effort: IMDS is already unreachable via the --internal network, so a
# failure here is not fatal.
apply_inner_egress_fence() {
  "$_IPTABLES" -I DOCKER-USER -d 169.254.0.0/16 -j REJECT \
    --reject-with icmp-host-prohibited 2>/dev/null ||
    echo "[entrypoint] WARN: could not install inner IMDS egress fence (non-fatal; --internal already blocks it)" >&2
  if [ -x "$_IP6TABLES" ]; then
    for _c6 in fe80::/10 ::ffff:169.254.0.0/112; do
      "$_IP6TABLES" -I DOCKER-USER -d "$_c6" -j REJECT 2>/dev/null || true
    done
  fi
}

# cgroup v2 nesting. Without this, dockerd + PID 1 sit in the unified cgroup
# *root*; cgroup v2's "no internal processes" rule then forces the subtree into
# THREADED mode as soon as dockerd adds child cgroups, and threaded cgroups
# reject *domain* controllers (memory, io). The result: any inner container
# started with a memory/pids limit dies with
#   "cannot enter cgroupv2 \"/sys/fs/cgroup/docker\" with domain controllers
#    -- it is in threaded mode"
# which silently breaks `docker compose up` for the very common case of services
# that set mem_limit/pids_limit. Mirror what the official docker:dind entrypoint
# does: move every process out of the cgroup root into a leaf so the root can
# become an inner node, then delegate the available controllers into the root's
# subtree. MUST run before dockerd so the /docker tree it creates is a domain
# cgroup with memory/pids available. Best-effort: a failure only costs us the
# pre-nesting behaviour, so warn rather than abort.
setup_cgroup_nesting() {
  _cg=/sys/fs/cgroup
  # cgroup v1 (no unified controllers file) or already delegated → nothing to do.
  [ -f "$_cg/cgroup.controllers" ] || return 0
  grep -qw memory "$_cg/cgroup.subtree_control" 2>/dev/null && return 0
  mkdir -p "$_cg/init" 2>/dev/null || true
  # Relocate every process (including this shell / PID 1) into the leaf; the root
  # must be process-free before it can carry subtree_control.
  while read -r _pid; do
    echo "$_pid" >"$_cg/init/cgroup.procs" 2>/dev/null || true
  done <"$_cg/cgroup.procs"
  # Delegate controllers one at a time so an un-enableable one (e.g. cpuset)
  # doesn't block the critical memory/pids delegation.
  for _ctl in cpu io memory pids cpuset hugetlb; do
    grep -qw "$_ctl" "$_cg/cgroup.controllers" 2>/dev/null &&
      echo "+$_ctl" >"$_cg/cgroup.subtree_control" 2>/dev/null || true
  done
  grep -qw memory "$_cg/cgroup.subtree_control" 2>/dev/null ||
    echo "[entrypoint] WARN: could not delegate the cgroup memory controller; inner containers with mem_limit/pids_limit may fail to start (cgroupv2 threaded mode)" >&2
}

# Start an inner dockerd and block until it's ready. Fails closed (exit 1) on
# any of: fence install failure, a non-remapped userns on the sysbox tier
# (would mean container-root == host-root), dockerd dying, or a readiness
# timeout — so a broken DinD session never silently serves with a dead/unsafe
# daemon. dockerd inherits HTTP(S)_PROXY/NO_PROXY from the container env so
# image pulls traverse the egress proxy.
start_inner_dockerd() {
  # Sysbox must remap the userns (container-root -> unprivileged host subuid).
  # If it didn't, we'd be granting a daemon real host-root; refuse. Kata is
  # VM-isolated, so an identity map there is expected and fine.
  if [ "${TALE_RUNTIME_TIER:-}" = "sysbox" ]; then
    _host0="$(awk 'NR==1{print $2}' /proc/self/uid_map 2>/dev/null || echo 0)"
    if [ "${_host0:-0}" = "0" ]; then
      echo "[entrypoint] FATAL: sysbox tier but container-root maps to host-root (uid_map: $(cat /proc/self/uid_map 2>/dev/null)); not a remapped userns — refusing dockerd" >&2
      exit 1
    fi
  fi

  # Prepare cgroup v2 delegation BEFORE dockerd, so the /docker cgroup tree it
  # creates is a domain cgroup that can carry memory/pids limits.
  setup_cgroup_nesting

  mkdir -p /var/lib/docker /var/log

  # Resolve the egress proxy/DNS endpoint, then point the inner daemon's default
  # DNS at the egress dnsmasq so nested containers resolve external names (the
  # inner embedded DNS forwards external queries here; sibling names stay local).
  resolve_egress_endpoint
  _dns_flags=""
  [ -n "${TALE_EGRESS_IP}" ] && _dns_flags="--dns=${TALE_EGRESS_IP}"

  # dockerd (and the iptables/modprobe it shells out to) need /usr/sbin on PATH,
  # which the image ENV drops. Scope the widened PATH to dockerd only — runnerd
  # is exec'd later with the unmodified (sbin-free) agent PATH.
  # shellcheck disable=SC2086 # _dns_flags must word-split: empty, or one --dns flag
  PATH="/usr/sbin:/sbin:${PATH}" dockerd \
    --host=unix:///var/run/docker.sock \
    --data-root=/var/lib/docker \
    --bip=172.31.0.1/24 \
    --default-address-pool "base=${TALE_DIND_INNER_POOL},size=24" \
    --storage-driver=overlay2 \
    ${_dns_flags} \
    >/var/log/dockerd.log 2>&1 &
  TALE_DOCKERD_PID=$!

  _i=0
  while [ "$_i" -lt 60 ]; do
    if ! kill -0 "$TALE_DOCKERD_PID" 2>/dev/null; then
      echo "[entrypoint] FATAL: inner dockerd exited during startup:" >&2
      tail -n 20 /var/log/dockerd.log >&2 2>/dev/null || true
      exit 1
    fi
    if docker info >/dev/null 2>&1; then
      # DOCKER-USER exists now that dockerd is up — install the IMDS fence and
      # the transparent-egress redirect (both need the daemon's chains/bridge).
      apply_inner_egress_fence
      setup_inner_transparent_egress
      echo "[entrypoint] inner dockerd ready (tier=${TALE_RUNTIME_TIER:-?}, pid=${TALE_DOCKERD_PID})"
      return 0
    fi
    _i=$((_i + 1))
    sleep 0.5
  done
  echo "[entrypoint] FATAL: inner dockerd not ready within 30s:" >&2
  tail -n 20 /var/log/dockerd.log >&2 2>/dev/null || true
  exit 1
}

# ---------------------------------------------------------------------------
# Live browser view (read-only mirror). Used only when the spawner launches the
# session with TALE_BROWSER_CDP=1 (operator flag SANDBOX_BROWSER_VIEW; see
# config.ts + docker-session-args.ts). Brings up ONE managed HEADED Chromium
# with a CDP endpoint on loopback 127.0.0.1:9222 that Playwright MCP attaches to
# (instead of self-launching headless), mirrored read-only by x11vnc on loopback
# 127.0.0.1:5900. Both ports are LOOPBACK-ONLY and the container publishes none —
# the mirror is reachable only from inside the container. The agent drives the
# browser over CDP; x11vnc runs -viewonly so the X side can never inject input —
# that is the airtight read-only guarantee. Fail-open: any step failing logs a
# WARN and continues so runnerd still starts (a session must work even if the
# browser view didn't come up). Dead code on the default path (flag unset).
# ---------------------------------------------------------------------------

# Resolve the Chromium the MCP would launch — the SAME playwright-core bundled
# under @playwright/mcp the Dockerfile build-verifies (see the executablePath()
# check ~line 111). Prints the path or nothing.
_resolve_chrome_bin() {
  node -e "const p=require('/opt/agents/lib/node_modules/@playwright/mcp/node_modules/playwright-core'); process.stdout.write(p.chromium.executablePath())" 2>/dev/null || true
}

# Supervise a command in a rate-limited restart loop (background). A crash is
# auto-restarted after a 1s pause; the 1s also caps the restart rate. The whole
# loop is detached so the entrypoint moves on to exec runnerd. In DinD mode the
# caller passes $DROP (setpriv → uid 10001) as the first arg so these run as the
# agent user, not root.
_supervise() {
  ( while true; do "$@"; sleep 1; done ) &
}

start_browser_stack() {
  echo "[entrypoint] starting live browser view (TALE_BROWSER_CDP=1)"

  # X11 socket dir on the writable tmpfs (read-only root otherwise).
  $DROP mkdir -p /tmp/.X11-unix 2>/dev/null || true
  $DROP chmod 1777 /tmp/.X11-unix 2>/dev/null || true

  CHROME_BIN="$(_resolve_chrome_bin)"
  if [ -z "${CHROME_BIN}" ] || [ ! -x "${CHROME_BIN}" ]; then
    echo "[entrypoint] WARN: could not resolve a runnable Chromium for the browser view (got '${CHROME_BIN:-}'); skipping — runnerd will still start" >&2
    return 0
  fi

  # Virtual display for the headed browser. -nolisten tcp keeps the X server off
  # the network (loopback unix socket only); -ac disables host access control
  # (only the in-container procs can reach the socket anyway).
  # shellcheck disable=SC2086 # $DROP must word-split (empty, or the setpriv prefix)
  _supervise $DROP Xvfb :99 -screen 0 1280x720x24 -nolisten tcp -ac
  export DISPLAY=:99

  # Read-only mirror. -localhost binds 127.0.0.1 only, -viewonly drops all X
  # input from the VNC side (the agent drives via CDP, never via VNC). -nopw is
  # acceptable because the port is loopback-only inside an isolated container.
  # shellcheck disable=SC2086
  _supervise $DROP x11vnc -display :99 -rfbport 5900 -localhost -viewonly \
    -forever -shared -nopw -noxdamage

  # Headed Chromium with a CDP endpoint on loopback. The proxy bridge mirrors
  # the tale-playwright-mcp shim (Chromium ignores HTTPS_PROXY/NO_PROXY env):
  # forward the egress proxy + bypass list as flags so the managed browser has
  # the same egress posture the self-launched one would.
  set -- "${CHROME_BIN}" \
    --remote-debugging-port=9222 \
    --remote-debugging-address=127.0.0.1 \
    --user-data-dir=/tmp/cdp-profile \
    --no-sandbox \
    --disable-gpu \
    --start-fullscreen \
    --window-size=1280,720 \
    --ignore-certificate-errors
  [ -n "${HTTPS_PROXY:-}" ] && set -- "$@" --proxy-server="${HTTPS_PROXY}"
  [ -n "${NO_PROXY:-}" ] && set -- "$@" --proxy-bypass-list="${NO_PROXY}"
  # shellcheck disable=SC2086
  _supervise $DROP "$@"

  # Block on CDP readiness, fail-open. A failed curl must NOT abort the script
  # (set -e) — the loop swallows it and the timeout path only WARNs.
  _i=0
  while [ "$_i" -lt 30 ]; do
    if curl -fsS "http://127.0.0.1:9222/json/version" >/dev/null 2>&1; then
      echo "[entrypoint] live browser view ready (CDP 127.0.0.1:9222, VNC 127.0.0.1:5900, view-only)"
      return 0
    fi
    _i=$((_i + 1))
    sleep 0.5
  done
  echo "[entrypoint] WARN: headed Chromium CDP not ready within ~15s; continuing (runnerd starts; Playwright MCP --cdp-endpoint will retry the connection)" >&2
  return 0
}

# ---------------------------------------------------------------------------
# Session daemon dispatch (sessions plan). The spawner launches a long-lived
# session container with a single positional arg `daemon` (see
# session/docker-session-args.ts); everything else is the one-shot
# /v1/execute path below, untouched. runnerd is PID 1 of a session container,
# so we `exec` it (SIGTERM from container-stop must reach it directly).
# ---------------------------------------------------------------------------
if [ "$1" = "daemon" ]; then
  # In DinD mode the container starts as root (so it can run an inner dockerd),
  # so the workspace skeleton + steer cleanup must be done AS the agent (uid
  # 10001) — otherwise the dirs would be root-owned and runnerd couldn't write
  # them. On the default path the container is already uid 10001 (--user), so
  # DROP is empty and these run directly, exactly as before.
  DROP=""
  [ "${TALE_DIND:-}" = "1" ] &&
    DROP="setpriv --reuid 10001 --regid 10001 --init-groups --"

  # Bootstrap the persistent workspace skeleton. HOME lives here so agent
  # state (~/.claude, ~/.config/opencode, ~/.gitconfig) survives every exec
  # and container restart within the session. Idempotent — the dirs already
  # exist on a container restart against the same workspace volume.
  $DROP mkdir -p \
    /user/workspace \
    /user/uploads \
    /user/output \
    /user/.runtime/home \
    /user/.runtime/deps/python \
    /user/.runtime/deps/node
  # Stale per-exec steer queues (mid-turn message injection): a container
  # (re)start means no exec is live, so leftover steer/consumed files are
  # garbage from a previous incarnation — drop them. The platform re-queues
  # anything it hadn't reconciled.
  $DROP rm -rf /user/.runtime/tale/steer
  # Same install env the one-shot path exports, so inline pip/npm from a
  # session exec lands in the writable, on-PYTHONPATH/NODE_PATH location.
  export HOME=/user/.runtime/home
  export TMPDIR=/tmp
  export PIP_TARGET=/user/.runtime/deps/python
  export PYTHONPATH=/user/.runtime/deps/python${PYTHONPATH:+:$PYTHONPATH}
  export PIP_DISABLE_PIP_VERSION_CHECK=1
  export NPM_CONFIG_PREFIX=/user/.runtime/deps/node
  export NODE_PATH=/user/.runtime/deps/node/lib/node_modules
  export PATH=/user/.runtime/deps/python/bin:/user/.runtime/deps/node/bin:$PATH

  # Live browser view (operator flag): bring up the headed Chromium + Xvfb +
  # x11vnc mirror BEFORE handing off to runnerd, so Playwright MCP can attach to
  # the CDP endpoint on the first browser tool call. In DinD mode the supervisor
  # loops run as uid 10001 via $DROP (set above); on the default path the
  # container is already uid 10001 and $DROP is empty. Fail-open inside.
  if [ "${TALE_BROWSER_CDP:-}" = "1" ]; then
    start_browser_stack
  fi

  # DinD: bring up the inner dockerd as root, then hand off. tini becomes PID 1
  # to reap the many short-lived shims native docker spawns (teardown is a
  # SIGKILL to PID 1, so runnerd no longer needs to be PID 1 itself); the
  # already-backgrounded dockerd reparents to tini. setpriv drops to the agent
  # user so Claude Code's bypassPermissions (refused as root) still works.
  if [ "${TALE_DIND:-}" = "1" ]; then
    start_inner_dockerd
    exec tini -g -- \
      setpriv --reuid 10001 --regid 10001 --init-groups -- \
      node /usr/local/lib/tale/runnerd.mjs
  fi

  # Default (non-DinD) path: runnerd is PID 1 at the container's --user, exactly
  # as before — SIGTERM from container-stop reaches it directly.
  exec node /usr/local/lib/tale/runnerd.mjs
fi

LANG_NAME="$1"
PACKAGES_FILE="${2:-/user/code/packages.json}"
# $3 (options.json path) is reserved for future flags; currently unused.
ENTRY_ARG="${4:?sandbox-runtime: missing entry path (positional arg 4)}"

# Resolve entry path. Accept either an absolute path under one of the two
# allowed roots, or a relative path interpreted under /user/code/.
case "$ENTRY_ARG" in
  /user/.runtime/tale/*|/user/code/*)
    ENTRY_FILE="$ENTRY_ARG"
    ;;
  /*)
    echo "sandbox-runtime: entry path outside /user: $ENTRY_ARG" >&2
    exit 65
    ;;
  *)
    ENTRY_FILE="/user/code/$ENTRY_ARG"
    ;;
esac
case "$ENTRY_FILE" in
  *..*)
    echo "sandbox-runtime: traversal segment in entry path: $ENTRY_ARG" >&2
    exit 65
    ;;
esac

# Workspace is delivered via host bind-mount (spawner.ts:stageWorkspace
# writes /var/lib/tale-sandbox/sessions/<id>/{code,input,output}/ on the
# host and mounts it 1:1 at /user inside this container). The mkdir
# below is defensive — the bind-mount source already contains these dirs
# when the spawner is happy, but a malformed call should still see
# usable /user/output to write into. The `.runtime/deps/{python,node}` and
# `.runtime/home` dirs back the install env exports below, so any step (python,
# node, bash) can run `pip install` / `npm install` and have it land in
# a writable, on-PYTHONPATH/NODE_PATH location.
mkdir -p \
  /user/code \
  /user/input \
  /user/output \
  /user/.runtime/deps/python \
  /user/.runtime/deps/node \
  /user/.runtime/home

# Install env exported BEFORE language routing so every step language
# (python, node, bash) inherits the same writable paths. The container
# is the security boundary; install-time guards (--only-binary,
# --ignore-scripts) added nothing on top of cap-drop=ALL + read-only
# root + nobody user + proxied egress behind the IP-layer SSRF
# firewall, so they're gone.
export HOME=/user/.runtime/home
export TMPDIR=/tmp
export PIP_TARGET=/user/.runtime/deps/python
export PYTHONPATH=/user/.runtime/deps/python${PYTHONPATH:+:$PYTHONPATH}
export PIP_DISABLE_PIP_VERSION_CHECK=1
export NPM_CONFIG_PREFIX=/user/.runtime/deps/node
export NODE_PATH=/user/.runtime/deps/node/lib/node_modules
# Console scripts from both ecosystems on PATH: pip --target installs
# entry-point shims into $PIP_TARGET/bin, npm -g installs into
# $NPM_CONFIG_PREFIX/bin. Put them ahead of system bins so installed
# tools (markitdown, prettier, etc.) resolve directly.
export PATH=/user/.runtime/deps/python/bin:/user/.runtime/deps/node/bin:$PATH

echo "PHASE: installing"

PACKAGES_ARGV=""
if [ -f "$PACKAGES_FILE" ]; then
  # jq @sh escapes each package spec safely for shell expansion. The PACKAGES_FILE
  # was written by the spawner (a trusted, typed pipeline) — not user shell input.
  PACKAGES_ARGV=$(jq -r '. | map(@sh) | join(" ")' "$PACKAGES_FILE" 2>/dev/null || echo "")
fi

# Polyglot extras — each bucket lives in its own file written by the
# spawner. Either may be absent or carry an empty array, in which case
# the matching install pass is skipped.
PY_PACKAGES_FILE="/user/code/packages-python.json"
NODE_PACKAGES_FILE="/user/code/packages-node.json"
PY_PACKAGES_ARGV=""
NODE_PACKAGES_ARGV=""
if [ -f "$PY_PACKAGES_FILE" ]; then
  PY_PACKAGES_ARGV=$(jq -r '. | map(@sh) | join(" ")' "$PY_PACKAGES_FILE" 2>/dev/null || echo "")
fi
if [ -f "$NODE_PACKAGES_FILE" ]; then
  NODE_PACKAGES_ARGV=$(jq -r '. | map(@sh) | join(" ")' "$NODE_PACKAGES_FILE" 2>/dev/null || echo "")
fi

# Shared pip install. Used by both single-language Python runs and by the
# polyglot bucket. Caller passes `$1`: the @sh-escaped argv string to install.
# Install target / PYTHONPATH already wired via env at the top of this script;
# user code (any language step) can also call `pip install foo` inline and it
# lands in the same place.
install_python() {
  if [ -n "$1" ]; then
    # `uv pip install` refuses to touch system site-packages without --target
    # or --system (PIP_TARGET env is a regular-pip thing it doesn't read), so
    # the flag is explicit. Inline `python -m pip install foo` from user code
    # picks up PIP_TARGET via the env export above — both paths land in the
    # same dir.
    #
    # Install stdout flows through to the container stdout so the spawner can
    # surface progress live; stderr is captured to a file and tailed back on
    # failure (exit 64). Do NOT redirect stderr to /dev/null — that would
    # hide the only diagnostic on a broken install.
    eval "uv pip install --target $PIP_TARGET --no-progress $1" \
      2> /user/.runtime/install-stderr.log \
      || { tail -c 64000 /user/.runtime/install-stderr.log >&2; exit 64; }
  fi
}

# Shared npm install. Same contract as install_python. Uses `-g` so packages
# land at $NPM_CONFIG_PREFIX/lib/node_modules — which NODE_PATH points at —
# matching where inline `npm install -g <pkg>` from user code also lands.
install_node() {
  if [ -n "$1" ]; then
    eval "npm install -g --no-audit --no-fund --no-progress --loglevel=error $1" \
      2> /user/.runtime/install-stderr.log \
      || { tail -c 64000 /user/.runtime/install-stderr.log >&2; exit 64; }
  fi
}

run_python() {
  install_python "$PACKAGES_ARGV"
  echo "PHASE: running"
  exec python3 "$ENTRY_FILE"
}

run_node() {
  install_node "$PACKAGES_ARGV"
  echo "PHASE: running"
  exec node "$ENTRY_FILE"
}

run_bash() {
  # No upfront `packages`-param install phase for bash — scripts install on
  # demand via the same env every other language step inherits (PIP_TARGET,
  # NPM_CONFIG_PREFIX, etc.). Invocation is argv-only: `exec bash <path>` —
  # never `bash -c` or `eval`, so the validated entry path is not subject
  # to shell expansion.
  echo "PHASE: running"
  exec bash "$ENTRY_FILE"
}

run_polyglot() {
  # Polyglot mode: install both buckets when present, then exec the
  # spawner-generated Python dispatcher (which subprocesses python3 / node
  # per step). PYTHONPATH / NODE_PATH already exported at the top of the
  # script, so subprocesses inherit them.
  install_python "$PY_PACKAGES_ARGV"
  install_node "$NODE_PACKAGES_ARGV"
  echo "PHASE: running"
  exec python3 "$ENTRY_FILE"
}

case "$LANG_NAME" in
  python)   run_python ;;
  node)     run_node ;;
  bash)     run_bash ;;
  polyglot) run_polyglot ;;
  *)
    echo "sandbox-runtime: unknown language: $LANG_NAME" >&2
    exit 65
    ;;
esac
