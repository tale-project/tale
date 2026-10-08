#!/bin/sh
# services/sandbox-egress/entrypoint.sh
#
# App-level launch for the sandbox egress proxy. `docker-entrypoint.sh`
# runs first and installs the IP-layer SSRF firewall; we render the
# tinyproxy config (open egress by default, or a default-deny allowlist
# when the operator sets SANDBOX_EGRESS_ALLOWLIST) and supervise foreground
# tinyproxy alongside the DNS forwarder.

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

# Connections the proxy serves at once, for the whole fleet (tinyproxy
# MaxClients). Past it, tinyproxy refuses new connections and installs and
# page loads fail with resets. Each connection holds a thread and two
# descriptors (client and upstream), so compose sizes the container's pids
# and open-file limits for the default; a raised value needs them raised too.
MAX_CLIENTS="${SANDBOX_EGRESS_MAX_CLIENTS:-2000}"
case "$MAX_CLIENTS" in
  '' | *[!0-9]* | 0*)
    echo "[sandbox-egress] FATAL: SANDBOX_EGRESS_MAX_CLIENTS must be a whole number of connections above 0; got '${MAX_CLIENTS}'"
    exit 1 ;;
esac
export MAX_CLIENTS
# A Kubernetes Pod spec sets no open-file limit, and a container runtime's
# default soft limit can be as low as 1024: raise the soft limit to what the
# connections need, as far as the hard limit allows (no privilege needed).
_need_files=$((MAX_CLIENTS * 2 + 64))
_open_files="$(ulimit -n)"
if [ "$_open_files" != unlimited ] && [ "$_need_files" -gt "$_open_files" ]; then
  _hard_files="$(ulimit -H -n 2>/dev/null || echo unknown)"
  _want_files="$_need_files"
  if [ "$_hard_files" != unlimited ] && [ "$_hard_files" -lt "$_want_files" ] 2>/dev/null; then
    _want_files="$_hard_files"
  fi
  if [ "$_want_files" -gt "$_open_files" ] && ulimit -S -n "$_want_files" 2>/dev/null; then
    echo "[sandbox-egress] raised the open-file limit from ${_open_files} to ${_want_files} for ${MAX_CLIENTS} connections"
    _open_files="$(ulimit -n)"
  fi
fi
if [ "$_open_files" != unlimited ] && [ "$_need_files" -gt "$_open_files" ]; then
  echo "[sandbox-egress] WARN: ${MAX_CLIENTS} connections need about ${_need_files} open files, more than this container's limit of ${_open_files} allows; raise its nofile ulimit or lower SANDBOX_EGRESS_MAX_CLIENTS"
fi

# Explicit SHELL-FORMAT so envsubst only ever substitutes ${FILTER_BLOCK}
# and ${MAX_CLIENTS}; a future literal `$` in the template can't be silently
# eaten.
envsubst '${FILTER_BLOCK} ${MAX_CLIENTS}' \
  < /etc/tinyproxy/tinyproxy.conf.template > /etc/tinyproxy/tinyproxy.conf

echo "[sandbox-egress] starting tinyproxy on :3128 (egress mode: ${EGRESS_MODE}, at most ${MAX_CLIENTS} connections)"
if [ "$EGRESS_MODE" = allowlist ]; then
  echo "[sandbox-egress] CONNECT allow-list:"
  sed 's/^/  /' /etc/tinyproxy/allowlist
else
  echo "[sandbox-egress] open egress: CONNECT to any public host on :443 (IP-layer SSRF firewall still blocks IMDS/RFC1918; set SANDBOX_EGRESS_ALLOWLIST to restrict)"
fi
echo "[sandbox-egress] config:"
sed 's/^/  /' /etc/tinyproxy/tinyproxy.conf

# Supervision. This shell (PID 1) runs dnsmasq and tinyproxy in the
# background and watches both. Either one exiting on its own stops the other
# and exits non-zero, so the restart policy brings the container back whole:
# nested containers and BuildKit RUN steps resolve names only through this
# dnsmasq, so a proxy left serving without it is a silent DNS outage for every
# session. A trap forwards INT/TERM to both, so `docker stop` gives them a
# clean shutdown (drained CONNECT tunnels) instead of the SIGKILL that follows
# the grace period, and the shell then exits with tinyproxy's status. The
# trap is set before either starts, and the stop path signals both again, so
# a stop that arrives while they are starting still reaches both. (Not `exec
# tinyproxy`: that replaces the shell and with it the trap — shell traps do
# not survive exec — so dnsmasq would never be watched or stopped.)
#
# errexit is switched off from here on: when the trap fires mid-`wait`, POSIX
# `wait` returns 128+signal (143) and `set -e` would exit PID 1 right there —
# before the forwarded TERM is acted on and before the reaping `wait` — which
# tears down the pid namespace and SIGKILLs the children anyway.
set +e
STOPPING=
DNSMASQ_PID=
TINYPROXY_PID=
NAP_PID=
trap 'STOPPING=1; kill -TERM $TINYPROXY_PID $DNSMASQ_PID $NAP_PID 2>/dev/null' INT TERM

# Whether a child still runs. /proc answers without signalling it: tinyproxy
# runs as nobody, and root may signal it only while it holds KILL. `kill -0`
# stands in where there is no /proc. Once the shell has reaped a child, it is
# gone from both.
running() {
  if [ -d /proc/self ]; then
    [ -d "/proc/$1" ]
  else
    kill -0 "$1" 2>/dev/null
  fi
}

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
#
# `--cache-size=4096`: every session, nested container and build step of the
# fleet resolves through this one forwarder, and dnsmasq's default cache of
# 150 names evicts entries long before their TTLs run out, sending repeat
# lookups upstream again; 4096 names take well under 1 MB. `--host-record`
# gives the health probe a name dnsmasq answers from its own configuration, so
# the probe proves the forwarder answers on :53 without depending on an
# upstream resolver (nothing under `.invalid` exists in public DNS).
echo "[sandbox-egress] starting dnsmasq DNS forwarder on :53 (internal-network external resolution)"
dnsmasq --keep-in-foreground --bind-dynamic --no-hosts -u root \
  --cache-size=4096 --host-record=sandbox-egress-health.invalid,127.0.0.1 &
DNSMASQ_PID=$!

# tinyproxy logs to its stdout, which is the container log, so nothing else
# needs to run beside it.
tinyproxy -d -c /etc/tinyproxy/tinyproxy.conf &
TINYPROXY_PID=$!

# Check on both every two seconds. The `wait` on the nap is what reaps a child
# that exited, and a signal interrupts it at once.
while [ -z "$STOPPING" ] && running "$TINYPROXY_PID" && running "$DNSMASQ_PID"; do
  sleep 2 &
  NAP_PID=$!
  wait "$NAP_PID"
  NAP_PID=
done

if [ -n "$STOPPING" ]; then
  kill -TERM "$TINYPROXY_PID" "$DNSMASQ_PID" 2>/dev/null
  wait "$TINYPROXY_PID"
  rc=$?
  # A second signal interrupts `wait` before tinyproxy has exited; wait on it
  # again so its shutdown is reaped before the shell exits.
  wait "$TINYPROXY_PID" 2>/dev/null
  wait
  exit "$rc"
fi

if running "$TINYPROXY_PID"; then
  DEAD=dnsmasq
  DEAD_PID=$DNSMASQ_PID
else
  DEAD=tinyproxy
  DEAD_PID=$TINYPROXY_PID
fi
wait "$DEAD_PID"
rc=$?
echo "[sandbox-egress] FATAL: ${DEAD} exited with status ${rc}; stopping the proxy so the container restarts with both"
kill -TERM "$TINYPROXY_PID" "$DNSMASQ_PID" 2>/dev/null
wait
if [ "$rc" -eq 0 ]; then
  rc=1
fi
exit "$rc"
