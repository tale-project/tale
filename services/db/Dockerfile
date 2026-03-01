# Dockerfile for Tale DB (ParadeDB)
# Supports AMD64 and ARM64 architectures
#
# Base: ParadeDB (pg_search BM25 + pgvector)

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

# ParadeDB includes pg_search (BM25), pgvector, and PostgreSQL 16
FROM paradedb/paradedb:0.21.10-pg16

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

# Copy initialization scripts
# - /docker-entrypoint-initdb.d/ : PostgreSQL runs these on first init only
# - /etc/postgresql/init-scripts/ : Entrypoint wrapper runs these on every startup
COPY services/db/init-scripts/ /docker-entrypoint-initdb.d/
COPY services/db/init-scripts/ /etc/postgresql/init-scripts/

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
ENV TALE_VERSION=${VERSION} \
    DB_NAME=tale \
    DB_USER=tale \
    DB_PASSWORD=tale_password_change_me \
    # PostgreSQL configuration (required by base image)
    POSTGRES_DB=tale \
    POSTGRES_USER=tale \
    POSTGRES_PASSWORD=tale_password_change_me \
    # Performance tuning (conservative defaults)
    DB_MAX_CONNECTIONS=100 \
    DB_SHARED_BUFFERS=256MB \
    DB_EFFECTIVE_CACHE_SIZE=1GB \
    DB_MAINTENANCE_WORK_MEM=128MB \
    DB_WORK_MEM=32MB \
    # Logging
    DB_LOG_STATEMENT=none \
    DB_LOG_MIN_DURATION_STATEMENT=-1

# Expose PostgreSQL port
EXPOSE 5432

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB} || exit 1

# Use custom entrypoint wrapper that handles DB_ env vars
ENTRYPOINT ["/usr/local/bin/docker-entrypoint-wrapper.sh"]
CMD ["postgres"]

