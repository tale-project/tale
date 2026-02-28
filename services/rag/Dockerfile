# Multi-stage build for Tale RAG (FastAPI)
# Supports AMD64 and ARM64 architectures

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

FROM python:3.11-slim AS base

# Set working directory
WORKDIR /app

# Install minimal system dependencies
# - curl: Health checks and downloads
# - build-essential: Compilation for native Python packages
# - libpq-dev: PostgreSQL client library for asyncpg
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install uv for faster package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# ============================================================================
# Stage 2: Dependencies
# ============================================================================
FROM base AS dependencies

WORKDIR /app

# Copy and install shared packages first (better layer caching)
COPY packages/tale_shared/pyproject.toml /packages/tale_shared/pyproject.toml
COPY packages/tale_shared/src/ /packages/tale_shared/src/
COPY packages/tale_knowledge/pyproject.toml /packages/tale_knowledge/pyproject.toml
COPY packages/tale_knowledge/src/ /packages/tale_knowledge/src/
RUN uv pip install --system /packages/tale_shared /packages/tale_knowledge

# Copy pyproject.toml and install service dependencies
# Fix local package paths: relative ../../packages/* → absolute /packages/* for Docker context
COPY services/rag/pyproject.toml /app/pyproject.toml
RUN sed -i 's|../../packages/tale_knowledge|/packages/tale_knowledge|g; s|../../packages/tale_shared|/packages/tale_shared|g' pyproject.toml \
    && uv pip install --system .

# ============================================================================
# Stage 3: Final
# ============================================================================
FROM dependencies AS final

# Re-declare VERSION arg for this stage (ARGs don't persist across stages)
ARG VERSION=dev

WORKDIR /app

# Copy FastAPI application
COPY services/rag/app /app/app

# Copy and set up entrypoint script
COPY services/rag/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Create data directory
RUN mkdir -p /app/data

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
    RAG_DATABASE_URL=postgresql://tale:tale_password_change_me@db:5432/tale_knowledge \
    DO_NOT_TRACK=1

# Expose port
EXPOSE 8001

# Health check (uses RAG_PORT env var with fallback to 8001)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${RAG_PORT:-8001}/health || exit 1

# Use entrypoint script for environment setup and application startup
ENTRYPOINT ["/app/docker-entrypoint.sh"]
