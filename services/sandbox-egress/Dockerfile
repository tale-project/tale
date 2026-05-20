# Tale Sandbox Egress Proxy
#
# HTTPS forward proxy filtering by CONNECT host. Sits on `tale-sandbox-net`
# (an internal-only Docker bridge); sandbox runtime containers reach pypi/npm
# via this proxy, all other internet is unreachable.
#
# See plan §2. Verified by R2.1: pip / npm / uv all honor HTTPS_PROXY and
# fail loud when the proxy denies a host or is unreachable.
#
# The Dockerfile-level user stays root so the entrypoint can chown the log
# file before exec, AND so iptables can install the SSRF firewall rules
# in entrypoint.sh — tinyproxy itself drops privileges to `nobody` after
# bind (configured in tinyproxy.conf.template).
#
# REQUIRED CAPABILITY: this container MUST be run with `cap_add: [NET_ADMIN]`
# (set in compose.yml and the CLI compose generator) so the entrypoint's
# `iptables -I OUTPUT -j REJECT` rules can install. Without NET_ADMIN the
# entrypoint logs a warning and continues; the hostname allowlist still
# applies but the IP-layer DNS-rebind defense is absent.

# trivy:ignore:AVD-DS-0002 -- entrypoint needs root to chown log + install iptables; tinyproxy drops privs at bind time
FROM alpine:3.20

# - tinyproxy:      the proxy daemon
# - gettext:        provides envsubst for the conf template
# - ca-certificates: tinyproxy TLS validation when filtering
# - iptables:       SSRF firewall (IMDS + RFC1918 REJECT rules in entrypoint)
# - curl:           healthcheck CONNECT probe
RUN apk add --no-cache tinyproxy gettext ca-certificates iptables curl && \
    mkdir -p /etc/tinyproxy /var/log/tinyproxy && \
    chown -R nobody:nobody /var/log/tinyproxy

COPY services/sandbox-egress/tinyproxy.conf.template /etc/tinyproxy/tinyproxy.conf.template
COPY services/sandbox-egress/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3128

# Healthcheck verifies the proxy still tunnels an allowlisted host. A pure
# TCP `nc -z 3128` would stay green even if the allowlist was wiped or the
# upstream broke; this CONNECT probe fails iff the proxy can no longer
# serve a known-good destination.
HEALTHCHECK --interval=10s --timeout=5s --retries=2 \
  CMD curl -sf -x http://127.0.0.1:3128 -o /dev/null --connect-timeout 3 https://pypi.org/simple/ || exit 1

ENTRYPOINT ["/entrypoint.sh"]
