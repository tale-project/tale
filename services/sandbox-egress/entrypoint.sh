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
# this proxy either way (NO_PROXY=sandbox-llm-gateway on the runtime containers).
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
# that the internal bridge can't reach, so things like `example.com` or
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

# Run tinyproxy and the log tail in the background and `wait` on tinyproxy
# from this shell (PID 1). A trap forwards INT/TERM to tinyproxy, dnsmasq and
# tail so `docker stop` gives them a clean shutdown (drained CONNECT tunnels)
# instead of the SIGKILL that follows the grace period; the final `wait`
# reaps them before the shell exits and the container goes down. (An `exec
# tail` here would have replaced the shell and with it the trap — shell traps
# do not survive exec — so the forwarding never ran.) If tinyproxy dies on
# its own the first `wait` returns and the container exits for the restart
# policy to act on.
#
# errexit is switched off from here on: when the trap fires mid-`wait`, POSIX
# `wait` returns 128+signal (143) and `set -e` would exit PID 1 right there —
# before the forwarded TERM is acted on and before the reaping `wait` — which
# tears down the pid namespace and SIGKILLs the children anyway. The shell
# still exits with tinyproxy's status (143 on stop, its own code on a crash).
tinyproxy -d -c /etc/tinyproxy/tinyproxy.conf &
TINYPROXY_PID=$!
tail -n0 -F /var/log/tinyproxy/tinyproxy.log &
TAIL_PID=$!
trap 'kill -TERM "$TINYPROXY_PID" "$DNSMASQ_PID" "$TAIL_PID" 2>/dev/null || true' INT TERM

set +e
wait "$TINYPROXY_PID"
rc=$?
# A signal interrupts `wait` before tinyproxy has exited; wait on it again so
# its clean shutdown (not the trap's delivery) is what we report and reap.
wait "$TINYPROXY_PID" 2>/dev/null
kill -TERM "$DNSMASQ_PID" "$TAIL_PID" 2>/dev/null
wait
exit "$rc"
