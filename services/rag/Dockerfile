# Multi-stage build for Tale RAG (Cognee + FastAPI)
# Supports AMD64 and ARM64 architectures

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

FROM python:3.11-slim AS base

# Set working directory
WORKDIR /app

# Install minimal system dependencies
# - curl: Health checks and downloads
# - build-essential: Compilation for native Python packages
# - libpq-dev: PostgreSQL client library for psycopg2
# - libmagic1: File type detection for unstructured
# Note: OCR dependencies (tesseract, poppler, OpenCV) removed - using Vision API instead
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    libpq-dev \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# Install uv for faster package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# ============================================================================
# Stage 2: Dependencies
# ============================================================================
FROM base AS dependencies

WORKDIR /app

# Copy pyproject.toml and install dependencies
COPY services/rag/pyproject.toml /app/pyproject.toml
RUN uv pip install --system .

# Pre-download tiktoken encoding files to avoid runtime network requests
# This ensures the container works in air-gapped environments
# Download all common encodings used by OpenAI models
RUN mkdir -p /root/.cache/tiktoken && \
    python3 -c "import tiktoken; \
    tiktoken.get_encoding('cl100k_base'); \
    tiktoken.get_encoding('p50k_base'); \
    tiktoken.get_encoding('r50k_base');" && \
    echo "Tiktoken encodings downloaded successfully" && \
    ls -la /root/.cache/tiktoken/ || echo "Warning: tiktoken cache directory is empty"

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

# Create data directory for cognee
RUN mkdir -p /app/data \
    && mkdir -p /usr/local/lib/python3.11/site-packages/cognee/.data_storage

# Set environment variables
ENV TALE_VERSION=${VERSION} \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # Default Tale RAG configuration
    RAG_HOST=0.0.0.0 \
    RAG_PORT=8001 \
    # Single worker recommended for stability.
    # FalkorDB is client-server, so multiple workers are theoretically possible,
    # but single worker with FastAPI async handles most workloads efficiently.
    RAG_WORKERS=1 \
    RAG_LOG_LEVEL=info \
    # Cognee data directory
    RAG_COGNEE_DATA_DIR=/app/data \
    # Default database URL for local development (connects to tale-db container)
    # Note: PGVector uses this same PostgreSQL database for vector storage
    # Uses dedicated tale_rag database to isolate from other services (e.g., Convex uses tale_platform)
    RAG_DATABASE_URL=postgresql://tale:tale_password_change_me@db:5432/tale_rag \
    # Cognee Graph and Vector Database Configuration (FalkorDB)
    # IMPORTANT: These must be set BEFORE Python imports cognee modules.
    # Cognee reads these env vars at module import time, not at runtime.
    # FalkorDB provides both graph and vector storage via hybrid adapter.
    # Uses 'graph-db' as the hostname (Docker service name in compose.yml)
    GRAPH_DATABASE_PROVIDER=falkor \
    GRAPH_DATABASE_URL=graph-db \
    GRAPH_DATABASE_PORT=6379 \
    GRAPH_DATABASE_NAME=tale_default \
    GRAPH_DATASET_DATABASE_HANDLER=falkor_graph_local \
    VECTOR_DB_PROVIDER=falkor \
    VECTOR_DB_URL=graph-db \
    VECTOR_DB_PORT=6379 \
    VECTOR_DATASET_DATABASE_HANDLER=falkor_vector_local \
    ENABLE_GRAPH_STORAGE=true \
    ENABLE_VECTOR_SEARCH=true \
    COGNEE_DATA_DIR=/app/data \
    # Cognee BaseConfig paths (pydantic_settings reads these env vars)
    # These override the default paths in cognee.base_config.BaseConfig
    DATA_ROOT_DIRECTORY=/app/data/.data_storage \
    SYSTEM_ROOT_DIRECTORY=/app/data/.cognee_system \
    # Disable telemetry to prevent SSL errors to external telemetry endpoint
    TELEMETRY_DISABLED=true

# Expose port
EXPOSE 8001

# Health check (uses RAG_PORT env var with fallback to 8001)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${RAG_PORT:-8001}/health || exit 1

# Use entrypoint script for environment setup and application startup
ENTRYPOINT ["/app/docker-entrypoint.sh"]

