# Dockerfile for Tale DB (TimescaleDB)
# Supports AMD64 and ARM64 architectures

# Use official TimescaleDB image as base
# TimescaleDB is PostgreSQL with time-series extensions
# Note: Using the Debian-based variant (timescaledb-ha) for compatibility
FROM timescale/timescaledb-ha:pg16

# Switch to root for all setup operations
USER root

# Install additional tools, create directories, and set up configuration in one layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /docker-entrypoint-initdb.d \
                /etc/postgresql/conf.d \
                /var/lib/postgresql/backup

# Copy initialization scripts
COPY services/db/init-scripts/ /docker-entrypoint-initdb.d/

# Copy custom PostgreSQL configuration to the expected location
COPY services/db/postgresql.conf /etc/postgresql/postgresql.conf

# Copy entrypoint wrapper script and set permissions
COPY services/db/docker-entrypoint-wrapper.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint-wrapper.sh \
    && chown -R postgres:postgres /docker-entrypoint-initdb.d \
                                   /etc/postgresql \
                                   /var/lib/postgresql/backup

# Switch to postgres user for runtime security
USER postgres

# Set environment variables with DB_ prefix defaults
# These can be overridden at runtime
ENV DB_NAME=tale \
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
    DB_MAINTENANCE_WORK_MEM=64MB \
    DB_WORK_MEM=4MB \
    # TimescaleDB specific
    DB_TIMESCALEDB_TELEMETRY=off \
    TIMESCALEDB_TELEMETRY=off \
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

