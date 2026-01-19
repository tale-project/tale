# Dockerfile for Tale Search (SearXNG)
# Self-hosted meta search engine for the Tale platform
# Base image: Void Linux with wget pre-installed

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

# Use official SearXNG image as base
# Pinned to specific digest for reproducibility (SearXNG 2025.11.28)
FROM searxng/searxng@sha256:93f28a7503b41bbf8b0ded80e14baf999b9d85a5f3665091ae7c18190f506a59

# Re-declare VERSION arg (ARGs don't persist after FROM)
ARG VERSION=dev

# Switch to root for setup operations
USER root

# Copy entrypoint wrapper script and set permissions
# Note: /etc/searxng already exists and is owned by searxng in base image
COPY services/search/docker-entrypoint-wrapper.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint-wrapper.sh

# Switch back to searxng user for runtime security
USER searxng

# Set environment variables with SEARCH_ prefix defaults
# These can be overridden at runtime
ENV TALE_VERSION=${VERSION} \
    SEARCH_INSTANCE_NAME="Tale Search" \
    SEARCH_SECRET_KEY="tale-search-secret-key-change-in-production" \
    SEARCH_BIND_ADDRESS="0.0.0.0" \
    SEARCH_PORT=8080 \
	SEARCH_DEBUG=false \
    SEARCH_SAFE_SEARCH=0 \
    SEARCH_DEFAULT_LANG="all" \
    SEARCH_PUBLIC_INSTANCE=false \
    SEARCH_LIMITER=false \
    SEARCH_REQUEST_TIMEOUT=10.0 \
    SEARCH_MAX_REQUEST_TIMEOUT=30.0 \
    SEARCH_POOL_CONNECTIONS=100 \
    SEARCH_POOL_MAXSIZE=20 \
    SEARCH_RETRIES=2

# Expose SearXNG port
EXPOSE 8080

# Health check
# Include X-Real-IP header so SearXNG's botdetection does not log a
# noisy "X-Forwarded-For nor X-Real-IP header is set!" error when
# the healthcheck runs.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
	CMD wget --no-verbose --tries=1 --spider --header="X-Real-IP: 127.0.0.1" http://localhost:8080/healthz || exit 1

# Use custom entrypoint wrapper that handles SEARCH_ env vars
ENTRYPOINT ["/usr/local/bin/docker-entrypoint-wrapper.sh"]

