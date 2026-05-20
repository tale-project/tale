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
if [ "${TALE_SKIP_SSRF_FIREWALL:-0}" != "1" ] && command -v iptables >/dev/null 2>&1; then
  if iptables -L OUTPUT >/dev/null 2>&1; then
    echo "[sandbox-egress] installing SSRF egress firewall (REJECT IMDS + link-local + RFC1918)"
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
  else
    echo "[sandbox-egress] WARN: iptables present but no NET_ADMIN — SSRF firewall NOT installed (set cap_add: [NET_ADMIN] in compose.yml)"
  fi
else
  echo "[sandbox-egress] WARN: iptables unavailable or TALE_SKIP_SSRF_FIREWALL=1 — SSRF firewall NOT installed"
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
