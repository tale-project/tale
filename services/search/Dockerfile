# Dockerfile for Tale Search (SearXNG)
# Self-hosted meta search engine for the Tale platform
# Base image: Void Linux with wget pre-installed

# Use official SearXNG image as base
# Pinned to specific digest for reproducibility (SearXNG 2025.11.28)
FROM searxng/searxng@sha256:782d8ab73c432e4f8ff5f40044bc55f444906dde2aec5f9e35c27fc169b4673a

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
ENV SEARCH_INSTANCE_NAME="Tale Search" \
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
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/healthz || exit 1

# Use custom entrypoint wrapper that handles SEARCH_ env vars
ENTRYPOINT ["/usr/local/bin/docker-entrypoint-wrapper.sh"]

