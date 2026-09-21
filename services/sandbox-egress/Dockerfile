# Tale Sandbox Egress Proxy
#
# HTTPS forward proxy for sandboxed code. Open egress by default (CONNECT
# :443 to any public host); the operator can switch to a default-deny
# hostname allowlist via SANDBOX_EGRESS_ALLOWLIST. Sits on
# `tale-sandbox-net` (an internal-only Docker bridge), so this proxy is
# the sandbox runtime containers' only outbound path either way.
#
# Verified by R2.1: pip / npm / uv all honor HTTPS_PROXY and fail loud
# when the proxy denies a host or is unreachable.
#
# The Dockerfile-level user stays root so the entrypoint can chown the log
# file before exec, AND so iptables can install the SSRF firewall rules
# in entrypoint.sh — tinyproxy itself drops privileges to `nobody` after
# bind (configured in tinyproxy.conf.template).
#
# REQUIRED CAPABILITY: this container MUST be run with `cap_add: [NET_ADMIN]`
# (set in compose.yml and the CLI compose generator) so the entrypoint's
# `iptables -I OUTPUT -j REJECT` rules can install. Without NET_ADMIN the
# entrypoint refuses to start (fail-closed): the IP-layer IMDS/RFC1918
# defense is the only hostname-independent egress fence, and the hostname
# allowlist is opt-in.

# trivy:ignore:AVD-DS-0002 -- entrypoint needs root to chown log + install iptables; tinyproxy drops privs at bind time
FROM alpine:3.20

# - tinyproxy:      the proxy daemon
# - gettext:        provides envsubst for the conf template
# - ca-certificates: tinyproxy TLS validation when filtering
# - iptables:       SSRF firewall (IMDS + RFC1918 REJECT rules in entrypoint)
# - curl:           the readiness probe (HEALTHCHECK below)
# - dnsmasq:        DNS forwarder for the internal sandbox network. The runtime
#                   session + its nested DinD containers sit on an internal-only
#                   bridge and cannot resolve external names (their embedded DNS
#                   forwards to public resolvers it can't reach). This proxy is
#                   dual-homed (also on a network with real egress), so it serves
#                   resolution on :53 for the whole sandbox side.
RUN apk add --no-cache tinyproxy gettext ca-certificates iptables curl dnsmasq && \
    mkdir -p /etc/tinyproxy /var/log/tinyproxy && \
    chown -R nobody:nobody /var/log/tinyproxy

COPY services/sandbox-egress/tinyproxy.conf.template /etc/tinyproxy/tinyproxy.conf.template
COPY services/sandbox-egress/docker-entrypoint.sh /docker-entrypoint.sh
COPY services/sandbox-egress/entrypoint.sh /entrypoint.sh
RUN chmod +x /docker-entrypoint.sh /entrypoint.sh

EXPOSE 3128
EXPOSE 53/udp

# Local readiness probe only — one HTTP request to the proxy port, which
# tinyproxy answers itself with its own 400 page ("You tried to connect to
# the machine the proxy is running on"). That proves the daemon reads and
# serves, and never calls out to an external host. The 400 IS the healthy
# answer, so no `-f`; curl still exits non-zero on refusal, timeout or an
# empty reply. `--noproxy '*'` keeps an http_proxy in the container's env
# from redirecting the probe. NOT `nc -z`: tinyproxy logs every
# connect-and-close at ERROR ("read_request_line: Client … closed socket
# before read."), so a TCP probe floods the log with one error per interval.
# Keep byte-identical to EGRESS_HEALTH_PROBE in the CLI compose generator.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -sS -o /dev/null --max-time 3 --noproxy '*' http://127.0.0.1:3128/ || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
