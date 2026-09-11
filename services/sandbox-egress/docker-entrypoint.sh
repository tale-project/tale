#!/bin/sh
# services/sandbox-egress/docker-entrypoint.sh
#
# Container-level bootstrap for the sandbox egress proxy. Installs the
# IP-layer SSRF firewall (requires NET_ADMIN), then hands off to
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

exec /entrypoint.sh "$@"
