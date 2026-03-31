# Dockerfile for Tale DB (ParadeDB)
# Supports AMD64 and ARM64 architectures
#
# Base: ParadeDB (pg_search BM25 + pgvector)

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

# ParadeDB includes pg_search (BM25), pgvector, and PostgreSQL 16
FROM paradedb/paradedb:0.22.4-pg16

# Re-declare VERSION arg (ARGs don't persist after FROM)
ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}"

# Switch to root for all setup operations
USER root

# Install additional tools and create required directories
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /docker-entrypoint-initdb.d \
                /etc/postgresql/conf.d \
                /var/lib/postgresql/backup

# Install dbmate for database migrations
COPY --from=ghcr.io/amacneil/dbmate:2 /usr/local/bin/dbmate /usr/local/bin/dbmate

# Copy initialization scripts
# - /docker-entrypoint-initdb.d/ : PostgreSQL runs these on first init only
# - /etc/postgresql/init-scripts/ : Entrypoint wrapper runs these on every startup
COPY services/db/init-scripts/ /docker-entrypoint-initdb.d/
COPY services/db/init-scripts/ /etc/postgresql/init-scripts/

# Copy database migrations (tale_knowledge)
COPY services/db/migrations/ /etc/postgresql/migrations/

# Copy custom PostgreSQL configuration to the expected location
COPY services/db/postgresql.conf /etc/postgresql/postgresql.conf

# Copy entrypoint wrapper script and set permissions
COPY services/db/docker-entrypoint-wrapper.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint-wrapper.sh \
    && chown -R postgres:postgres /docker-entrypoint-initdb.d \
                                   /etc/postgresql \
                                   /var/lib/postgresql/backup

# Run as root — the standard docker-entrypoint.sh detects root,
# fixes data directory ownership, then re-execs as postgres via gosu.
# This handles UID mismatches when switching base images (e.g., Alpine→Debian).

# Set environment variables with DB_ prefix defaults
# These can be overridden at runtime
# Application version
ENV TALE_VERSION=${VERSION}

# Database credentials (password must be provided at runtime via DB_PASSWORD)
ENV DB_NAME=tale \
    DB_USER=tale

# Performance tuning (conservative defaults)
ENV DB_MAX_CONNECTIONS=100 \
    DB_SHARED_BUFFERS=256MB \
    DB_EFFECTIVE_CACHE_SIZE=1GB \
    DB_MAINTENANCE_WORK_MEM=128MB \
    DB_WORK_MEM=32MB

# Logging
ENV DB_LOG_STATEMENT=none \
    DB_LOG_MIN_DURATION_STATEMENT=-1

# Expose PostgreSQL port
EXPOSE 5432

# Health check — waits for both PostgreSQL readiness and migration completion
HEALTHCHECK --interval=10s --timeout=5s --start-period=90s --retries=10 \
    CMD pg_isready -U ${DB_USER:-tale} -d ${DB_NAME:-tale} && test -f /tmp/.db_ready || exit 1

# Use custom entrypoint wrapper that handles DB_ env vars
ENTRYPOINT ["/usr/local/bin/docker-entrypoint-wrapper.sh"]
CMD ["postgres"]

