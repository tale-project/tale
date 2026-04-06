# Multi-stage build for Tale RAG (FastAPI)
# Supports AMD64 and ARM64 architectures
#
# Optimized per issue #935:
#   Stage 1 (builder): build-essential + libpq-dev for compiling native packages
#   Stage 2 (runtime): Only libpq5 (runtime lib) + curl + clean site-packages

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

# =============================================================================
# Stage 1: BUILDER — compile native Python packages
# =============================================================================
FROM python:3.11-slim AS builder

ARG SOPS_VERSION=3.9.4

WORKDIR /app


# Install build dependencies (these stay in builder only, never reach final image)
# - build-essential: GCC/g++ for compiling native Python packages
# - libpq-dev: PostgreSQL headers for asyncpg compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL "https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/sops-v${SOPS_VERSION}.linux.$(dpkg --print-architecture)" -o /usr/local/bin/sops && chmod +x /usr/local/bin/sops

# Install uv for faster package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy and install shared packages first (better layer caching)
COPY packages/tale_shared/pyproject.toml /packages/tale_shared/pyproject.toml
COPY packages/tale_shared/src/ /packages/tale_shared/src/
COPY packages/tale_knowledge/pyproject.toml /packages/tale_knowledge/pyproject.toml
COPY packages/tale_knowledge/src/ /packages/tale_knowledge/src/
COPY packages/tale_telemetry/pyproject.toml /packages/tale_telemetry/pyproject.toml
COPY packages/tale_telemetry/src/ /packages/tale_telemetry/src/
RUN uv pip install --system --no-cache-dir \
    /packages/tale_shared /packages/tale_knowledge /packages/tale_telemetry

# Copy pyproject.toml and install service dependencies
# Fix local package paths: relative ../../packages/* → absolute /packages/* for Docker context
COPY services/rag/pyproject.toml /app/pyproject.toml
RUN sed -i 's|../../packages/tale_knowledge|/packages/tale_knowledge|g; s|../../packages/tale_shared|/packages/tale_shared|g; s|../../packages/tale_telemetry|/packages/tale_telemetry|g' pyproject.toml \
    && uv pip install --system --no-cache-dir .

# Deep cleanup before copying to runtime
RUN set -eux; \
    # Strip __pycache__ and .pyc files
    find /usr/local/lib/python3.11/site-packages -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true; \
    find /usr/local/lib/python3.11/site-packages -name "*.pyc" -delete 2>/dev/null || true; \
    # Remove test directories
    find /usr/local/lib/python3.11/site-packages -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true; \
    find /usr/local/lib/python3.11/site-packages -type d -name "test" -exec rm -rf {} + 2>/dev/null || true; \
    find /usr/local/lib/python3.11/site-packages -type d -name "testing" -exec rm -rf {} + 2>/dev/null || true; \
    # Strip debug symbols from .so files
    find /usr/local/lib/python3.11/site-packages -name "*.so" -exec strip --strip-debug {} \; 2>/dev/null || true; \
    # Remove pip, setuptools, wheel
    rm -rf /usr/local/lib/python3.11/site-packages/pip*; \
    rm -rf /usr/local/lib/python3.11/site-packages/setuptools*; \
    rm -rf /usr/local/lib/python3.11/site-packages/wheel*; \
    rm -rf /usr/local/lib/python3.11/site-packages/_distutils_hack*; \
    rm -f /usr/local/lib/python3.11/site-packages/distutils-precedence.pth; \
    rm -rf /usr/local/lib/python3.11/site-packages/pkg_resources*

# =============================================================================
# Stage 2: RUNTIME — clean final image
# =============================================================================
FROM python:3.11-slim AS runtime

WORKDIR /app

# Install ONLY runtime dependencies (no build-essential, no libpq-dev)
# - curl: Used by health check
# - libpq5: PostgreSQL runtime library (not the dev headers)
# Note: SOPS binary is already provided by COPY --from=builder /usr/local/bin
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libpq5 \
    && rm -rf /var/lib/apt/lists/* \
    # Strip system bloat
    && rm -rf /usr/share/doc/* /usr/share/man/* /usr/share/info/* \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/* \
    && apt-get clean 2>/dev/null || true

# Copy cleaned Python site-packages from builder (no uv, no pip cache, no __pycache__)
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Remove pip/setuptools that may have leaked from the runtime base image (~13 MB)
RUN rm -rf /usr/local/lib/python3.11/site-packages/pip* \
           /usr/local/lib/python3.11/site-packages/setuptools* \
           /usr/local/lib/python3.11/site-packages/_distutils_hack* \
           /usr/local/lib/python3.11/site-packages/pkg_resources*

# Copy FastAPI application
COPY services/rag/app /app/app

# Copy and set up entrypoint script
COPY services/rag/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Create data directory
RUN mkdir -p /app/data

# Re-declare VERSION arg for this stage (ARGs don't persist across stages)
ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-rag" \
      org.opencontainers.image.description="Tale RAG Service — FastAPI document indexing and semantic search" \
      org.opencontainers.image.source="https://github.com/tale-project/tale" \
      org.opencontainers.image.vendor="Tale" \
      org.opencontainers.image.licenses="MIT"

# Set environment variables
ENV TALE_VERSION=${VERSION} \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    RAG_HOST=0.0.0.0 \
    RAG_PORT=8001 \
    RAG_WORKERS=1 \
    RAG_LOG_LEVEL=info \
    RAG_CHUNK_SIZE=2048 \
    RAG_CHUNK_OVERLAP=200 \
    DO_NOT_TRACK=1 \
    TALE_PLATFORM_SHARED_CONFIG_DIR=/app/platform-config

# Expose port
EXPOSE 8001

# Health check (uses RAG_PORT env var with fallback to 8001)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${RAG_PORT:-8001}/health || exit 1

# Create mountpoints for volumes (must exist before FROM scratch squash)
RUN mkdir -p /app/platform-config/providers /app/data

# Use entrypoint script for environment setup and application startup
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# =============================================================================
# Stage 3: SQUASH — flatten layers to eliminate Docker layer bloat
# =============================================================================
FROM scratch
COPY --from=runtime / /

ARG VERSION=dev

WORKDIR /app



# Re-declare ENV vars (FROM scratch drops upstream ENV directives)
ENV TALE_VERSION=${VERSION} \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    RAG_HOST=0.0.0.0 \
    RAG_PORT=8001 \
    RAG_WORKERS=1 \
    RAG_LOG_LEVEL=info \
    RAG_CHUNK_SIZE=2048 \
    RAG_CHUNK_OVERLAP=200 \
    DO_NOT_TRACK=1 \
    TALE_PLATFORM_SHARED_CONFIG_DIR=/app/platform-config

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${RAG_PORT:-8001}/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
