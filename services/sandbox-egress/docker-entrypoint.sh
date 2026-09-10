#!/bin/sh
# services/sandbox-egress/docker-entrypoint.sh
#
# Container-level bootstrap for the sandbox egress proxy. Installs the
# IP-layer SSRF firewall (requires NET_ADMIN), then hands off to
# `entrypoint.sh` which renders the tinyproxy config and replaces this
# process with tinyproxy.
#
# Split rationale:
#   - The firewall touches kernel routing tables and is a container-level
#     security boundary. It belongs in the `docker-entrypoint.sh` layer
#     that conventionally runs first.
#   - The tinyproxy launch is app-level config rendering + an `exec`. It
#     belongs in `entrypoint.sh` so signals reach tinyproxy directly.

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
    # conf/all alone is not proof: a per-interface override may re-enable IPv6.
    # Check defaults (including future network attachments) and every interface.
    for _ipv6_setting in /proc/sys/net/ipv6/conf/default/disable_ipv6 /proc/sys/net/ipv6/conf/*/disable_ipv6; do
      if [ "$(cat "$_ipv6_setting" 2>/dev/null)" != "1" ]; then
        echo "[sandbox-egress] FATAL: IPv6 is enabled without a forwarding guard; refusing to start"
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
  # caches. New proxy connections to them are forbidden; only established
  # replies to the runtime callers are accepted below.
  iptables -I OUTPUT -d 10.0.0.0/8 -j REJECT --reject-with icmp-net-prohibited
  iptables -I OUTPUT -d 172.16.0.0/12 -j REJECT --reject-with icmp-net-prohibited
  iptables -I OUTPUT -d 192.168.0.0/16 -j REJECT --reject-with icmp-net-prohibited

  # Accept responses to callers on attached private networks before the
  # REJECT rules. New outbound private connections remain forbidden.
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
fi

exec /entrypoint.sh "$@"
