#!/bin/sh
# services/sandbox-egress/entrypoint.sh
# Render allow-list + config, log them, exec tinyproxy.

set -e

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

# tinyproxy logs to file by default; tail to stdout in background so docker
# logs surfaces them. Chown to nobody so tinyproxy (which drops privs)
# can write to it.
touch /var/log/tinyproxy/tinyproxy.log
chown nobody:nobody /var/log/tinyproxy/tinyproxy.log
tail -n0 -F /var/log/tinyproxy/tinyproxy.log &

exec tinyproxy -d -c /etc/tinyproxy/tinyproxy.conf
