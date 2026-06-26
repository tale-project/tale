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

log() { echo "[sandbox-buildkitd] $*"; }

# Resolve the egress endpoint (IP + port) redsocks + [dns] use. The spawner
# passes the already-resolved on-network IP as TALE_EGRESS_IP (preferred — once
# our resolv.conf is bind-mounted to the egress dnsmasq, the dnsmasq can't answer
# the `sandbox-egress` docker service name, so we can't resolve it here). The
# HTTP(S)_PROXY-hostname fallback covers single-network dev where the embedded
# resolver still answers service names.
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

install_egress() {
  resolve_egress
  if [ -z "$EGRESS_IP" ]; then
    log "WARN: no egress proxy resolved from HTTP(S)_PROXY; builds will have NO internet (this container is on an --internal network). Set HTTPS_PROXY to the sandbox-egress proxy."
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

  # buildkit's image PULLS: point docker.io at the pull-through registry MIRROR
  # by its docker NAME (TALE_BUILDKITD_MIRROR, e.g. tale-buildkitd-mirror:5000).
  # buildkit resolves a SIBLING name via the embedded resolver locally (no
  # forward → no SERVFAIL, unlike external registry names which buildkit cannot
  # resolve on a user-defined net). The mirror itself reaches Docker Hub through
  # the egress proxy. The `http = true` block marks the plain-HTTP mirror — and
  # MUST be its own `[registry."<mirror>"]` block, not nested under docker.io.
  #
  # RUN-step DNS: the executor containers get a SEPARATE resolv.conf buildkit
  # generates; pin it to the egress dnsmasq via [dns] (else libnetwork strips the
  # embedded 127.* and falls back to 8.8.8.8, unreachable on the internal net).
  # UDP :53 to the egress IP is RFC1918 → left direct by the REDSOCKS chain.
  if grep -q '^\[dns\]' /etc/buildkit/buildkitd.toml 2>/dev/null; then
    log "WARN: buildkit registry/dns config already present; not appending"
  else
    {
      # One [registry."<reg>"] mirror block + its [registry."<ref>"] http block
      # per semicolon-separated `registry=mirror_ref` pair in TALE_BUILDKITD_MIRRORS.
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
    } >>/etc/buildkit/buildkitd.toml 2>/dev/null \
      || log "WARN: could not write registry/dns config to buildkitd.toml; pulls may fail"
  fi

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
  log "transparent egress installed (OUTPUT -> redsocks -> ${EGRESS_IP}:${EGRESS_PORT}; public tunneled, private/IMDS fenced, DNS via egress :53)"
}

if [ "${TALE_SKIP_EGRESS:-0}" = "1" ]; then
  log "WARN: TALE_SKIP_EGRESS=1 — transparent egress NOT installed (dev only; build RUN steps get this container's raw egress)"
else
  # Best-effort: never let an iptables/redsocks hiccup stop the daemon from
  # serving cache to sessions (proxy-aware build args still work).
  set +e
  install_egress
  set -e
fi

exec /entrypoint.sh "$@"
