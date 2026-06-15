#!/bin/sh
# services/sandbox-egress/entrypoint.sh
#
# App-level launch for the sandbox egress proxy. `docker-entrypoint.sh`
# runs first and installs the IP-layer SSRF firewall; we render the
# tinyproxy config (open egress by default, or a default-deny allowlist
# when the operator sets SANDBOX_EGRESS_ALLOWLIST) and exec tinyproxy.

set -e

# Operator opt-in lockdown. SANDBOX_EGRESS_ALLOWLIST is one hostname regex
# per line, or `|`-separated for compose-friendly single-line env values.
#   non-empty      => default-deny: only matching hosts are proxied.
#   unset or empty => open egress: no hostname filtering at all.
# The IP-layer SSRF firewall (IMDS + link-local + RFC1918 REJECT, installed
# by docker-entrypoint.sh) applies in BOTH modes. LLM traffic never transits
# this proxy either way (NO_PROXY=bifrost on the runtime containers).
if [ -n "$SANDBOX_EGRESS_ALLOWLIST" ]; then
  echo "$SANDBOX_EGRESS_ALLOWLIST" | tr '|' '\n' > /etc/tinyproxy/allowlist
  FILTER_BLOCK='# Host-name allow-list (default-deny), rendered from SANDBOX_EGRESS_ALLOWLIST.
FilterDefaultDeny Yes
FilterCaseSensitive No
FilterExtended Yes
FilterURLs Off
Filter "/etc/tinyproxy/allowlist"'
  EGRESS_MODE=allowlist
else
  # Omit the Filter directive entirely. tinyproxy 1.11.x treats an EMPTY
  # filter file with FilterDefaultDeny Yes as deny-everything, and exits
  # EX_DATAERR when the Filter path doesn't exist — leaving the directive
  # out is the only unambiguous "no hostname filtering" configuration.
  FILTER_BLOCK='# Open egress: no hostname filter (SANDBOX_EGRESS_ALLOWLIST unset or empty).'
  EGRESS_MODE=open
fi
export FILTER_BLOCK

# Explicit SHELL-FORMAT so envsubst only ever substitutes ${FILTER_BLOCK};
# a future literal `$` in the template can't be silently eaten.
envsubst '${FILTER_BLOCK}' \
  < /etc/tinyproxy/tinyproxy.conf.template > /etc/tinyproxy/tinyproxy.conf

echo "[sandbox-egress] starting tinyproxy on :3128 (egress mode: ${EGRESS_MODE})"
if [ "$EGRESS_MODE" = allowlist ]; then
  echo "[sandbox-egress] CONNECT allow-list:"
  sed 's/^/  /' /etc/tinyproxy/allowlist
else
  echo "[sandbox-egress] open egress: CONNECT to any public host on :443 (IP-layer SSRF firewall still blocks IMDS/RFC1918; set SANDBOX_EGRESS_ALLOWLIST to restrict)"
fi
echo "[sandbox-egress] config:"
sed 's/^/  /' /etc/tinyproxy/tinyproxy.conf

# DNS forwarder for the internal sandbox network. The runtime session and its
# nested DinD containers live on `tale-sandbox-net` (internal-only) and cannot
# resolve external hostnames — their embedded DNS forwards to public resolvers
# that the internal bridge can't reach, so things like `getbifrost.ai` or
# `deb.debian.org` fail to resolve. This proxy is dual-homed (also on a network
# with real egress), so its own resolver (`/etc/resolv.conf` -> 127.0.0.11)
# resolves the public internet. Run dnsmasq forwarding to it, listening on all
# interfaces so the sandbox side can point its resolver here. `--bind-dynamic`
# also binds interfaces that appear later; `-u root` since :53 is privileged and
# the entrypoint still runs as root at this point.
echo "[sandbox-egress] starting dnsmasq DNS forwarder on :53 (internal-network external resolution)"
dnsmasq --keep-in-foreground --bind-dynamic --no-hosts -u root &
DNSMASQ_PID=$!

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
trap 'kill -TERM "$TINYPROXY_PID" "$DNSMASQ_PID" 2>/dev/null || true' INT TERM

exec tail -n0 -F /var/log/tinyproxy/tinyproxy.log
