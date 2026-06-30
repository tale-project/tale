#!/bin/sh
# services/sandbox-buildkitd/docker-entrypoint.sh
#
# Container-level bootstrap for the shared sandbox buildkitd. Installs the
# transparent-egress redirect so that build RUN steps — which run in THIS
# container's network namespace under `--oci-worker-net=host` — reach the
# internet ONLY through the sandbox-egress proxy's SSRF/IMDS-fenced path, just
# like a sandbox session's nested containers. Then hands off to entrypoint.sh,
# which execs buildkitd.
#
# Split rationale (mirrors services/sandbox-egress): the iptables/redsocks setup
# is a container-level network boundary and belongs in the docker-entrypoint
# layer that runs first; the buildkitd launch is an `exec` and belongs in
# entrypoint.sh so signals reach the daemon directly.
#
# The redsocks machinery mirrors setup_session_transparent_egress +
# apply_inner_egress_fence in services/sandbox-runtime/entrypoint.sh. It is
# duplicated (not sourced) because this is a different, minimal image.

set -eu

# tale-sandbox-net is `--internal`: this container has NO direct egress. Its
# only outbound path is the dual-homed sandbox-egress proxy, reached by redsocks
# http-connect. Build RUN steps inherit this netns, so their apt/npm/pip traffic
# is transparently tunneled through the proxy (IMDS/RFC1918 stay fenced).

REDSOCKS_PORT=12346
# Dedicated uid redsocks runs as. The OUTPUT-path owner-match loop-breaker needs
# a stable non-root owner to exempt — running redsocks as root stalls on the
# OUTPUT redirect (root traffic can't be distinguished from build traffic, and
# the dest-RETURN alone isn't enough on OUTPUT). Mirrors the session's
# TALE_REDSOCKS_UID in services/sandbox-runtime/entrypoint.sh.
REDSOCKS_UID=10002
EGRESS_IP=""
EGRESS_PORT=""
# Marker the spawner (services/sandbox/src/buildkitd.ts) probes via
# `docker exec test -f` to decide whether a RUNNING daemon still has its egress
# fence. Removed at the start of every run; written only after egress is fully
# installed (or in TALE_SKIP_EGRESS dev mode). Absent on a running daemon ⇒ it
# restarted while sandbox-egress was unreachable and is serving builds with no
# internet → the spawner recreates it. Keep in sync with EGRESS_READY_MARKER.
EGRESS_READY=/run/tale-buildkitd-egress-ready
# Immutable base config baked into the image; the live --config is regenerated
# from it on EVERY start (init_base_config) so a writable-layer copy can never
# carry a stale dynamic [dns]/[registry] block — the daemon restarts
# independently (--restart unless-stopped) and sandbox-egress's IP can change.
BASE_TOML=/etc/buildkit/buildkitd.base.toml
LIVE_TOML=/etc/buildkit/buildkitd.toml

log() { echo "[sandbox-buildkitd] $*"; }

# Resolve the egress endpoint (IP + port) redsocks + [dns] use. Default path:
# resolve the `sandbox-egress` HTTP(S)_PROXY hostname via the embedded resolver
# (re-resolved on every start + retried by resolve_egress_retry, so a changed
# egress IP or a not-yet-up egress at boot self-corrects). TALE_EGRESS_IP is an
# optional override for topologies where the service name isn't resolvable here
# (e.g. resolv.conf bind-mounted to the egress dnsmasq); deliberately NOT a
# spawner-snapshotted IP, which would itself go stale across egress recreation.
resolve_egress() {
  url="${HTTP_PROXY:-${HTTPS_PROXY:-}}"
  [ -n "$url" ] || true
  hostport="${url#*://}"
  port="${hostport##*:}"
  port="${port%%/*}"
  case "$port" in '' | *[!0-9]*) port=3128 ;; esac
  EGRESS_PORT="$port"
  if [ -n "${TALE_EGRESS_IP:-}" ]; then
    EGRESS_IP="${TALE_EGRESS_IP}"
    return 0
  fi
  [ -n "$url" ] || return 0
  host="${hostport%%:*}"
  case "$host" in
    *[!0-9.]*) ip="$(getent hosts "$host" 2>/dev/null | awk 'NR==1{print $1}')" ;;
    *) ip="$host" ;;
  esac
  [ -n "${ip:-}" ] && EGRESS_IP="$ip"
}

# Bounded retry around resolve_egress. On a stack (re)start the daemon can come
# up a few seconds before sandbox-egress is resolvable; retry briefly instead of
# coming up permanently egress-less (the old silent failure mode — a daemon that
# missed the resolve at boot served builds with no internet until manual repair).
resolve_egress_retry() {
  _i=0
  while [ "$_i" -lt 30 ]; do
    resolve_egress
    [ -n "$EGRESS_IP" ] && return 0
    _i=$((_i + 1))
    sleep 1
  done
  return 1
}

# Materialize the live --config from the immutable base on EVERY start, so the
# writable-layer copy never inherits a previous start's dynamic block. Runs on
# both the egress and TALE_SKIP_EGRESS paths so buildkitd always has a config.
init_base_config() {
  [ -f "$BASE_TOML" ] || return 0
  cat "$BASE_TOML" >"$LIVE_TOML" 2>/dev/null \
    || log "WARN: could not materialize $LIVE_TOML from base; using existing config"
}

# Append the dynamic [registry] mirrors + [dns] block to the freshly-materialized
# base, pinning the [dns] nameserver to the CURRENT egress IP. Because
# init_base_config resets the file first, this is appended onto a clean base
# every start (no accumulation, no stale nameserver).
#
# buildkit's image PULLS go to the pull-through MIRROR by sibling name (the
# embedded resolver answers locally — no external-name SERVFAIL); RUN-step DNS is
# pinned to the egress dnsmasq via [dns] (else libnetwork strips the embedded
# 127.* and falls back to 8.8.8.8, unreachable on the internal net). The
# `http = true` block marks the plain-HTTP mirror and MUST be its own block.
append_dynamic_config() {
  {
    _ifs="$IFS"
    IFS=';'
    # shellcheck disable=SC2086 # intentional word-split on ';' (IFS set above)
    for _pair in ${TALE_BUILDKITD_MIRRORS:-}; do
      _reg="${_pair%%=*}"
      _ref="${_pair#*=}"
      [ -n "$_reg" ] && [ -n "$_ref" ] && [ "$_reg" != "$_pair" ] || continue
      printf '\n[registry."%s"]\n  mirrors = ["%s"]\n\n[registry."%s"]\n  http = true\n' \
        "$_reg" "$_ref" "$_ref"
    done
    IFS="$_ifs"
    printf '\n[dns]\n  nameservers = ["%s"]\n  options = ["single-request", "ndots:0"]\n' "${EGRESS_IP}"
  } >>"$LIVE_TOML" 2>/dev/null \
    || log "WARN: could not write registry/dns config to $LIVE_TOML; pulls may fail"
}

install_egress() {
  resolve_egress_retry || true
  if [ -z "$EGRESS_IP" ]; then
    log "WARN: no egress proxy resolved from HTTP(S)_PROXY after retries; builds will have NO internet (this container is on an --internal network). Set HTTPS_PROXY to the sandbox-egress proxy. Leaving the egress-ready marker absent so the spawner recreates this daemon on the next session."
    return 0
  fi

  # IMDS + link-local: REJECT outright (filter OUTPUT) — never a legit build
  # target, and a defense-in-depth backstop on top of the --internal network.
  iptables -I OUTPUT -d 169.254.0.0/16 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null \
    || log "WARN: could not install IMDS/link-local reject"

  # nat REDSOCKS chain: private / loopback / link-local stay DIRECT (so the
  # build can still reach the egress proxy itself + sibling services), public
  # TCP is tunneled through redsocks.
  iptables -t nat -N REDSOCKS 2>/dev/null || iptables -t nat -F REDSOCKS
  for cidr in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16; do
    iptables -t nat -A REDSOCKS -d "$cidr" -j RETURN
  done
  iptables -t nat -A REDSOCKS -p tcp -j REDIRECT --to-ports "$REDSOCKS_PORT"
  # Loop-breaker: redsocks' own upstream CONNECT to the proxy must not re-enter
  # the chain. The RFC1918 RETURNs above already cover a private proxy; make it
  # explicit so a non-RFC1918 proxy works too.
  iptables -t nat -I REDSOCKS 1 -d "$EGRESS_IP" -p tcp -j RETURN

  # Loop-breaker for the OUTPUT path: exempt redsocks' OWN upstream CONNECT to
  # the proxy (it runs as REDSOCKS_UID) from the redirect, BEFORE the REDSOCKS
  # hook. On the OUTPUT chain this owner-match is load-bearing (the dest-RETURN
  # inside the chain alone isn't sufficient here, unlike the inner PREROUTING
  # path). Mirrors _install_session_output_redirect in the runtime entrypoint.
  iptables -t nat -C OUTPUT -p tcp -m owner --uid-owner "$REDSOCKS_UID" -j RETURN 2>/dev/null \
    || iptables -t nat -A OUTPUT -p tcp -m owner --uid-owner "$REDSOCKS_UID" -j RETURN

  # Hook this container's own locally-generated TCP (which build RUN steps are,
  # under host worker net) into the redirect.
  iptables -t nat -C OUTPUT -p tcp -j REDSOCKS 2>/dev/null \
    || iptables -t nat -A OUTPUT -p tcp -j REDSOCKS

  # The `--internal` netns has no default route, so connect() to a public IP
  # fails ENETUNREACH before the nat REDIRECT can run. Point the default at the
  # egress proxy IP (an on-link next-hop); REDIRECT rewrites the dst to redsocks
  # before the packet leaves, so the egress host never receives it.
  if ! ip route show default 2>/dev/null | grep -q .; then
    ip route add default via "$EGRESS_IP" 2>/dev/null \
      && log "added default route via $EGRESS_IP" \
      || log "WARN: could not add default route via $EGRESS_IP; egress to public IPs may fail (ENETUNREACH)"
  fi

  # Regenerate the registry-mirror + [dns] config from the immutable base with
  # the CURRENT egress IP (UDP :53 to it is RFC1918 → left direct by the REDSOCKS
  # chain). Always rewritten so a restart can never inherit a stale nameserver.
  append_dynamic_config

  # Drop the proxy env: pulls go to the mirror (by name) and RUN steps resolve via
  # [dns], then both connect DIRECTLY to the IPs they resolve and the REDSOCKS
  # redirect tunnels them through the SSRF/IMDS-fenced egress proxy — one egress
  # path. (A set proxy made buildkit's auth-token fetch fall back to local DNS.)
  unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy

  # redsocks runs as REDSOCKS_UID (the OUTPUT owner-match exempts its upstream
  # CONNECT); backgrounded, tini (PID 1) reaps it if it dies. --clear-groups so
  # no passwd entry is needed; local_port 12346 is unprivileged.
  cat >/tmp/redsocks.conf <<EOF
base { log_debug = off; log_info = off; log = "stderr"; daemon = off; redirector = iptables; }
redsocks { local_ip = 0.0.0.0; local_port = ${REDSOCKS_PORT}; ip = ${EGRESS_IP}; port = ${EGRESS_PORT}; type = http-connect; }
EOF
  setpriv --reuid "$REDSOCKS_UID" --regid "$REDSOCKS_UID" --clear-groups -- \
    redsocks -c /tmp/redsocks.conf >/tmp/redsocks.log 2>&1 &

  # Signal the spawner that the fence is up (redsocks + default route + current-IP
  # [dns]). Written last, only on the success path; its absence on a running
  # daemon is what triggers spawner recreation.
  : >"$EGRESS_READY" 2>/dev/null \
    || log "WARN: could not write egress-ready marker ($EGRESS_READY)"
  log "transparent egress installed (OUTPUT -> redsocks -> ${EGRESS_IP}:${EGRESS_PORT}; public tunneled, private/IMDS fenced, DNS via egress :53)"
}

# Fresh start: drop any marker from a previous run BEFORE attempting install, so
# a stale marker (the writable layer survives `docker restart`) can never fool
# the spawner's health probe. Re-materialize the live config from the immutable
# base on every start (the daemon may have restarted with a stale dynamic block).
mkdir -p /run 2>/dev/null || true
rm -f "$EGRESS_READY" 2>/dev/null || true
init_base_config

if [ "${TALE_SKIP_EGRESS:-0}" = "1" ]; then
  log "WARN: TALE_SKIP_EGRESS=1 — transparent egress NOT installed (dev only; build RUN steps get this container's raw egress)"
  # Dev mode is 'configured as intended' — mark ready so the spawner doesn't
  # treat the (deliberately unfenced) daemon as broken and recreate-loop it.
  : >"$EGRESS_READY" 2>/dev/null || true
else
  # Best-effort: never let an iptables/redsocks hiccup stop the daemon from
  # serving cache to sessions (proxy-aware build args still work). A failure
  # leaves the marker absent, so the spawner recreates the daemon next session.
  set +e
  install_egress
  set -e
fi

exec /entrypoint.sh "$@"
