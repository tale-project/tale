# Multi-stage build for Tale RAG (Cognee + FastAPI)
# Supports AMD64 and ARM64 architectures

FROM python:3.11-slim AS base

# Set working directory
WORKDIR /app

# Install system dependencies
# - tesseract-ocr: OCR engine for scanned PDFs and images
# - poppler-utils: PDF rendering for pdf2image (used by OCR)
# - libmagic1: File type detection for unstructured
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    libpq-dev \
    tesseract-ocr \
    poppler-utils \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# Install uv for faster package management
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:/root/.cargo/bin:${PATH}"

# ============================================================================
# Stage 2: Dependencies
# ============================================================================
FROM base AS dependencies

WORKDIR /app

# Copy requirements file
COPY services/rag/requirements.txt /app/requirements.txt

# Install Python dependencies
RUN uv pip install --system -r requirements.txt

# ============================================================================
# Stage 3: Final
# ============================================================================
FROM dependencies AS final

WORKDIR /app

# Copy FastAPI application
COPY services/rag/app /app/app

# Create data directory for cognee
RUN mkdir -p /app/data \
    && mkdir -p /usr/local/lib/python3.11/site-packages/cognee/.data_storage

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # Default Tale RAG configuration
    RAG_HOST=0.0.0.0 \
    RAG_PORT=8001 \
    RAG_WORKERS=1 \
    RAG_LOG_LEVEL=info \
    # Worker recycling: restart worker after N requests to bound memory growth.
    # Cognee accumulates in-process state that CPython doesn't return to OS.
    # Requires RAG_WORKERS >= 2 so the parent process can respawn workers.
    RAG_MAX_REQUESTS_PER_WORKER=100000 \
    # Cognee data directory
    RAG_COGNEE_DATA_DIR=/app/data \
    # Default database URL for local development (connects to tale-db container)
    # Note: PGVector uses this same PostgreSQL database for vector storage
    RAG_DATABASE_URL=postgresql://tale:tale_password_change_me@db:5432/tale

# Expose port
EXPOSE 8001

# Health check (uses RAG_PORT env var with fallback to 8001)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${RAG_PORT:-8001}/health || exit 1

# Run FastAPI application with worker recycling (--limit-max-requests)
CMD ["sh", "-c", "python -m uvicorn app.main:app --host ${RAG_HOST} --port ${RAG_PORT} --workers ${RAG_WORKERS} --limit-max-requests ${RAG_MAX_REQUESTS_PER_WORKER}"]

