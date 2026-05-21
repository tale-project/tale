#!/bin/sh
# services/sandbox-egress/entrypoint.sh
# Render allow-list + config, install IP-layer egress firewall, exec tinyproxy.

set -e

# ----------------------------------------------------------------------------
# SSRF firewall (defense-in-depth)
# ----------------------------------------------------------------------------
# The tinyproxy allowlist is a hostname-regex filter applied AFTER the proxy
# resolves the CONNECT target. A short-TTL DNS rebind on an allowlisted host
# could flip resolution to 169.254.169.254 (cloud IMDS) or RFC1918 (corp VPN,
# host bridge) between tinyproxy's lookup and the kernel connect(). Block
# those targets at the IP layer so the entire tunnel surface is fenced
# regardless of what hostname squeaked past the allowlist.
#
# Mirrors services/convex/docker-entrypoint.sh lines 59-83. Requires
# NET_ADMIN; cap_add: ['NET_ADMIN'] is set in compose.yml and the CLI
# compose generator. Skipped (with a loud warn) when iptables is missing
# or the capability isn't granted, so dev environments still boot.
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
  # grant; if it's not effective, the IP-layer DNS-rebind defense is
  # absent and only the hostname allowlist stands between runtime code
  # and the cloud IMDS. Don't ship that silently.
  echo "[sandbox-egress] FATAL: NET_ADMIN unavailable; SSRF firewall cannot install (set TALE_SKIP_SSRF_FIREWALL=1 to override for dev only, or cap_add: [NET_ADMIN] in compose.yml)"
  exit 1
else
  echo "[sandbox-egress] installing SSRF egress firewall (REJECT IMDS + link-local + RFC1918, v4 + v6)"
  # Cloud instance metadata service (AWS/GCP/Azure IMDSv1 footprint).
  iptables -I OUTPUT -d 169.254.169.254/32 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || \
    echo "[sandbox-egress] WARN: failed to reject 169.254.169.254/32"
  # All link-local — covers Azure 168.63.129.16 and other variants.
  iptables -I OUTPUT -d 169.254.0.0/16 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || true
  # RFC1918 ranges that aren't part of this container's own attached
  # docker network. The kernel routes intra-network traffic via the
  # bridge driver before OUTPUT is consulted for external-bound packets,
  # so peer containers on the same docker network are not affected by
  # these rules — only attempts to reach private ranges that route OUT
  # of the bridge are dropped. If the operator deploys on a non-default
  # docker-network topology where this assumption breaks, set
  # TALE_SKIP_SSRF_FIREWALL=1 to bypass.
  iptables -I OUTPUT -d 10.0.0.0/8 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || true
  iptables -I OUTPUT -d 172.16.0.0/12 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || true
  iptables -I OUTPUT -d 192.168.0.0/16 -j REJECT --reject-with icmp-net-prohibited 2>/dev/null || true

  # Stateful ACCEPT for response traffic. Without this, the REJECT rules
  # above also drop the SYN-ACK and data segments tinyproxy sends back to
  # peer runtime containers — their IPs sit in 172.30.0.0/24 ⊂ 172.16/12,
  # so the kernel rejects egress's reply with icmp-net-prohibited and the
  # runtime's connect() times out. The header comment above optimistically
  # assumed bridge-to-bridge traffic skips OUTPUT; on modern kernels with
  # bridge-nf-call-iptables=1 it does NOT, so we explicitly let return
  # traffic through. NEW outbound to RFC1918 is still rejected because
  # this rule only matches ESTABLISHED/RELATED conntrack states.
  iptables -I OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
    iptables -I OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
    echo "[sandbox-egress] WARN: failed to install stateful ACCEPT — runtime callers will time out connecting to the proxy"

  # IPv6 mirror: if a future tale-sandbox-net is created with IPv6 enabled
  # (or the host kernel exposes a v6 default route into one of the
  # sensitive private ranges), the v4-only rules above would leave a hole.
  # ip6tables is best-effort — alpine kernels without ip6_tables loaded
  # just log a warn and continue; on hosts with v6 enabled the rules
  # bind and provide parity with the v4 defenses.
  if command -v ip6tables >/dev/null 2>&1 && ip6tables -L OUTPUT >/dev/null 2>&1; then
    # GCP / Azure ARM equivalents of 169.254.169.254 (fd00:ec2::254 etc.).
    ip6tables -I OUTPUT -d fd00:ec2::254/128 -j REJECT 2>/dev/null || true
    # IPv4-mapped IMDS — `curl -g http://[::ffff:169.254.169.254]/` hits
    # the v4 stack through the v6 socket; block both the v4-mapped form
    # and the bare v6 address space that overlaps.
    ip6tables -I OUTPUT -d ::ffff:169.254.0.0/112 -j REJECT 2>/dev/null || true
    ip6tables -I OUTPUT -d ::1/128 -j REJECT 2>/dev/null || true
    # Link-local + unique-local (RFC4193) — covers any router-advertised
    # private v6 fabric.
    ip6tables -I OUTPUT -d fe80::/10 -j REJECT 2>/dev/null || true
    ip6tables -I OUTPUT -d fc00::/7 -j REJECT 2>/dev/null || true
    # Mirror the v4 stateful ACCEPT (see explanation above) so any IPv6
    # peer runtime can also receive return packets.
    ip6tables -I OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
      ip6tables -I OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
  else
    echo "[sandbox-egress] WARN: ip6tables unavailable; IPv6 SSRF defense not installed (harmless on IPv4-only hosts)"
  fi
fi

DEFAULT_ALLOWLIST='^pypi\.org$
^files\.pythonhosted\.org$
^registry\.npmjs\.org$
^objects\.githubusercontent\.com$
^codeload\.github\.com$'

# Operator override: one regex per line, or `|`-separated for compose-friendly
# single-line env values.
if [ -n "$SANDBOX_EGRESS_ALLOWLIST" ]; then
  echo "$SANDBOX_EGRESS_ALLOWLIST" | tr '|' '\n' > /etc/tinyproxy/allowlist
else
  printf '%s\n' "$DEFAULT_ALLOWLIST" > /etc/tinyproxy/allowlist
fi

envsubst < /etc/tinyproxy/tinyproxy.conf.template > /etc/tinyproxy/tinyproxy.conf

echo "[sandbox-egress] starting tinyproxy on :3128"
echo "[sandbox-egress] CONNECT allow-list:"
sed 's/^/  /' /etc/tinyproxy/allowlist
echo "[sandbox-egress] config:"
sed 's/^/  /' /etc/tinyproxy/tinyproxy.conf

# tinyproxy logs to file by default; tail to stdout in foreground so docker
# logs surfaces them. Chown to nobody so tinyproxy (which drops privs)
# can write to it.
touch /var/log/tinyproxy/tinyproxy.log
chown nobody:nobody /var/log/tinyproxy/tinyproxy.log

# Run tinyproxy in the background, then `exec tail -F` so the tail process
# replaces this shell as PID 1. SIGTERM from `docker stop` then goes
# straight to tail (which exits on signal), tail's death tears down the
# container, and tinyproxy — as a sibling child of the original shell —
# is reaped by the kernel rather than zombified through this entrypoint.
# A signal trap forwards INT/TERM to tinyproxy so it gets a clean shutdown
# instead of SIGKILL when the container stops.
tinyproxy -d -c /etc/tinyproxy/tinyproxy.conf &
TINYPROXY_PID=$!
trap 'kill -TERM "$TINYPROXY_PID" 2>/dev/null || true' INT TERM

exec tail -n0 -F /var/log/tinyproxy/tinyproxy.log
