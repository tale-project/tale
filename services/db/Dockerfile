# Dockerfile for Tale DB (ParadeDB)
# Supports AMD64 and ARM64 architectures
#
# Multi-stage build to strip ~1.18 GB of bloat from the upstream ParadeDB image:
#   Stage 1 (cleanup):  ParadeDB base + strip debug symbols, PostGIS, LLVM, Perl, Python
#   Stage 2 (runtime):  Export cleaned filesystem to eliminate Docker layer bloat
#
# Base: ParadeDB (pg_search BM25 + pgvector) on PostgreSQL 16

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

# =============================================================================
# Stage 1: CLEANUP — strip bloat from ParadeDB base
# =============================================================================
FROM paradedb/paradedb:0.22.5-pg16 AS cleanup

USER root

# Strip components not used by Tale:
#   - pg_search.so.dbg : 888 MB debug symbols (never needed in production)
#   - libllvm19 files  : 127 MB JIT compiler (JIT not configured)
#   - PostGIS .so/.sql :  ~5 MB spatial extension files (no spatial queries in Tale)
#   - Locales          :  31 MB (keep only en_US.UTF-8)
#   - Docs/man         :   7 MB
# IMPORTANT: Cannot apt-get purge libllvm19 — postgresql-16 depends on it.
#            Use targeted rm to delete the actual library files instead.
RUN set -eux; \
    ARCH_LIB="/usr/lib/$(dpkg --print-architecture | sed 's/amd64/x86_64-linux-gnu/;s/arm64/aarch64-linux-gnu/')"; \
    rm -f /usr/lib/postgresql/16/lib/*.dbg; \
    rm -rf "${ARCH_LIB}"/libLLVM* /usr/lib/llvm-* 2>/dev/null || true; \
    rm -f /usr/lib/postgresql/16/lib/postgis*.so \
          /usr/lib/postgresql/16/lib/address_standardizer*.so 2>/dev/null || true; \
    rm -rf /usr/share/postgresql/16/extension/postgis* \
           /usr/share/postgresql/16/extension/address* 2>/dev/null || true; \
    apt-get purge -y python3-psycopg2 2>/dev/null || true; \
    find /usr/share/locale -mindepth 1 -maxdepth 1 ! -name 'en_US' -exec rm -rf {} + 2>/dev/null || true; \
    rm -rf /usr/share/doc/* /usr/share/man/* /usr/share/info/*; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/* /tmp/* /var/tmp/*; \
    apt-get clean

# =============================================================================
# Stage 2: RUNTIME — fresh layer with only cleaned files
# =============================================================================
FROM scratch AS runtime
COPY --from=cleanup / /

# Re-declare VERSION arg (ARGs don't persist after FROM)
ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-db" \
      org.opencontainers.image.description="Tale DB — ParadeDB (pg_search BM25 + pgvector) on PostgreSQL 16" \
      org.opencontainers.image.source="https://github.com/tale-project/tale" \
      org.opencontainers.image.vendor="Tale" \
      org.opencontainers.image.licenses="MIT"

# Create required directories
RUN mkdir -p /docker-entrypoint-initdb.d \
             /etc/postgresql/conf.d \
             /var/lib/postgresql/backup

# Install dbmate for database migrations
COPY --from=ghcr.io/amacneil/dbmate:2 /usr/local/bin/dbmate /usr/local/bin/dbmate

# Copy initialization scripts
COPY services/db/init-scripts/ /docker-entrypoint-initdb.d/
COPY services/db/init-scripts/ /etc/postgresql/init-scripts/

# Copy database migrations (tale_knowledge)
COPY services/db/migrations/ /etc/postgresql/migrations/

# Copy custom PostgreSQL configuration
COPY services/db/postgresql.conf /etc/postgresql/postgresql.conf

# Copy entrypoint wrapper script and set permissions
COPY services/db/docker-entrypoint-wrapper.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint-wrapper.sh \
    && chown -R postgres:postgres /etc/postgresql \
                                   /var/lib/postgresql/backup

# Re-declare upstream PostgreSQL environment variables (lost in FROM scratch)
ENV LANG=en_US.utf8 \
    PGDATA=/var/lib/postgresql/data \
    PG_MAJOR=16 \
    PG_VERSION_MAJOR=16 \
    GOSU_VERSION=1.19 \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/postgresql/16/bin

# Set Tale-specific environment variables
ENV TALE_VERSION=${VERSION}
ENV DB_NAME=tale \
    DB_USER=tale
ENV DB_MAX_CONNECTIONS=100 \
    DB_SHARED_BUFFERS=256MB \
    DB_EFFECTIVE_CACHE_SIZE=1GB \
    DB_MAINTENANCE_WORK_MEM=128MB \
    DB_WORK_MEM=32MB
ENV DB_LOG_STATEMENT=none \
    DB_LOG_MIN_DURATION_STATEMENT=-1

EXPOSE 5432

HEALTHCHECK --interval=10s --timeout=5s --start-period=90s --retries=10 \
    CMD pg_isready -U ${DB_USER:-tale} -d ${DB_NAME:-tale} && test -f /tmp/.db_ready || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint-wrapper.sh"]
CMD ["postgres"]
