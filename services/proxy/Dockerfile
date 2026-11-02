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
COPY services/proxy/tale-proxy /usr/local/bin/tale-proxy
RUN chmod 755 /usr/local/bin/tale-proxy

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
