#!/bin/sh
# services/sandbox-runtime/entrypoint.sh
#
# Per-call entrypoint inside an ephemeral sandbox container.
#
# Args (from spawner's docker run):
#   $1 = language ('python' | 'node' | 'bash' | 'polyglot')
#   $2 = path to packages.json (JSON array of pip/npm specs).
#        Polyglot mode IGNORES this file and reads
#        /workspace/code/packages-python.json + /workspace/code/packages-node.json
#        instead (either may be missing or empty).
#   $3 = path to options.json   (currently unused — kept for wire-shape stability)
#   $4 = entry path: either a relative POSIX path resolved under
#        /workspace/code/, or an absolute path under /workspace/code/ or
#        /workspace/.tale/ (the latter is the spawner-generated multi-step
#        wrapper). Anything else exits 65.
#
# Env (set by spawner via --env):
#   HTTPS_PROXY / HTTP_PROXY  -> http://sandbox-egress:3128
#   PIP_CACHE_DIR             -> /cache/pip (per-org named volume)
#   NPM_CONFIG_CACHE          -> /cache/npm
#
# Conventions:
#   - User code at /workspace/code/<path> — staged 1:1 from the spawner's
#     `files[]`. The runtime exec()s the file at $4; no synthetic mirror.
#   - Multi-step wrapper (when used) at /workspace/.tale/runner.{py,js} —
#     dotfile segment is unreachable from user-supplied paths, so user files
#     can be named anything (including main.py).
#   - Output files in /workspace/output/
#   - install-stderr.log at /workspace/install-stderr.log — captured stderr
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
# kept OUT of the egress proxy via noProxy (see write_dind_docker_config).
TALE_DIND_INNER_POOL="172.31.0.0/16"

# iptables/ip6tables live in /usr/sbin, which the image ENV PATH deliberately
# drops (keeps sbin tools off the agent PATH); call them by absolute path.
_IPTABLES=/usr/sbin/iptables
_IP6TABLES=/usr/sbin/ip6tables

# Make nested `docker build` / `docker run` use the sandbox egress proxy. Inner
# build RUN steps (apt/pip) and inner containers do NOT inherit the session's
# proxy env, and the --internal network gives them no direct DNS — so without
# this they can't reach the (otherwise open) internet, and `docker compose up
# --build` fails on apt/pip. Writing the agent's docker client `proxies` makes
# the CLI auto-inject HTTP(S)_PROXY into every build step + container. noProxy
# keeps loopback, the inner pool, and the internal gateways (bifrost/convex)
# direct so service-to-service and the LLM gateway aren't routed through tinyproxy.
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

write_dind_docker_config() {
  _cfgdir=/workspace/.home/.docker
  mkdir -p "$_cfgdir"
  _http="$(_proxy_to_ip "${HTTP_PROXY:-}")"
  _https="$(_proxy_to_ip "${HTTPS_PROXY:-}")"
  cat >"$_cfgdir/config.json" <<EOF
{ "proxies": { "default": {
  "httpProxy": "${_http}",
  "httpsProxy": "${_https}",
  "noProxy": "${NO_PROXY:-localhost,127.0.0.1},::1,${TALE_DIND_INNER_POOL}"
} } }
EOF
  chown -R 10001:10001 "$_cfgdir" 2>/dev/null || true
}

# Block inner containers from the cloud metadata endpoint (IMDS) + link-local —
# never legitimate; cheap defense-in-depth. Installed in DOCKER-USER, which
# Docker evaluates BEFORE its own per-bridge ACCEPT rules, so it actually takes
# effect (a plain FORWARD append is shadowed by Docker's rules and does nothing).
# Must run AFTER dockerd starts (dockerd creates the DOCKER-USER chain). Egress
# is otherwise OPEN: inner containers reach the internet through the egress proxy
# (write_dind_docker_config). Broader internal lockdown (RFC1918 / cross-tenant)
# is a follow-up tied to an egress allowlist and must exempt the proxy + pool.
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

  mkdir -p /var/lib/docker /var/log
  # dockerd (and the iptables/modprobe it shells out to) need /usr/sbin on PATH,
  # which the image ENV drops. Scope the widened PATH to dockerd only — runnerd
  # is exec'd later with the unmodified (sbin-free) agent PATH.
  PATH="/usr/sbin:/sbin:${PATH}" dockerd \
    --host=unix:///var/run/docker.sock \
    --data-root=/var/lib/docker \
    --bip=172.31.0.1/24 \
    --default-address-pool "base=${TALE_DIND_INNER_POOL},size=24" \
    --storage-driver=overlay2 \
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
      # DOCKER-USER exists now that dockerd is up — install the IMDS fence.
      apply_inner_egress_fence
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
    /workspace/repo \
    /workspace/uploads \
    /workspace/output \
    /workspace/.home \
    /workspace/.deps/python \
    /workspace/.deps/node \
    /workspace/.tmp
  # Stale per-exec steer queues (mid-turn message injection): a container
  # (re)start means no exec is live, so leftover steer/consumed files are
  # garbage from a previous incarnation — drop them. The platform re-queues
  # anything it hadn't reconciled.
  $DROP rm -rf /workspace/.tale/steer
  # Same install env the one-shot path exports, so inline pip/npm from a
  # session exec lands in the writable, on-PYTHONPATH/NODE_PATH location.
  export HOME=/workspace/.home
  export TMPDIR=/workspace/.tmp
  export PIP_TARGET=/workspace/.deps/python
  export PYTHONPATH=/workspace/.deps/python${PYTHONPATH:+:$PYTHONPATH}
  export PIP_DISABLE_PIP_VERSION_CHECK=1
  export NPM_CONFIG_PREFIX=/workspace/.deps/node
  export NODE_PATH=/workspace/.deps/node/lib/node_modules
  export PATH=/workspace/.deps/python/bin:/workspace/.deps/node/bin:$PATH

  # DinD: bring up the inner dockerd as root, then hand off. tini becomes PID 1
  # to reap the many short-lived shims native docker spawns (teardown is a
  # SIGKILL to PID 1, so runnerd no longer needs to be PID 1 itself); the
  # already-backgrounded dockerd reparents to tini. setpriv drops to the agent
  # user so Claude Code's bypassPermissions (refused as root) still works.
  if [ "${TALE_DIND:-}" = "1" ]; then
    write_dind_docker_config
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
PACKAGES_FILE="${2:-/workspace/code/packages.json}"
# $3 (options.json path) is reserved for future flags; currently unused.
ENTRY_ARG="${4:?sandbox-runtime: missing entry path (positional arg 4)}"

# Resolve entry path. Accept either an absolute path under one of the two
# allowed roots, or a relative path interpreted under /workspace/code/.
case "$ENTRY_ARG" in
  /workspace/.tale/*|/workspace/code/*)
    ENTRY_FILE="$ENTRY_ARG"
    ;;
  /*)
    echo "sandbox-runtime: entry path outside /workspace: $ENTRY_ARG" >&2
    exit 65
    ;;
  *)
    ENTRY_FILE="/workspace/code/$ENTRY_ARG"
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
# host and mounts it 1:1 at /workspace inside this container). The mkdir
# below is defensive — the bind-mount source already contains these dirs
# when the spawner is happy, but a malformed call should still see
# usable /workspace/output to write into. The `.deps/{python,node}` and
# `.home` dirs back the install env exports below, so any step (python,
# node, bash) can run `pip install` / `npm install` and have it land in
# a writable, on-PYTHONPATH/NODE_PATH location.
mkdir -p \
  /workspace/code \
  /workspace/input \
  /workspace/output \
  /workspace/.deps/python \
  /workspace/.deps/node \
  /workspace/.home \
  /workspace/.tmp

# Install env exported BEFORE language routing so every step language
# (python, node, bash) inherits the same writable paths. The container
# is the security boundary; install-time guards (--only-binary,
# --ignore-scripts) added nothing on top of cap-drop=ALL + read-only
# root + nobody user + proxied egress behind the IP-layer SSRF
# firewall, so they're gone.
export HOME=/workspace/.home
# /tmp is a 128 MB tmpfs; pip/npm unpack big dep trees (e.g. markitdown[pptx]
# pulls python-pptx + pdfminer + magika) and blow it out with ENOSPC. Park the
# temp dir on the bind-mounted workspace where there's real disk.
export TMPDIR=/workspace/.tmp
export PIP_TARGET=/workspace/.deps/python
export PYTHONPATH=/workspace/.deps/python${PYTHONPATH:+:$PYTHONPATH}
export PIP_DISABLE_PIP_VERSION_CHECK=1
export NPM_CONFIG_PREFIX=/workspace/.deps/node
export NODE_PATH=/workspace/.deps/node/lib/node_modules
# Console scripts from both ecosystems on PATH: pip --target installs
# entry-point shims into $PIP_TARGET/bin, npm -g installs into
# $NPM_CONFIG_PREFIX/bin. Put them ahead of system bins so installed
# tools (markitdown, prettier, etc.) resolve directly.
export PATH=/workspace/.deps/python/bin:/workspace/.deps/node/bin:$PATH

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
PY_PACKAGES_FILE="/workspace/code/packages-python.json"
NODE_PACKAGES_FILE="/workspace/code/packages-node.json"
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
      2> /workspace/install-stderr.log \
      || { tail -c 64000 /workspace/install-stderr.log >&2; exit 64; }
  fi
}

# Shared npm install. Same contract as install_python. Uses `-g` so packages
# land at $NPM_CONFIG_PREFIX/lib/node_modules — which NODE_PATH points at —
# matching where inline `npm install -g <pkg>` from user code also lands.
install_node() {
  if [ -n "$1" ]; then
    eval "npm install -g --no-audit --no-fund --no-progress --loglevel=error $1" \
      2> /workspace/install-stderr.log \
      || { tail -c 64000 /workspace/install-stderr.log >&2; exit 64; }
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
