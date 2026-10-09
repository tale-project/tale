#!/bin/sh
# services/sandbox-egress/docker-entrypoint.sh
#
# Container-level bootstrap for the sandbox egress proxy. Installs the
# IP-layer SSRF firewall (requires NET_ADMIN) and the per-session connection
# cap, then hands off to
# `entrypoint.sh` which renders the tinyproxy config and supervises the
# foreground proxy and DNS forwarder.
#
# Split rationale:
#   - The firewall touches kernel routing tables and is a container-level
#     security boundary. It belongs in the `docker-entrypoint.sh` layer
#     that conventionally runs first.
#   - Config rendering and process supervision belong in `entrypoint.sh`,
#     which forwards shutdown signals and reaps its children.

set -e

# ----------------------------------------------------------------------------
# SSRF firewall (defense-in-depth)
# ----------------------------------------------------------------------------
# Egress is open at the hostname layer by default (entrypoint.sh only
# renders a default-deny allowlist when SANDBOX_EGRESS_ALLOWLIST is set),
# so these IP-layer rules are the ONLY thing keeping tunnels away from
# 169.254.169.254 (cloud IMDS) and RFC1918 (corp VPN, host bridge). Even
# with an allowlist they stay load-bearing: the filter is a hostname regex
# applied AFTER the proxy resolves the target, and a short-TTL DNS rebind
# could flip resolution to a private IP between tinyproxy's lookup and the
# kernel connect(). Block those targets at the IP layer so the entire
# tunnel surface is fenced regardless of hostname.
#
# Mirrors services/platform/docker-entrypoint.sh install_ssrf_firewall(). Requires
# NET_ADMIN; cap_add: ['NET_ADMIN'] is set in compose.yml and the CLI
# compose generator. Missing tooling/capability refuses boot; only an explicit
# development opt-out skips the firewall.
SKIP_FIREWALL="${TALE_SKIP_SSRF_FIREWALL:-0}"

# Connections one client address may hold open to the proxy at once; read
# before anything is installed so a bad value refuses the start, as
# SANDBOX_EGRESS_MAX_CLIENTS does in entrypoint.sh. 0 turns the cap off.
SESSION_CONNECTIONS="${SANDBOX_EGRESS_MAX_CONNECTIONS_PER_SESSION:-256}"
case "$SESSION_CONNECTIONS" in
  '' | *[!0-9]* | 0?*)
    echo "[sandbox-egress] FATAL: SANDBOX_EGRESS_MAX_CONNECTIONS_PER_SESSION must be a whole number of connections, or 0 for no cap; got '${SESSION_CONNECTIONS}'"
    exit 1 ;;
esac
# connlimit counts in 32 bits: a larger value would be refused by iptables and
# read as a kernel without the match, starting the proxy with no cap at all.
if [ "${#SESSION_CONNECTIONS}" -gt 10 ] || [ "$SESSION_CONNECTIONS" -gt 4294967295 ]; then
  echo "[sandbox-egress] FATAL: SANDBOX_EGRESS_MAX_CONNECTIONS_PER_SESSION must be at most 4294967295 (0 turns the cap off); got '${SESSION_CONNECTIONS}'"
  exit 1
fi

install_dns_resolver_rules() {
  # Kubernetes resolvers are often private Service IPs. Keep that necessary
  # DNS traffic scoped to the configured literal addresses and UDP/TCP 53;
  # private HTTP/CONNECT destinations and forwarding remain denied. Read a
  # bounded snapshot and validate it before installing any exception. The final
  # marker preserves trailing newlines for the size check in POSIX shells.
  if ! _dns_config="$(head -c 65537 /etc/resolv.conf 2>/dev/null && printf '.')"; then
    echo "[sandbox-egress] FATAL: cannot read DNS resolver configuration; refusing to start"
    return 1
  fi
  _dns_config="${_dns_config%.}"
  if [ "${#_dns_config}" -gt 65536 ]; then
    echo "[sandbox-egress] FATAL: DNS resolver configuration exceeds 64 KiB; refusing to start"
    return 1
  fi
  if ! _dns_resolvers="$(printf '%s\n' "$_dns_config" | LC_ALL=C awk '
    function ipv4(address, parts, count, i) {
      count = split(address, parts, ".")
      if (count != 4) return 0
      for (i = 1; i <= 4; i++) {
        if (parts[i] !~ /^[0-9]+$/ || length(parts[i]) > 3 || parts[i] + 0 > 255) return 0
        if (length(parts[i]) > 1 && substr(parts[i], 1, 1) == "0") return 0
      }
      return 1
    }
    {
      sub(/[#;].*$/, "")
      if ($1 != "nameserver") next
      if (NF != 2) exit 1
      address = $2
      if (index(address, ":")) {
        if (length(address) > 45 || address ~ /[^0-9a-fA-F:.]/) exit 1
        family = 6
      } else {
        if (!ipv4(address)) exit 1
        family = 4
      }
      if (!seen[address]++) {
        if (++total > 64) exit 1
        print family, address
      }
    }
    END { if (!total) exit 1 }
  ')"; then
    echo "[sandbox-egress] FATAL: invalid DNS resolver configuration; expected at most 64 literal IP addresses; refusing to start"
    return 1
  fi
  printf '%s\n' "$_dns_resolvers" | while read -r _dns_family _dns_address; do
    if [ "$_dns_family" = "6" ]; then
      if [ "$IPV6_FIREWALL" != "1" ]; then
        echo "[sandbox-egress] FATAL: configured IPv6 DNS resolver requires IPv6 netfilter; refusing to start"
        exit 1
      fi
      _dns_firewall=ip6tables
      _dns_prefix=128
    else
      _dns_firewall=iptables
      _dns_prefix=32
    fi
    for _dns_protocol in udp tcp; do
      # ip6tables also validates the complete IPv6 syntax; the lexical check
      # above excludes hostnames, scoped names and user-provided CIDR masks.
      if ! "$_dns_firewall" -I OUTPUT -d "${_dns_address}/${_dns_prefix}" -p "$_dns_protocol" --dport 53 -j ACCEPT; then
        echo "[sandbox-egress] FATAL: DNS resolver allowance could not be installed; refusing to start"
        exit 1
      fi
    done
  done
}

if [ "$SKIP_FIREWALL" = "1" ]; then
  echo "[sandbox-egress] WARN: TALE_SKIP_SSRF_FIREWALL=1 — SSRF firewall explicitly skipped"
elif ! command -v iptables >/dev/null 2>&1; then
  # Fail-closed: iptables is part of the image, so a missing binary means
  # someone broke the build. Refuse to start rather than silently shipping
  # the runtime containers a wide-open egress path.
  echo "[sandbox-egress] FATAL: iptables binary missing; refusing to start without the SSRF firewall (set TALE_SKIP_SSRF_FIREWALL=1 to override for dev only)"
  exit 1
elif ! iptables -L OUTPUT >/dev/null 2>&1; then
  # Fail-closed: NET_ADMIN is what compose.yml + the CLI compose generator
  # grant; if it's not effective, the IP-layer defense is absent and —
  # since the hostname allowlist is opt-in — nothing stands between
  # runtime code and the cloud IMDS. Don't ship that silently.
  echo "[sandbox-egress] FATAL: NET_ADMIN unavailable; SSRF firewall cannot install (set TALE_SKIP_SSRF_FIREWALL=1 to override for dev only, or cap_add: [NET_ADMIN] in compose.yml)"
  exit 1
else
  # The proxy joins per-organization BuildKit networks as well as the sandbox
  # and outbound networks. It is an application proxy, never an IP router:
  # reject forwarded packets before any pre-existing ACCEPT rule, so a sandbox
  # cannot route through this container into another organization's cache.
  if ! iptables -I FORWARD 1 -j DROP; then
    echo "[sandbox-egress] FATAL: IPv4 forwarding guard unavailable; refusing to start"
    exit 1
  fi
  IPV6_FIREWALL=0
  if command -v ip6tables >/dev/null 2>&1 && ip6tables -L FORWARD >/dev/null 2>&1; then
    IPV6_FIREWALL=1
    if ! ip6tables -I FORWARD 1 -j DROP; then
      echo "[sandbox-egress] FATAL: IPv6 forwarding guard unavailable; refusing to start"
      exit 1
    fi
  elif [ -d /proc/sys/net/ipv6 ]; then
    # IPv4-only Pod namespaces may still carry IPv6 loopback/link-local. Use
    # the existing NET_ADMIN grant to disable that stack when /proc permits it.
    # Restricted OCI mounts may be read-only: only verified readback is safe,
    # and no cluster-wide unsafe-sysctl permission is assumed here.
    for _ipv6_setting in /proc/sys/net/ipv6/conf/default/disable_ipv6 /proc/sys/net/ipv6/conf/*/disable_ipv6; do
      if [ "$(cat "$_ipv6_setting" 2>/dev/null)" != "1" ]; then
        (printf '1\n' > "$_ipv6_setting") 2>/dev/null || true
      fi
    done
    # conf/all alone is not proof: a per-interface override may re-enable IPv6.
    # Check defaults (including future network attachments) and every interface.
    for _ipv6_setting in /proc/sys/net/ipv6/conf/default/disable_ipv6 /proc/sys/net/ipv6/conf/*/disable_ipv6; do
      if [ "$(cat "$_ipv6_setting" 2>/dev/null)" != "1" ]; then
        echo "[sandbox-egress] FATAL: IPv6 isolation cannot be verified; enable IPv6 netfilter or disable IPv6 for default and every interface in this container network namespace; refusing to start"
        exit 1
      fi
    done
  fi

  echo "[sandbox-egress] installing SSRF egress firewall (REJECT IMDS + link-local + RFC1918, v4 + v6)"
  # Cloud instance metadata service (AWS/GCP/Azure IMDSv1 footprint).
  iptables -I OUTPUT -d 169.254.169.254/32 -j REJECT --reject-with icmp-net-prohibited
  # All IPv4 link-local addresses, including metadata endpoints.
  iptables -I OUTPUT -d 169.254.0.0/16 -j REJECT --reject-with icmp-net-prohibited
  # Private destinations include peer networks attached for per-org build
  # caches. Established replies to runtime callers are accepted below; the
  # later resolver rules allow only configured DNS addresses on port 53.
  iptables -I OUTPUT -d 10.0.0.0/8 -j REJECT --reject-with icmp-net-prohibited
  iptables -I OUTPUT -d 172.16.0.0/12 -j REJECT --reject-with icmp-net-prohibited
  iptables -I OUTPUT -d 192.168.0.0/16 -j REJECT --reject-with icmp-net-prohibited

  # Accept responses to callers on attached private networks before the
  # REJECT rules. The later resolver exceptions are limited to DNS port 53.
  iptables -I OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
    iptables -I OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

  # Mirror the private-destination fence whenever IPv6 is filterable. Any
  # failed installation exits under set -e before tinyproxy can start.
  if [ "$IPV6_FIREWALL" = "1" ]; then
    # GCP / Azure ARM equivalents of 169.254.169.254 (fd00:ec2::254 etc.).
    ip6tables -I OUTPUT -d fd00:ec2::254/128 -j REJECT
    # IPv4-mapped IMDS — `curl -g http://[::ffff:169.254.169.254]/` hits
    # the v4 stack through the v6 socket; block both the v4-mapped form
    # and the bare v6 address space that overlaps.
    ip6tables -I OUTPUT -d ::ffff:169.254.0.0/112 -j REJECT
    ip6tables -I OUTPUT -d ::1/128 -j REJECT
    # Link-local + unique-local (RFC4193) — covers any router-advertised
    # private v6 fabric.
    ip6tables -I OUTPUT -d fe80::/10 -j REJECT
    ip6tables -I OUTPUT -d fc00::/7 -j REJECT
    # Mirror the v4 stateful ACCEPT (see explanation above) so any IPv6
    # peer runtime can also receive return packets.
    ip6tables -I OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
      ip6tables -I OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
  else
    echo "[sandbox-egress] IPv6 disabled; IPv4 firewall installed"
  fi

  # Insert these after the private-address REJECTs so the exact resolver-only
  # exceptions precede them in OUTPUT. No interface can forward between peers.
  if ! install_dns_resolver_rules; then
    exit 1
  fi
fi

# ----------------------------------------------------------------------------
# Per-session connection cap (fairness)
# ----------------------------------------------------------------------------
# tinyproxy's MaxClients (SANDBOX_EGRESS_MAX_CLIENTS) is one pool for every
# session and build helper on the host, so a single session that opens
# connections without end (a runaway crawler, an install fanning out) could
# hold all of them and leave every other session with resets. Cap what each
# client address holds open on the proxy port: with transparent egress all of
# a session's traffic, its nested containers' included, reaches the proxy from
# the session's one address, and each build helper has an address of its own.
# A connection past the cap is refused with a TCP reset at once, so its client
# fails fast instead of waiting out a timeout. tinyproxy listens on IPv4 only,
# so there is no IPv6 rule. The rule goes in only when it is not there yet: a
# Kubernetes container restart keeps its Pod's network namespace, and with it
# the rule. This is fairness, not a security boundary, so it fails open: a
# kernel without the connlimit match (or a development run without NET_ADMIN)
# starts the proxy without the cap and says so.
install_session_connection_cap() {
  if [ "$SESSION_CONNECTIONS" = "0" ]; then
    echo "[sandbox-egress] no per-session connection cap (SANDBOX_EGRESS_MAX_CONNECTIONS_PER_SESSION=0)"
    return 0
  fi
  set -- INPUT -p tcp --syn --dport 3128 -m connlimit \
    --connlimit-above "$SESSION_CONNECTIONS" --connlimit-mask 32 \
    -j REJECT --reject-with tcp-reset
  if iptables -C "$@" 2>/dev/null || iptables -I "$@"; then
    echo "[sandbox-egress] each session holds at most ${SESSION_CONNECTIONS} proxy connections at once"
  else
    echo "[sandbox-egress] WARN: per-session connection cap unavailable (no connlimit match in this kernel, or no NET_ADMIN); starting without it, so one session can hold every proxy connection"
  fi
}

if command -v iptables >/dev/null 2>&1; then
  install_session_connection_cap
else
  echo "[sandbox-egress] WARN: iptables missing; starting without the per-session connection cap"
fi

exec /entrypoint.sh "$@"
