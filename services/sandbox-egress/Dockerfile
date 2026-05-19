# Tale Sandbox Egress Proxy
#
# HTTPS forward proxy filtering by CONNECT host. Sits on `tale-sandbox-net`
# (an internal-only Docker bridge); sandbox runtime containers reach pypi/npm
# via this proxy, all other internet is unreachable.
#
# See plan §2. Verified by R2.1: pip / npm / uv all honor HTTPS_PROXY and
# fail loud when the proxy denies a host or is unreachable.

FROM alpine:3.20

RUN apk add --no-cache tinyproxy gettext ca-certificates && \
    mkdir -p /etc/tinyproxy /var/log/tinyproxy && \
    chown -R nobody:nobody /var/log/tinyproxy

COPY tinyproxy.conf.template /etc/tinyproxy/tinyproxy.conf.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3128

HEALTHCHECK --interval=10s --timeout=3s --retries=2 \
  CMD nc -z 127.0.0.1 3128 || exit 1

ENTRYPOINT ["/entrypoint.sh"]
