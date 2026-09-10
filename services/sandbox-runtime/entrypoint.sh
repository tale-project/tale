#!/bin/sh
# services/sandbox-runtime/entrypoint.sh
#
# Entrypoint of the sandbox runtime image. Dispatches on the single positional
# arg the spawner passes and `exec`s the long-lived process, so container
# signals (SIGTERM on stop) reach it directly:
#
#   daemon          — a persistent SESSION container: brings up the workspace
#                     skeleton, optionally the inner dockerd (TALE_DIND=1), the
#                     transparent-egress redirect (TALE_TRANSPARENT_EGRESS=1), then
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
#   TALE_DIND / TALE_TRANSPARENT_EGRESS  -> feature signals
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

# Selected before dockerd starts from observed outer networking and the planned
# organization build bridge. Never trust inherited selected values for root networking.
TALE_DIND_INNER_POOL=""
TALE_DIND_INNER_BIP=""

# iptables/ip6tables live in /usr/sbin, which the image ENV PATH deliberately
# drops (keeps sbin tools off the agent PATH); call them by absolute path.
_IPTABLES=/usr/sbin/iptables
_IP6TABLES=/usr/sbin/ip6tables
# iproute2 `ip`, used by the SESSION transparent-egress path to add a default
# route (see _ensure_default_route). Also in /usr/sbin (dropped from PATH).
_IP=/usr/sbin/ip
_GETENT=/usr/bin/getent

# The organization bridge attaches after readiness, so the spawner supplies its
# inspected IPv4 subnets before startup. Legacy spawners already attached both
# outer interfaces; accept absent hints only when routes prove that topology.
# Python runs from the immutable image in isolated mode: workspace PATH and
# PYTHONPATH are user-controlled by the time this root helper runs.
select_inner_docker_pool() {
  if ! _inner_network="$(/usr/local/bin/python3 -I - "$_IP" "$_GETENT" "${TALE_BUILDKIT_NETWORK_SUBNETS:-}" "${TALE_BUILDKITD_ENDPOINT:-}" "${TALE_DIND_INNER_POOL_OVERRIDE:-}" <<'PY'
import ipaddress
import json
import os
import re
import selectors
import stat
import subprocess
import sys
import time
from urllib.parse import urlsplit


def command_output(arguments, label, deadline):
    if time.monotonic() >= deadline:
        raise TimeoutError(f"{label} timed out")
    with subprocess.Popen(
        arguments,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    ) as process:
        try:
            data = bytearray()
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not selector.select(remaining):
                        raise TimeoutError(f"{label} timed out")
                    chunk = os.read(process.stdout.fileno(), 65536)
                    if not chunk:
                        break
                    data.extend(chunk)
                    if len(data) > 1024 * 1024:
                        raise ValueError(f"{label} exceeds 1 MiB")
            if process.wait(timeout=max(0.01, deadline - time.monotonic())) != 0:
                raise ValueError(f"{label} command failed")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
    return data.decode("utf-8")


def inventory(binary, arguments, label, deadline, problems):
    try:
        records = json.loads(command_output([binary, "-j", "-4", *arguments], label, deadline))
        if not isinstance(records, list) or len(records) > 4096:
            raise ValueError("invalid list")
        return records
    except (TimeoutError, subprocess.TimeoutExpired):
        problems.append(f"{label} timed out")
        return []
    except (OSError, ValueError):
        problems.append(f"{label} unavailable or invalid")
        return []


def add_ip(value, occupied):
    if not isinstance(value, str):
        raise ValueError("invalid IP address")
    address = ipaddress.ip_address(value)
    if isinstance(address, ipaddress.IPv6Address):
        address = address.ipv4_mapped
    if address is not None:
        occupied.append(ipaddress.IPv4Network(f"{address}/32"))


def has_inner_docker_state():
    try:
        state = os.lstat("/var/lib/docker/network/files/local-kv.db")
        return stat.S_ISREG(state.st_mode) and state.st_uid == os.geteuid() and state.st_mode & 0o022 == 0 and state.st_size > 0
    except OSError:
        return False


def choose_pool():
    occupied, problems, outer_interfaces = [], [], set()
    configured = None
    if sys.argv[5]:
        try:
            configured = ipaddress.IPv4Network(sys.argv[5])
            private_ranges = map(ipaddress.IPv4Network, ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
            if configured.prefixlen != 16 or not any(configured.subnet_of(private) for private in private_ranges):
                raise ValueError("not a private /16")
        except ValueError:
            raise ValueError("configured inner Docker pool must be a canonical RFC1918 /16") from None

    raw_hints = sys.argv[3]
    if raw_hints:
        hints = json.loads(raw_hints)
        if not isinstance(hints, list) or not 1 <= len(hints) <= 64:
            raise ValueError("invalid planned build-network subnet list")
        for hint in hints:
            if not isinstance(hint, str) or "/" not in hint:
                raise ValueError("invalid planned build-network subnet")
            occupied.append(ipaddress.IPv4Network(hint))

    # Pod routes can expose only a /32 and a link-local next hop. Interface
    # prefixes, resolver IPs and configured Service endpoints are independent
    # observations; none reveals the cluster's entire invisible Service CIDR.
    # All subprocess observations share one startup budget and bounded output.
    deadline = time.monotonic() + 5
    routes = inventory(sys.argv[1], ["route", "show", "table", "all"], "outer route inventory", deadline, problems)
    inner_bridges = {}
    retained_state = has_inner_docker_state()
    for interface in inventory(sys.argv[1], ["-d", "addr", "show"], "outer address inventory", deadline, problems):
        if not isinstance(interface, dict) or not isinstance(interface.get("addr_info"), list):
            problems.append("outer address inventory contains an invalid interface")
            continue
        name = interface.get("ifname")
        if isinstance(name, str) and re.fullmatch(r"eth[0-9]+", name):
            outer_interfaces.add(name)
        # K8s container restarts retain the Pod netns and Docker's bridges.
        # A name alone proves nothing: also require a Linux bridge and protected
        # inner-daemon state. Custom bridge names remain occupied; no workspace
        # marker or arbitrary bridge is accepted as evidence of Docker ownership.
        details = interface.get("linkinfo")
        inner = retained_state and isinstance(name, str) and re.fullmatch(r"docker0|br-[0-9a-f]{12}", name) and isinstance(details, dict) and details.get("info_kind") == "bridge"
        for address in interface["addr_info"]:
            try:
                if not isinstance(address, dict) or address.get("family") != "inet":
                    raise ValueError("invalid IPv4 address")
                local, prefix = address.get("local"), address.get("prefixlen")
                if not isinstance(local, str) or type(prefix) is not int or not 0 <= prefix <= 32:
                    raise ValueError("invalid IPv4 prefix")
                network = ipaddress.IPv4Interface(f"{local}/{prefix}").network
                if inner:
                    inner_bridges.setdefault(name, []).append(network)
                else:
                    occupied.append(network)
            except ValueError:
                problems.append("outer address inventory contains an invalid IPv4 prefix")

    for route in routes:
        if not isinstance(route, dict):
            problems.append("outer route inventory contains an invalid row")
            continue
        device = route.get("dev")
        if device is not None and not isinstance(device, str):
            problems.append("outer route inventory contains an invalid interface")
        if isinstance(device, str) and re.fullmatch(r"eth[0-9]+", device):
            outer_interfaces.add(device)
        try:
            destination = route.get("dst")
            if not isinstance(destination, str):
                raise ValueError("missing destination")
            if destination not in ("default", "0.0.0.0/0"):
                network = ipaddress.IPv4Network(destination)
                prefixes = inner_bridges.get(device, []) if isinstance(device, str) else []
                # Only the bridge's own kernel-connected/local routes can be
                # ignored. Static and unrelated routes remain real exclusions.
                if route.get("protocol") != "kernel" or not any(network.subnet_of(prefix) for prefix in prefixes):
                    occupied.append(network)
        except ValueError:
            problems.append("outer route inventory contains an invalid destination")
        # The default route is not itself an exclusion, but its next hop is.
        next_hops = route.get("nexthops", [])
        if not isinstance(next_hops, list):
            problems.append("outer route inventory contains invalid next hops")
            next_hops = []
        hops = [route, *next_hops]
        for hop in hops:
            try:
                if not isinstance(hop, dict):
                    raise ValueError("invalid next hop")
                if "gateway" in hop:
                    add_ip(hop["gateway"], occupied)
            except ValueError:
                problems.append("outer route inventory contains an invalid gateway")

    if not raw_hints and sys.argv[4] and len(outer_interfaces) < 2:
        raise ValueError("planned build-network subnets are required before delayed attachment")

    try:
        with open("/etc/resolv.conf", "rb") as resolver:
            data = resolver.read(65537)
        if len(data) > 65536:
            raise ValueError("resolver inventory exceeds 64 KiB")
        for line in data.decode("utf-8").splitlines():
            fields = line.split("#", 1)[0].split(";", 1)[0].split()
            if fields and fields[0] == "nameserver":
                try:
                    if len(fields) != 2:
                        raise ValueError("invalid nameserver")
                    add_ip(fields[1], occupied)
                except ValueError:
                    problems.append("resolver inventory contains an invalid nameserver")
    except (OSError, ValueError):
        problems.append("resolver inventory unavailable or invalid")

    resolved_hosts = set()
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "TALE_GATEWAY_URL"):
        value = os.environ.get(key)
        if not value:
            continue
        try:
            host = urlsplit(value).hostname
            if not host or len(host) > 253:
                raise ValueError("invalid endpoint host")
            if host in resolved_hosts:
                continue
            try:
                add_ip(host, occupied)
            except ValueError:
                output = command_output([sys.argv[2], "ahostsv4", host], f"{key} IPv4 resolution", deadline)
                lines = output.splitlines()
                if not lines or len(lines) > 4096:
                    raise ValueError("invalid resolved addresses")
                for line in lines:
                    fields = line.split()
                    if not fields:
                        continue
                    try:
                        add_ip(fields[0], occupied)
                    except ValueError:
                        problems.append(f"{key} IPv4 resolution contains an invalid address")
            resolved_hosts.add(host)
        except (OSError, ValueError, TimeoutError, subprocess.TimeoutExpired):
            problems.append(f"{key} IPv4 resolution unavailable or invalid")

    if configured:
        if any(configured.overlaps(outer) for outer in occupied):
            raise ValueError("configured inner Docker pool overlaps an observed outer network or endpoint")
        if problems:
            print("[entrypoint] WARN: using configured inner Docker pool with incomplete observations: " + "; ".join(dict.fromkeys(problems)), file=sys.stderr)
        return f"{configured} {configured.network_address + 1}/24"
    if problems:
        raise ValueError("; ".join(dict.fromkeys(problems)))

    candidates = ["172.31.0.0/16"]
    candidates.extend(f"172.{part}.0.0/16" for part in range(16, 31))
    candidates.extend(f"10.{part}.0.0/16" for part in range(256))
    candidates.append("192.168.0.0/16")
    for candidate in candidates:
        network = ipaddress.IPv4Network(candidate)
        if not any(network.overlaps(outer) for outer in occupied):
            return f"{network} {network.network_address + 1}/24"
    raise ValueError("no non-overlapping private /16 remains for inner Docker")


try:
    print(choose_pool())
except (OSError, ValueError, TimeoutError, subprocess.TimeoutExpired) as error:
    print(f"[entrypoint] FATAL: cannot select inner Docker network: {error}", file=sys.stderr)
    sys.exit(1)
PY
)"; then
    exit 1
  fi
  TALE_DIND_INNER_POOL="${_inner_network%% *}"
  TALE_DIND_INNER_BIP="${_inner_network#* }"
  export TALE_DIND_INNER_POOL TALE_DIND_INNER_BIP
  echo "[entrypoint] inner Docker network selected: ${TALE_DIND_INNER_POOL}"
}

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

  # Choose the pool before dockerd adds its own routes and firewall chains.
  select_inner_docker_pool

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
    --bip="${TALE_DIND_INNER_BIP}" \
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
      protect_shared_cache_network
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

# A cache-enabled session joins the shared control network and its org's
# private build network. dockerd enables IP forwarding, so deny unsolicited
# traffic entering any outer eth interface before it can route to the other
# network. Established replies to nested containers remain allowed by Docker's
# existing rules. The guard is required even when development egress filtering
# is disabled; an unguarded dual-homed session must never start runnerd.
protect_shared_cache_network() {
  [ -n "${TALE_BUILDKITD_ENDPOINT:-}" ] || return 0
  if ! "${_IPTABLES}" -I FORWARD 1 -i eth+ -m conntrack ! --ctstate ESTABLISHED,RELATED -j DROP; then
    echo "[entrypoint] FATAL: IPv4 build-cache network guard unavailable" >&2
    exit 1
  fi
  if "${_IP6TABLES}" -L FORWARD >/dev/null 2>&1; then
    if ! "${_IP6TABLES}" -I FORWARD 1 -i eth+ -m conntrack ! --ctstate ESTABLISHED,RELATED -j DROP; then
      echo "[entrypoint] FATAL: IPv6 build-cache network guard unavailable" >&2
      exit 1
    fi
  elif [ -d /proc/sys/net/ipv6 ]; then
    # Some IPv4-only Pod namespaces retain IPv6 loopback/link-local addresses.
    # With the already-granted NET_ADMIN, disable IPv6 if the namespace permits
    # it; do not add unsafe Pod sysctls or weaken the guard on read-only /proc.
    for _ipv6_setting in /proc/sys/net/ipv6/conf/default/disable_ipv6 /proc/sys/net/ipv6/conf/*/disable_ipv6; do
      if [ "$(cat "$_ipv6_setting" 2>/dev/null)" != "1" ]; then
        (printf '1\n' > "$_ipv6_setting") 2>/dev/null || true
      fi
    done
    # conf/all alone is not proof: a per-interface override may re-enable IPv6.
    # Check defaults (including future network attachments) and every interface.
    for _ipv6_setting in /proc/sys/net/ipv6/conf/default/disable_ipv6 /proc/sys/net/ipv6/conf/*/disable_ipv6; do
      if [ "$(cat "$_ipv6_setting" 2>/dev/null)" != "1" ]; then
        echo "[entrypoint] FATAL: IPv6 build-cache isolation cannot be verified; enable IPv6 netfilter or disable IPv6 for default and every interface in this container network namespace" >&2
        exit 1
      fi
    done
  fi
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
  # Workspace HOME can still contain the retired global `tale-shared` builder.
  # Select a builder keyed by the full validated endpoint; never adopt that
  # legacy definition, and explicitly fall back to the local daemon on failure.
  export BUILDX_BUILDER=default
  _builder=$(node -e 'const {createHash}=require("node:crypto"); process.stdout.write("tale-build-"+createHash("sha256").update(process.env.TALE_BUILDKITD_ENDPOINT).digest("hex").slice(0,24))')
  _bk() {
    setpriv --reuid 10001 --regid 10001 --init-groups -- \
      env HOME=/agent/.runtime/home docker buildx "$@"
  }
  if _bk inspect "${_builder}" >/dev/null 2>&1 ||
    _bk create --name "${_builder}" --driver remote "${TALE_BUILDKITD_ENDPOINT}" \
      >/var/log/buildx-create.log 2>&1; then
    export BUILDX_BUILDER="${_builder}"
    echo "[entrypoint] shared build cache enabled: BUILDX_BUILDER=${BUILDX_BUILDER} -> ${TALE_BUILDKITD_ENDPOINT}"
  else
    echo "[entrypoint] WARN: could not set up shared buildx builder (${TALE_BUILDKITD_ENDPOINT}); using the inner dockerd builder (cold cache)" >&2
    tail -n 3 /var/log/buildx-create.log >&2 2>/dev/null || true
  fi
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
  # Inline pip/npm installs land in the writable, on-PYTHONPATH/NODE_PATH
  # dependency directories shared by executions in this session.
  export HOME=/agent/.runtime/home
  # Exec temp on the workspace (disk-backed on both backends), NOT the /tmp
  # tmpfs: pip stages the ENTIRE resolved package set in $TMPDIR before copying
  # it to PIP_TARGET, and the tmpfs is small AND memory-backed (its pages are
  # charged to the container's memory cgroup) — on the default profile's 128 MB
  # /tmp any install set past ~128 MB died with ENOSPC (e.g. markitdown[pptx]'s
  # 223 MB). /tmp itself stays for small control files such as redsocks.conf.
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
  # Idempotent + best-effort; Tale's per-turn reconcile (backend
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
  # runnerd starts, so every client (including headless Chromium)
  # egresses through the proxy. The DinD path installs it after the inner dockerd
  # is up (below), so it's skipped here when DinD.
  if [ "${TALE_TRANSPARENT_EGRESS:-}" = "1" ] && [ "${TALE_DIND:-}" != "1" ]; then
    setup_session_transparent_egress
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
