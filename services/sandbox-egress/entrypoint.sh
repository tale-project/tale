#!/bin/sh
# services/sandbox-egress/entrypoint.sh
#
# App-level launch for the sandbox egress proxy. `docker-entrypoint.sh`
# runs first and installs the IP-layer SSRF firewall; we render the
# tinyproxy allowlist + config and exec tinyproxy.

set -e

# Package registries (pip/npm/uv) + GitHub. github.com / api.github.com are
# added for the agent-session scenario (git-over-HTTPS clone/push + the `gh`
# CLI for issue→PR flows); codeload / objects.githubusercontent serve the
# tarball/asset CDNs already used by pip/npm installs. CONNECT-443-only stays
# (no SSH). Deliberately NOT here: provider hosts like api.anthropic.com (LLM
# traffic must transit the Bifrost gateway, not tinyproxy) and telemetry hosts
# (disabled via env in the runtime image instead).
DEFAULT_ALLOWLIST='^pypi\.org$
^files\.pythonhosted\.org$
^registry\.npmjs\.org$
^objects\.githubusercontent\.com$
^codeload\.github\.com$
^github\.com$
^api\.github\.com$'

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
