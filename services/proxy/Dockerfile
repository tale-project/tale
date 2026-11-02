# ============================================================================
# Tale Proxy Service (Traefik)
# ============================================================================
# The edge of a Tale deployment. Traefik routes each request by the labels
# the services declare, terminates TLS (self-signed, Let's Encrypt, or behind
# an external terminator) and serves the edge's own answers through a
# loopback nginx. The same image runs the read-only Docker API proxy those
# labels are read through (command `docker-api`). See README.md.
# ============================================================================

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

# =============================================================================
# tale-init: patched dumb-init 1.2.5 at /init (MAXSIG 31 -> 64), for Incus.
# Incus runs /init as PID 1 and halts a container with SIGPWR, or SIGRTMIN+3
# when PID 1 blocks it; the runtime rewrites both to the stop signal. Docker
# never runs it: the ENTRYPOINT below is unchanged. patches/README.md says why
# and when it goes. Byte-identical in the six stack images (db, platform,
# proxy, sandbox, sandbox-egress, sandbox-llm-gateway), held by
# tools/cli/scripts/oci-image-metadata.test.ts.
# =============================================================================
FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc AS tale-init
COPY patches/dumb-init/maxsig-64.patch /tmp/maxsig-64.patch
RUN set -eux; \
    apk add --no-cache gcc musl-dev patch; \
    wget -q -O /tmp/dumb-init.tar.gz https://github.com/Yelp/dumb-init/archive/refs/tags/v1.2.5.tar.gz; \
    echo '3eda470d8a4a89123f4516d26877a727c0945006c8830b7e3bad717a5f6efc4e  /tmp/dumb-init.tar.gz' | sha256sum -c -; \
    tar -C /tmp -xzf /tmp/dumb-init.tar.gz; \
    cd /tmp/dumb-init-1.2.5; \
    patch -p1 < /tmp/maxsig-64.patch; \
    grep -qx '#define MAXSIG 64' dumb-init.c; \
    gcc -std=gnu99 -static -s -Wall -Werror -O2 -o /init dumb-init.c; \
    /init --version

FROM traefik:v3.7.17@sha256:30ff62491aacdb862ceb8c9edcf2627da638d7deafdd4b6dab32fe34f8aa3e90 AS traefik

# nginx, its njs (which renders the configuration at boot) and busybox's
# wget and nslookup (the healthcheck and the ACME retry) come with the base.
FROM nginx:1.30.6-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949

COPY --from=traefik /usr/local/bin/traefik /usr/local/bin/traefik

# Set environment variables with sensible defaults
ENV HOST=localhost \
    TLS_MODE=selfsigned

# The renderer, the Docker API proxy and the maintenance page, shown while
# no platform answers (e.g. during a blue-green deployment)
COPY services/proxy/render/config.js services/proxy/render/pki.js services/proxy/render/main.js \
     /usr/share/tale-proxy/render/
COPY services/proxy/docker-api/nginx.conf services/proxy/docker-api/strip-env.js \
     /usr/share/tale-proxy/docker-api/
COPY services/proxy/maintenance.html /usr/share/tale-proxy/maintenance.html
# Traefik's plugin that answers a request body the client framed wrongly,
# read where Traefik looks for local plugins (tale-proxy starts it here)
COPY services/proxy/bodyfaults/bodyfaults.go services/proxy/bodyfaults/.traefik.yml \
     /usr/share/tale-proxy/plugins-local/src/tale/bodyfaults/
COPY services/proxy/tale-proxy /usr/local/bin/tale-proxy
RUN chmod 755 /usr/local/bin/tale-proxy

# /init for Incus, from the tale-init stage (Docker never runs it).
COPY --from=tale-init /init /init

# Keep version metadata after filesystem work so new releases reuse its layers.
# Re-declare VERSION arg (ARGs don't persist after FROM)
ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-proxy" \
      org.opencontainers.image.description="Tale Proxy — Traefik edge with auto-TLS and label routing" \
      org.opencontainers.image.source="https://github.com/tale-project/tale" \
      org.opencontainers.image.url="https://tale.dev" \
      org.opencontainers.image.documentation="https://docs.tale.dev" \
      org.opencontainers.image.vendor="Tale" \
      org.opencontainers.image.licenses="MIT"
LABEL dev.tale.init="dumb-init-1.2.5+maxsig64"
ENV TALE_VERSION=${VERSION}

# Expose HTTP and HTTPS ports
EXPOSE 80 443

# Let's Encrypt certificates (acme.json) and the self-signed CA (pki/)
VOLUME /data

# Health check via dedicated internal port (not exposed externally); the
# docker-api role answers its own /_ping instead
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD ["tale-proxy", "health"]

# The nginx base stops with SIGQUIT; the supervisor stops on SIGTERM.
STOPSIGNAL SIGTERM

ENTRYPOINT ["tale-proxy"]
CMD ["edge"]
