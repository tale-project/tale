# Tale Sandbox Egress Proxy
#
# HTTPS forward proxy for sandboxed code. Open egress by default (CONNECT
# :443 to any public host); the operator can switch to a default-deny
# hostname allowlist via SANDBOX_EGRESS_ALLOWLIST. Sits on
# `tale-sandbox-net` (an internal-only Docker bridge), so this proxy is
# the sandbox runtime containers' only outbound path either way. When
# OUTBOUND_PROXY_URLS lists HTTP proxies, a squid hop sends that traffic on
# through them in turn rather than from this host's own address.
#
# Verified by R2.1: pip / npm / uv all honor HTTPS_PROXY and fail loud
# when the proxy denies a host or is unreachable.
#
# The Dockerfile-level user stays root so iptables can install the SSRF
# firewall rules in docker-entrypoint.sh and dnsmasq can bind :53 —
# tinyproxy itself drops privileges to `nobody` after bind (configured in
# tinyproxy.conf.template) and logs to stdout, so it needs no writable path.
#
# REQUIRED CAPABILITY: this container MUST be run with `cap_add: [NET_ADMIN]`
# (set in compose.yml and the CLI compose generator) so the entrypoint's
# `iptables -I OUTPUT -j REJECT` rules can install. Without NET_ADMIN the
# entrypoint refuses to start (fail-closed): the IP-layer IMDS/RFC1918
# defense is the only hostname-independent egress fence, and the hostname
# allowlist is opt-in.

# trivy:ignore:AVD-DS-0002 -- entrypoint needs root to install iptables and bind :53; tinyproxy drops privs at bind time
FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc

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
# - squid:          the outbound proxy hop, started only when OUTBOUND_PROXY_URLS
#                   lists proxies: it sends what tinyproxy hands it on through
#                   them in turn, which tinyproxy (one upstream at most) cannot.
RUN apk add --no-cache tinyproxy gettext ca-certificates iptables curl dnsmasq squid && \
    mkdir -p /etc/tinyproxy /etc/sandbox-egress

COPY services/sandbox-egress/tinyproxy.conf.template /etc/tinyproxy/tinyproxy.conf.template
COPY services/sandbox-egress/squid.conf.template /etc/sandbox-egress/squid.conf.template
COPY services/sandbox-egress/outbound-proxies.awk /etc/sandbox-egress/outbound-proxies.awk
COPY services/sandbox-egress/docker-entrypoint.sh /docker-entrypoint.sh
COPY services/sandbox-egress/entrypoint.sh /entrypoint.sh
RUN chmod +x /docker-entrypoint.sh /entrypoint.sh

# Keep version metadata after filesystem work so new releases reuse its layers.
ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-sandbox-egress" \
      org.opencontainers.image.description="Tale sandbox egress proxy — HTTPS forward proxy and DNS forwarder behind an SSRF firewall" \
      org.opencontainers.image.source="https://github.com/tale-project/tale" \
      org.opencontainers.image.url="https://tale.dev" \
      org.opencontainers.image.documentation="https://docs.tale.dev" \
      org.opencontainers.image.vendor="Tale" \
      org.opencontainers.image.licenses="MIT"

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
# Then one DNS query to dnsmasq on 127.0.0.1 for the name it answers from its
# own `--host-record` (entrypoint.sh): busybox `nslookup` exits non-zero on no
# answer within a second or on an error reply, so a forwarder that stopped
# answering turns the container unhealthy without any upstream lookup.
# Keep byte-identical to EGRESS_HEALTH_PROBE in the CLI compose generator.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -sS -o /dev/null --max-time 3 --noproxy '*' http://127.0.0.1:3128/ && nslookup -type=a -timeout=1 sandbox-egress-health.invalid 127.0.0.1 || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
