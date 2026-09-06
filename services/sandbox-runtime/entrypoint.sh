#!/bin/sh
# services/sandbox-runtime/entrypoint.sh
#
# Entrypoint of the sandbox runtime image. Dispatches on the single positional
# arg the spawner passes and `exec`s the long-lived process, so container
# signals (SIGTERM on stop) reach it directly:
#
#   daemon          — a persistent SESSION container: brings up the workspace
#                     skeleton, optionally the inner dockerd (TALE_DIND=1), the
#                     transparent-egress redirect (TALE_TRANSPARENT_EGRESS=1)
#                     and the live browser view (TALE_BROWSER_CDP=1), then
#                     execs `tini -g -- node runnerd.mjs` (see
#                     services/sandbox/src/session/docker-session-args.ts and
#                     backend/kubernetes/k8s-session-pod-spec.ts).
#   egress-sidecar  — the K8s native sidecar: installs the OUTPUT REDIRECT into
#                     the shared pod netns as root, then runs redsocks.
#
# Anything else is a bad invocation and exits 65 — there is no per-call
# language lane any more (every sandbox run is a session; runnerd stages
# files, installs deps and runs commands over HTTP).
#
# Env (set by the spawner):
#   HTTPS_PROXY / HTTP_PROXY  -> http://sandbox-egress:3128
#   TALE_DIND / TALE_TRANSPARENT_EGRESS / TALE_BROWSER_CDP  -> feature signals
#   TALE_RUNNERD_TOKEN / TALE_SESSION_ENV  -> runnerd auth + seed env
#
# Conventions:
#   - The session workspace is /agent (host bind / PVC). HOME and the
#     per-session dependency roots live under /agent/.runtime/ so they survive
#     every exec and container restart within the session.
#   - Exec temp is /agent/.runtime/tmp (wiped at every container start).
#
# Exit codes:
#   65  = bad invocation (unknown dispatch arg)
#   otherwise the exec'd process's own exit status

set -e

# ---------------------------------------------------------------------------
# Docker-in-container (DinD) helpers — used only when the spawner launches the
# session with TALE_DIND=1 (a sysbox/kata tier with SANDBOX_DOCKER_IN_CONTAINER;
# nosemgrep: tools.opengrep.rules.trailofbits.generic.container-user-root.container-user-root -- intentional: documents the DinD-only `--user 0:0` start (drops to uid 10001 once dockerd is up); this is descriptive prose, not a container invocation
# see config.ts + session/session-profile.ts). The container then starts as root
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
# iproute2 `ip`, used by the SESSION transparent-egress path to add a default
# route (see _ensure_default_route). Also in /usr/sbin (dropped from PATH).
_IP=/usr/sbin/ip

# Dedicated low-priv uid redsocks runs as on the SESSION transparent-egress path,
# so the OUTPUT owner-match loop-breaker has a stable owner to exempt (see
# _install_session_output_redirect). Must match the `redsocks` user in the
# Dockerfile. The DinD inner path still launches redsocks as root (its loop is
# broken by the destination RETURNs instead) — that path is untouched.
TALE_REDSOCKS_UID="${TALE_REDSOCKS_UID:-10002}"
# redsocks config path for the session path. /tmp is the writable tmpfs even when
# the non-DinD session keeps a read-only root, so write it there (not /etc, which
# is read-only on that path).
TALE_REDSOCKS_CONF=/tmp/redsocks.conf
# Set once redsocks is launched (by either the DinD inner path or the session
# path) so the session path never double-launches it on a DinD session.
TALE_REDSOCKS_STARTED=""

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
  rm -f /agent/.runtime/home/.docker/config.json 2>/dev/null || true
  cat >/etc/redsocks.conf <<EOF
base { log_debug = off; log_info = off; log = "stderr"; daemon = off; redirector = iptables; }
redsocks { local_ip = 0.0.0.0; local_port = 12346; ip = ${TALE_EGRESS_IP}; port = ${TALE_EGRESS_PORT}; type = http-connect; }
EOF
  # redsocks lives in /usr/sbin, which the image PATH drops — call it absolute.
  /usr/sbin/redsocks -c /etc/redsocks.conf >/var/log/redsocks.log 2>&1 &
  TALE_REDSOCKS_STARTED=1
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

# ---------------------------------------------------------------------------
# SESSION transparent egress — the session container's OWN processes.
#
# The DinD machinery above only redirects NESTED containers (PREROUTING -s the
# inner pool). The session's own binaries (Node/undici, Go static binaries, raw
# sockets) generate traffic on the OUTPUT chain and reach egress today ONLY if
# they honor the HTTPS_PROXY env — which undici/Go/raw sockets do not. This adds
# an OUTPUT-chain REDIRECT into the SAME redsocks/REDSOCKS chain so any client
# egresses through the proxy transparently, with zero proxy-env awareness.
#
# Capability: installed by PID 1 root at boot, BEFORE the entrypoint setpriv-drops
# to the agent uid — so no user-exec'd process ever holds NET_ADMIN. Gated by the
# spawner (TALE_TRANSPARENT_EGRESS=1, off on gvisor where runsc's netstack makes
# the REDIRECT unreliable). Best-effort: a failure WARNs and continues (proxy-
# aware clients still egress via env), never wedges the session.
# ---------------------------------------------------------------------------

# Build the shared nat REDSOCKS chain if it doesn't already exist (the DinD inner
# path may have built it). Same policy as setup_inner_transparent_egress: leave
# internal / private / link-local DIRECT, tunnel everything public to redsocks.
# Idempotent and NON-destructive (never flushes an existing chain).
_ensure_redsocks_chain() {
  if "$_IPTABLES" -t nat -L REDSOCKS >/dev/null 2>&1; then
    return 0
  fi
  "$_IPTABLES" -t nat -N REDSOCKS
  for _cidr in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16; do
    "$_IPTABLES" -t nat -A REDSOCKS -d "$_cidr" -j RETURN
  done
  "$_IPTABLES" -t nat -A REDSOCKS -p tcp -j REDIRECT --to-ports 12346
}

# Write the redsocks config for the session path to $1.
_write_redsocks_conf() {
  cat >"$1" <<EOF
base { log_debug = off; log_info = off; log = "stderr"; daemon = off; redirector = iptables; }
redsocks { local_ip = 0.0.0.0; local_port = 12346; ip = ${TALE_EGRESS_IP}; port = ${TALE_EGRESS_PORT}; type = http-connect; }
EOF
}

# Hook the session's own locally-generated TCP (OUTPUT chain) into the redirect.
# OUTPUT has two loop hazards PREROUTING never had — redsocks' own upstream
# CONNECT to the proxy is locally-generated and would re-enter the chain:
#   (1) destination RETURN for the proxy IP — the reliable loop-breaker in every
#       case (covers redsocks running as root on the DinD path too). The existing
#       REDSOCKS RFC1918 RETURNs already cover a private proxy; this makes it
#       explicit for a public proxy too.
#   (2) owner-match RETURN for the redsocks uid — defense-in-depth when redsocks
#       runs as the dedicated uid (session path / k8s sidecar).
# All idempotent (-C guard) so a container restart re-applies cleanly.
_install_session_output_redirect() {
  "$_IPTABLES" -t nat -C REDSOCKS -d "${TALE_EGRESS_IP}" -p tcp -j RETURN 2>/dev/null \
    || "$_IPTABLES" -t nat -I REDSOCKS 1 -d "${TALE_EGRESS_IP}" -p tcp -j RETURN \
    || echo "[entrypoint] WARN: could not add egress-IP RETURN to REDSOCKS chain" >&2
  "$_IPTABLES" -t nat -C OUTPUT -p tcp -m owner --uid-owner "${TALE_REDSOCKS_UID}" -j RETURN 2>/dev/null \
    || "$_IPTABLES" -t nat -A OUTPUT -p tcp -m owner --uid-owner "${TALE_REDSOCKS_UID}" -j RETURN \
    || echo "[entrypoint] WARN: could not add redsocks owner-match RETURN to OUTPUT" >&2
  "$_IPTABLES" -t nat -C OUTPUT -p tcp -j REDSOCKS 2>/dev/null \
    || "$_IPTABLES" -t nat -A OUTPUT -p tcp -j REDSOCKS \
    || echo "[entrypoint] WARN: could not hook OUTPUT into the REDSOCKS chain" >&2
}

# Ensure a default route exists so the kernel will GENERATE connections to public
# IPs — the nat OUTPUT REDIRECT can only intercept a packet that routes. On the
# docker `--internal` network the session netns has NO default route, so
# connect() to a public IP fails with ENETUNREACH before REDIRECT ever runs.
# Point the default at the egress proxy IP (an on-link next-hop); REDIRECT
# rewrites the dst to redsocks before the packet leaves, so the egress host never
# actually receives it. Skipped when a default route already exists (e.g. a k8s
# pod's route to the CNI gateway) — REDIRECT works as-is there.
_ensure_default_route() {
  [ -n "${TALE_EGRESS_IP}" ] || return 0
  if "$_IP" route show default 2>/dev/null | grep -q .; then
    return 0
  fi
  if "$_IP" route add default via "${TALE_EGRESS_IP}" 2>/dev/null; then
    echo "[entrypoint] added default route via ${TALE_EGRESS_IP} (enables transparent-egress REDIRECT for public IPs)"
  else
    echo "[entrypoint] WARN: could not add default route via ${TALE_EGRESS_IP}; transparent egress to public IPs may fail (ENETUNREACH)" >&2
  fi
}

# External DNS for the session. Transparent IP-redirect needs the CLIENT to
# resolve hostnames to IPs locally (redsocks tunnels by the resolved IP), but on
# the docker `--internal` network Docker's embedded resolver (127.0.0.11) can't
# reach its upstream ExtServers (8.8.8.8 …) — external lookups time out. The
# egress sidecar's dnsmasq CAN resolve external names. DNAT the embedded
# resolver's FORWARDED queries (anything to :53 that isn't the embedded resolver
# itself) to the egress dnsmasq, so: Docker service names (sandbox-llm-gateway, convex) are
# still answered LOCALLY by 127.0.0.11 with their correct on-network IPs, while
# only external names get forwarded to the egress resolver. Gated on 127.0.0.11
# being the resolver — on k8s (kube-dns) external DNS already works and DNAT'ing
# it would break resolution, so this is a no-op there.
_install_session_dns_dnat() {
  grep -q 'nameserver 127.0.0.11' /etc/resolv.conf 2>/dev/null || return 0
  for _proto in udp tcp; do
    "$_IPTABLES" -t nat -C OUTPUT -p "$_proto" --dport 53 ! -d 127.0.0.11 -j DNAT --to-destination "${TALE_EGRESS_IP}:53" 2>/dev/null \
      || "$_IPTABLES" -t nat -A OUTPUT -p "$_proto" --dport 53 ! -d 127.0.0.11 -j DNAT --to-destination "${TALE_EGRESS_IP}:53" \
      || echo "[entrypoint] WARN: could not DNAT ${_proto}/53 to the egress resolver; external DNS may fail" >&2
  done
}

# Launch redsocks as the dedicated low-priv uid (for the owner-match), unless it
# is already running (the DinD inner path launched it as root). Background. Logs
# to /tmp (the writable tmpfs) — the non-DinD session keeps a read-only root, so
# /var/log (used by the DinD inner path, which has a writable rootfs) is not
# writable here.
_launch_session_redsocks() {
  [ "${TALE_REDSOCKS_STARTED:-}" = "1" ] && return 0
  _write_redsocks_conf "${TALE_REDSOCKS_CONF}"
  setpriv --reuid "${TALE_REDSOCKS_UID}" --regid "${TALE_REDSOCKS_UID}" --init-groups -- \
    /usr/sbin/redsocks -c "${TALE_REDSOCKS_CONF}" >/tmp/redsocks.log 2>&1 &
  TALE_REDSOCKS_STARTED=1
}

# Install transparent egress for the session's own processes (docker path). Runs
# as root in the daemon dispatch BEFORE the setpriv drop. Idempotent; safe to call
# on a DinD session after setup_inner_transparent_egress (it reuses the chain +
# redsocks and only adds the OUTPUT hook).
setup_session_transparent_egress() {
  resolve_egress_endpoint
  if [ -z "${TALE_EGRESS_IP}" ]; then
    echo "[entrypoint] WARN: no egress proxy IP resolved; session transparent egress disabled (proxy-aware clients still use HTTPS_PROXY)" >&2
    return 0
  fi
  # Best-effort: never let an iptables/redsocks hiccup abort session boot.
  set +e
  _ensure_redsocks_chain
  _install_session_output_redirect
  _ensure_default_route
  _install_session_dns_dnat
  _launch_session_redsocks
  set -e
  echo "[entrypoint] session transparent egress installed (OUTPUT -> redsocks -> ${TALE_EGRESS_IP}:${TALE_EGRESS_PORT}; public TCP tunneled, internal direct)"
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

# Wire the session to the shared buildkitd (set by the spawner via
# TALE_BUILDKITD_ENDPOINT when SANDBOX_DOCKER_BUILD_CACHE is on). Creates a
# remote buildx builder pointing at it and exports BUILDX_BUILDER, so the agent's
# `docker build` / `docker buildx build` / `docker compose up --build` run on the
# shared daemon and reuse its cross-session cache — with NO per-build flags.
#
# MUST run as the agent uid (10001) with the agent HOME so runnerd's execs (also
# uid 10001, same HOME) see the builder definition; root-owned buildx state would
# be invisible to them. The definition lives under the persistent workspace
# (~/.docker), so it survives resume — hence the inspect-first idempotency.
#
# Best-effort: any failure just leaves the agent on the inner dockerd's local
# builder (cold cache), never blocks the session. The remote `create` only
# registers an endpoint (it does not connect), so it can't hang on a slow daemon.
setup_shared_buildx_builder() {
  [ -n "${TALE_BUILDKITD_ENDPOINT:-}" ] || return 0
  _bk() {
    setpriv --reuid 10001 --regid 10001 --init-groups -- \
      env HOME=/agent/.runtime/home docker buildx "$@"
  }
  if _bk inspect tale-shared >/dev/null 2>&1 ||
    _bk create --name tale-shared --driver remote "${TALE_BUILDKITD_ENDPOINT}" \
      >/var/log/buildx-create.log 2>&1; then
    export BUILDX_BUILDER=tale-shared
    echo "[entrypoint] shared build cache enabled: BUILDX_BUILDER=tale-shared -> ${TALE_BUILDKITD_ENDPOINT}"
  else
    echo "[entrypoint] WARN: could not set up shared buildx builder (${TALE_BUILDKITD_ENDPOINT}); using the inner dockerd builder (cold cache)" >&2
    tail -n 3 /var/log/buildx-create.log >&2 2>/dev/null || true
  fi
}

# ---------------------------------------------------------------------------
# Live browser view (read-only mirror). Used only when the spawner launches the
# session with TALE_BROWSER_CDP=1 (operator flag SANDBOX_BROWSER_VIEW; see
# config.ts + session/session-profile.ts). Brings up ONE managed HEADED Chromium
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

# Persistent managed-Chromium profile, on the /agent bind/PVC so it survives
# turns, idle-stop+resume, and container restart — site logins are remembered
# across sessions (the old /tmp/cdp-profile was ephemeral tmpfs, wiped every
# restart). Hidden under .runtime like HOME so it stays out of the user-facing
# workspace file listing. The control dir (live pid + reset flag) is the channel
# runnerd uses to recycle a wedged browser; it lives on tmpfs (transient state).
TALE_BROWSER_PROFILE=/agent/.runtime/browser-profile
TALE_BROWSER_CTRL=/tmp/tale-browser

# Self-heal a persistent Chromium profile before each (re)launch. A stale
# SingletonLock/Socket/Cookie from an unclean exit makes every connectOverCDP
# attach hang; a "didn't shut down cleanly" flag pops a restore bubble that can
# block the attach. Clear the locks and mark the last session clean WITHOUT
# touching cookies/localStorage, so logins persist. Runs as the agent uid
# ($DROP) so the files stay agent-owned (the supervisor is root under DinD).
_browser_hygiene() {
  # shellcheck disable=SC2086
  $DROP rm -f \
    "$TALE_BROWSER_PROFILE/SingletonLock" \
    "$TALE_BROWSER_PROFILE/SingletonSocket" \
    "$TALE_BROWSER_PROFILE/SingletonCookie" 2>/dev/null || true
  _prefs="$TALE_BROWSER_PROFILE/Default/Preferences"
  [ -f "$_prefs" ] || return 0
  # NOTE: stderr is intentionally NOT redirected to /dev/null — a hygiene
  # failure must be visible. `|| true` keeps a node hiccup from aborting (set -e)
  # without hiding the diagnostic.
  # shellcheck disable=SC2086
  $DROP node -e '
    const fs = require("node:fs");
    const p = process.argv[1];
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      j.profile = j.profile || {};
      j.profile.exit_type = "Normal";
      j.profile.exited_cleanly = true;
      fs.writeFileSync(p, JSON.stringify(j));
    } catch (e) {
      // A corrupt/partially-written Preferences keeps popping the crash-restore
      // bubble (which blocks the CDP attach), so DROP it — Chromium regenerates
      // a clean one on launch. Cookies/localStorage live in separate files and
      // are untouched, so logins survive.
      process.stderr.write("[entrypoint] browser Preferences unreadable; resetting it (logins preserved): " + (e && e.message) + "\n");
      try { fs.rmSync(p); } catch (e2) {
        process.stderr.write("[entrypoint] could not remove corrupt Preferences: " + (e2 && e2.message) + "\n");
      }
    }
  ' "$_prefs" || true
}

# Supervise the managed Chromium with self-healing + a control channel runnerd
# uses to recycle a wedged-but-alive browser. Like _supervise (rate-limited
# restart loop), but each (re)launch: (1) honors a reset flag — runnerd's "Reset
# browser" wipes the profile while the browser is DOWN (atomic, no relaunch
# race; loses logins, by design); (2) clears the singleton lock + crash-restore
# state (_browser_hygiene, preserves logins); (3) records the live pid so
# runnerd can SIGKILL it to force a fresh, self-healed restart. $@ = chrome argv.
_browser_supervise() {
  (
    # CRITICAL: the script runs under `set -e`, but a supervisor loop MUST
    # survive its child exiting non-zero — `wait "$_bpid"` returns 137 when
    # runnerd SIGKILLs Chromium to recycle it, and the housekeeping rm/mkdir can
    # also fail benignly. Without this the loop would errexit on the first
    # recycle and never relaunch (the browser would stay dead). Disable errexit
    # for the loop; every command here is already best-effort guarded.
    set +e
    while true; do
      if [ -f "$TALE_BROWSER_CTRL/reset" ]; then
        # shellcheck disable=SC2086
        $DROP rm -rf "$TALE_BROWSER_PROFILE" 2>/dev/null || true
        rm -f "$TALE_BROWSER_CTRL/reset" 2>/dev/null || true
        # shellcheck disable=SC2086
        $DROP mkdir -p "$TALE_BROWSER_PROFILE" 2>/dev/null || true
      fi
      _browser_hygiene
      # shellcheck disable=SC2086
      $DROP "$@" &
      _bpid=$!
      # Record the live pid for runnerd's restart/reset. If the write fails,
      # REMOVE any stale pidfile rather than leaving an old pid the daemon might
      # SIGKILL by mistake (a wrong/reused process); runnerd then reads "no pid"
      # and treats the browser as uncontrollable this cycle (logged) instead.
      if ! echo "$_bpid" >"$TALE_BROWSER_CTRL/pid" 2>/dev/null; then
        rm -f "$TALE_BROWSER_CTRL/pid" 2>/dev/null || true
        echo "[entrypoint] WARN: browser pidfile write failed; runnerd restart/reset disabled this cycle" >&2
      fi
      wait "$_bpid"
      sleep 1
    done
  ) &
}

start_browser_stack() {
  echo "[entrypoint] starting live browser view (TALE_BROWSER_CDP=1)"

  # Profile (persistent, agent-owned). Created as the agent uid so Chromium
  # (uid 10001) owns its own profile even under DinD (root supervisor).
  # shellcheck disable=SC2086
  $DROP mkdir -p "$TALE_BROWSER_PROFILE" 2>/dev/null || true
  # Control dir (tmpfs): the pid file is written by the supervisor (ROOT under
  # DinD) and the reset flag by runnerd (uid 10001). Make it 1777 (sticky,
  # world-writable — same as /tmp/.X11-unix below) so both can create their file
  # and read the other's regardless of who owns the dir, even under a strict
  # umask. Single-tenant container, so world-writable here is not a leak.
  # shellcheck disable=SC2086
  $DROP mkdir -p "$TALE_BROWSER_CTRL" 2>/dev/null || true
  # shellcheck disable=SC2086
  $DROP chmod 1777 "$TALE_BROWSER_CTRL" 2>/dev/null || true

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
  # 800 tall (not 720) leaves room for Chromium's own toolbar+tab strip (~72px)
  # so the page viewport the agent renders into stays ~720 once the browser chrome
  # is shown (see --window-size below; we no longer run fullscreen/kiosk).
  _supervise $DROP Xvfb :99 -screen 0 1280x800x24 -nolisten tcp -ac
  export DISPLAY=:99

  # Read-only mirror on :5900 — the DEFAULT path every watcher gets. -localhost
  # binds 127.0.0.1 only, -viewonly drops all X input from the VNC side. -nopw is
  # acceptable because the port is loopback-only inside an isolated container.
  # shellcheck disable=SC2086
  _supervise $DROP x11vnc -display :99 -rfbport 5900 -localhost -viewonly \
    -forever -shared -nopw -noxdamage

  # Writable control path on :5901 — same X display, NO -viewonly, so RFB
  # pointer/keyboard events reach the real X input. This port is reached ONLY
  # when a human-control grant is active: the runnerd tunnel dials 5901 instead
  # of 5900 for a `?control=1` upgrade (which the platform oracle authorizes +
  # leases to a single holder). Keeping the read-only :5900 as a separate
  # process means watchers retain a structural read-only guarantee — there is no
  # flag a watcher's client can flip to gain input. Same display ⇒ a human's
  # clicks here and the agent's CDP drive both land on the one Chromium.
  #
  # -xkb is REQUIRED for correct keysym entry: without it x11vnc falls back to
  # legacy modtweak, which can't synthesize shifted-symbol keysyms (_, +, @, #,
  # {, }, |, etc.) against a modern XKB keymap and mangles them (e.g. `_` lands
  # as a space). The XKEYBOARD path maps each keysym to the right keycode+level.
  # Only the writable :5901 injects input, so :5900 (-viewonly) doesn't need it.
  # shellcheck disable=SC2086
  _supervise $DROP x11vnc -display :99 -rfbport 5901 -localhost \
    -forever -shared -nopw -noxdamage -xkb

  # Headed Chromium with a CDP endpoint on loopback. The proxy bridge mirrors
  # the tale-playwright-mcp shim (Chromium ignores HTTPS_PROXY/NO_PROXY env):
  # forward the egress proxy + bypass list as flags so the managed browser has
  # the same egress posture the self-launched one would.
  #
  # We deliberately do NOT run fullscreen/kiosk: a human taking control needs the
  # browser's own menu bar (omnibox + back/forward/reload) to navigate, so we show
  # the native chrome and size the window to fill the display (no WM runs here, so
  # --window-size + --window-position place it). The toolbar also surfaces the
  # current URL to read-only watchers for free.
  set -- "${CHROME_BIN}" \
    --remote-debugging-port=9222 \
    --remote-debugging-address=127.0.0.1 \
    --user-data-dir="${TALE_BROWSER_PROFILE}" \
    --no-sandbox \
    --disable-gpu \
    --window-position=0,0 \
    --window-size=1280,800 \
    --ignore-certificate-errors \
    --test-type \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --hide-crash-restore-bubble \
    --no-first-run \
    --no-default-browser-check
  [ -n "${HTTPS_PROXY:-}" ] && set -- "$@" --proxy-server="${HTTPS_PROXY}"
  [ -n "${NO_PROXY:-}" ] && set -- "$@" --proxy-bypass-list="${NO_PROXY}"
  # Self-healing supervisor (lock hygiene + restart/reset control), not the
  # blind _supervise — a persistent profile must never wedge on a stale lock,
  # and runnerd must be able to recycle a hung-but-alive browser.
  _browser_supervise "$@"

  # Wait for Chromium's CDP HTTP server to come up — a "process launched" signal,
  # NOT a health authority: /json/version answers even when the browser is wedged
  # and no CDP *session* can attach. runnerd's pre-flight probe does the real
  # liveness check (a CDP round-trip) and recycles the browser before each exec.
  # Fail-open: a failed curl must NOT abort the script (set -e) — the loop
  # swallows it and the timeout path only WARNs.
  _i=0
  while [ "$_i" -lt 30 ]; do
    if curl -fsS "http://127.0.0.1:9222/json/version" >/dev/null 2>&1; then
      echo "[entrypoint] live browser view ready (CDP 127.0.0.1:9222, VNC 127.0.0.1:5900, view-only; profile ${TALE_BROWSER_PROFILE})"
      return 0
    fi
    _i=$((_i + 1))
    sleep 0.5
  done
  echo "[entrypoint] WARN: headed Chromium CDP not ready within ~15s; continuing (runnerd starts; its pre-flight probe will recycle/attach)" >&2
  return 0
}

# ---------------------------------------------------------------------------
# K8s transparent-egress native sidecar. The session Pod runs a sidecar
# container (an initContainer with restartPolicy: Always — K8s 1.28+) with this
# arg + NET_ADMIN. It installs the OUTPUT REDIRECT into the SHARED pod netns as
# root, then drops to the redsocks uid and runs redsocks in the foreground for
# the pod's lifetime. The `runner` container stays fully hardened and never holds
# NET_ADMIN. On docker this is all done inline in the `daemon` dispatch instead.
# ---------------------------------------------------------------------------
if [ "$1" = "egress-sidecar" ]; then
  resolve_egress_endpoint
  if [ -z "${TALE_EGRESS_IP}" ]; then
    echo "[entrypoint] WARN: egress-sidecar could not resolve the egress proxy endpoint; transparent egress disabled (proxy-aware clients still use HTTPS_PROXY). Idling so the runner can still start." >&2
    exec sleep infinity
  fi
  # Best-effort install — never crashloop the sidecar (and so block the runner)
  # on an iptables hiccup; proxy-aware clients still egress via the env.
  set +e
  _ensure_redsocks_chain
  _install_session_output_redirect
  _ensure_default_route
  _install_session_dns_dnat
  set -e
  echo "[entrypoint] egress-sidecar: OUTPUT REDIRECT installed (-> redsocks -> ${TALE_EGRESS_IP}:${TALE_EGRESS_PORT})"
  _write_redsocks_conf "${TALE_REDSOCKS_CONF}"
  # redsocks is the sidecar's main process; run it as the dedicated uid (matches
  # the OUTPUT owner-match RETURN) in the foreground.
  exec setpriv --reuid "${TALE_REDSOCKS_UID}" --regid "${TALE_REDSOCKS_UID}" --init-groups -- \
    /usr/sbin/redsocks -c "${TALE_REDSOCKS_CONF}"
fi

# ---------------------------------------------------------------------------
# Session daemon dispatch (sessions plan). The spawner launches a long-lived
# session container with a single positional arg `daemon` (see
# session/docker-session-args.ts + the K8s pod spec); any other arg fails
# closed at the tail of this file. PID 1 of a session container is tini,
# exec'd here with runnerd as its only child — on EVERY path (plain,
# transparent-egress, DinD). A long-lived container needs a real init: every
# cancelled/timed-out exec tree and every SIGKILLed Chromium recycle leaves
# orphans that reparent to PID 1, and node never wait()s children it did not
# spawn, so as PID 1 it would let them pile up as zombies against pids-limit
# until fork() fails. `tini -g` forwards container-stop SIGTERM to runnerd's
# process group, so graceful shutdown is unchanged.
# ---------------------------------------------------------------------------
if [ "$1" = "daemon" ]; then
  # Both DinD and transparent egress boot the container as root (DinD to run the
  # inner dockerd; transparent egress so the entrypoint can install the iptables
  # OUTPUT REDIRECT). In either case the workspace skeleton + steer cleanup must
  # run AS the agent uid — otherwise the dirs would be root-owned and runnerd
  # couldn't write them. On the plain hardened path the container is already at
  # --user, DROP is empty, and these run directly, exactly as before. DinD always
  # drops to 10001 (the agent profile); transparent egress drops to the profile
  # uid the spawner pinned (agent 10001 / default 65534) via TALE_DROP_UID/GID.
  DROP=""
  if [ "${TALE_DIND:-}" = "1" ]; then
    DROP="setpriv --reuid 10001 --regid 10001 --init-groups --"
  elif [ "${TALE_TRANSPARENT_EGRESS:-}" = "1" ]; then
    DROP="setpriv --reuid ${TALE_DROP_UID:-10001} --regid ${TALE_DROP_GID:-10001} --init-groups --"
  fi

  # Bootstrap the persistent workspace skeleton. HOME lives here so agent
  # state (~/.claude, ~/.config/opencode, ~/.gitconfig) survives every exec
  # and container restart within the session. Idempotent — the dirs already
  # exist on a container restart against the same workspace volume.
  # Exec temp (TMPDIR below) is wiped like the steer queue: no exec is live at
  # a container (re)start, so anything left there is garbage from a previous
  # incarnation — this keeps the old /tmp lifecycle (temp died with the
  # container) now that the dir persists on the workspace.
  $DROP rm -rf /agent/.runtime/tmp
  $DROP mkdir -p \
    /agent/workspace \
    /agent/uploads \
    /agent/output \
    /agent/.runtime/home \
    /agent/.runtime/tmp \
    /agent/.runtime/deps/python \
    /agent/.runtime/deps/node
  # Stale per-exec steer queues (mid-turn message injection): a container
  # (re)start means no exec is live, so leftover steer/consumed files are
  # garbage from a previous incarnation — drop them. The platform re-queues
  # anything it hadn't reconciled.
  $DROP rm -rf /agent/.runtime/tale/steer
  # Same install env the one-shot path exports, so inline pip/npm from a
  # session exec lands in the writable, on-PYTHONPATH/NODE_PATH location.
  export HOME=/agent/.runtime/home
  # Exec temp on the workspace (disk-backed on both backends), NOT the /tmp
  # tmpfs: pip stages the ENTIRE resolved package set in $TMPDIR before copying
  # it to PIP_TARGET, and the tmpfs is small AND memory-backed (its pages are
  # charged to the container's memory cgroup) — on the default profile's 128 MB
  # /tmp any install set past ~128 MB died with ENOSPC (e.g. markitdown[pptx]'s
  # 223 MB). /tmp itself stays for small control files (redsocks.conf, X11).
  export TMPDIR=/agent/.runtime/tmp
  export PIP_TARGET=/agent/.runtime/deps/python
  export PYTHONPATH=/agent/.runtime/deps/python${PYTHONPATH:+:$PYTHONPATH}
  export PIP_DISABLE_PIP_VERSION_CHECK=1
  export NPM_CONFIG_PREFIX=/agent/.runtime/deps/node
  export NODE_PATH=/agent/.runtime/deps/node/lib/node_modules
  export PATH=/agent/.runtime/deps/python/bin:/agent/.runtime/deps/node/bin:$PATH

  # Built-in skills baked into the image (/opt/agents/skills/<name>) — symlink
  # each into the agent's user-level skill dir so Claude Code / Codex discover
  # them as native skills, runnable in place (their deps live in the baked dir).
  # Idempotent + best-effort; Tale's per-turn reconcile (convex
  # connector_skills.ts) drops any the workspace repo also defines so the
  # repo's project-level skill wins. An unmatched glob stays literal in sh, so
  # the `-d` guard skips it when nothing is baked.
  if [ -d /opt/agents/skills ]; then
    $DROP mkdir -p /agent/.runtime/home/.claude/skills
    for _skill in /opt/agents/skills/*/; do
      [ -d "$_skill" ] || continue
      $DROP ln -sfn "${_skill%/}" \
        "/agent/.runtime/home/.claude/skills/$(basename "$_skill")"
    done
  fi

  # Transparent egress (non-DinD): install the OUTPUT REDIRECT as root BEFORE the
  # browser + runnerd start, so every client (and Chromium's direct connections)
  # egresses through the proxy. The DinD path installs it after the inner dockerd
  # is up (below), so it's skipped here when DinD.
  if [ "${TALE_TRANSPARENT_EGRESS:-}" = "1" ] && [ "${TALE_DIND:-}" != "1" ]; then
    setup_session_transparent_egress
  fi

  # Live browser view (operator flag): bring up the headed Chromium + Xvfb +
  # x11vnc mirror BEFORE handing off to runnerd, so Playwright MCP can attach to
  # the CDP endpoint on the first browser tool call. In DinD mode the supervisor
  # loops run as uid 10001 via $DROP (set above); on the default path the
  # container is already uid 10001 and $DROP is empty. Fail-open inside.
  if [ "${TALE_BROWSER_CDP:-}" = "1" ]; then
    start_browser_stack
  fi

  # DinD: bring up the inner dockerd as root, then hand off under tini like
  # every session path (here it also reaps the many short-lived shims native
  # docker spawns); the already-backgrounded dockerd reparents to tini. setpriv
  # drops to the agent user so Claude Code's bypassPermissions (refused as
  # root) still works.
  if [ "${TALE_DIND:-}" = "1" ]; then
    start_inner_dockerd
    # Also redirect the session's OWN processes (not just nested containers) when
    # transparent egress is on — reuses the redsocks + chain dockerd's setup left.
    [ "${TALE_TRANSPARENT_EGRESS:-}" = "1" ] && setup_session_transparent_egress
    # Point builds at the shared buildkitd (exports BUILDX_BUILDER for runnerd) —
    # no-op + byte-identical when TALE_BUILDKITD_ENDPOINT is unset.
    setup_shared_buildx_builder
    exec tini -g -- \
      setpriv --reuid 10001 --regid 10001 --init-groups -- \
      node /usr/local/lib/tale/runnerd.mjs
  fi

  # Non-DinD paths — same reaper. With transparent egress the container booted
  # as root to install the OUTPUT REDIRECT, so setpriv drops to the profile uid
  # for runnerd (tini itself stays root, exactly as on the DinD path: it only
  # reaps and forwards signals). Without transparent egress the container is
  # already at its --user, so tini runs unprivileged too.
  if [ "${TALE_TRANSPARENT_EGRESS:-}" = "1" ]; then
    exec tini -g -- \
      setpriv --reuid "${TALE_DROP_UID:-10001}" --regid "${TALE_DROP_GID:-10001}" --init-groups -- \
      node /usr/local/lib/tale/runnerd.mjs
  fi
  exec tini -g -- node /usr/local/lib/tale/runnerd.mjs
fi

# ---------------------------------------------------------------------------
# Fail closed. Every sandbox run is a session (`daemon`) or its K8s egress
# sidecar; the former per-call language lane (python/node/bash/polyglot with a
# packages.json + entry path) has no producer any more and is gone. Falling
# through to an install/run of whatever argv arrived would be a dead end at
# best and a foothold at worst.
# ---------------------------------------------------------------------------
echo "sandbox-runtime: unknown dispatch arg: ${1:-<none>} (expected 'daemon' or 'egress-sidecar')" >&2
exit 65
