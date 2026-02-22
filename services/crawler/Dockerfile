# Crawler Service Dockerfile
# Independent service for web crawling using Crawl4AI
# Resolves dependency conflicts with cognee in the RAG service

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

FROM python:3.14-slim

# Set working directory
WORKDIR /app

# Install system dependencies required for Playwright/Chromium
# Including fonts for multi-language support:
# - fonts-noto-cjk: Chinese, Japanese, Korean
# - fonts-noto-core: Latin (English, German, French, Spanish, etc.) and Cyrillic (Russian)
# - fonts-noto-color-emoji: Emoji support
# - fonts-dejavu-core: Fallback fonts with broad Unicode coverage
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-core \
    fonts-noto-color-emoji \
    fonts-dejavu-core \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -fv

# Install uv for faster package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy pyproject.toml and install dependencies
COPY services/crawler/pyproject.toml .
RUN uv pip install --system .

# Install Playwright browsers (Chromium)
# Note: We already installed dependencies manually above, so we skip `playwright install-deps`
# which has compatibility issues with newer Debian versions (missing ttf-unifont, ttf-ubuntu-font-family)
RUN playwright install chromium

# Copy application code
COPY services/crawler/app ./app

# Re-declare VERSION arg (ARGs don't persist after FROM)
ARG VERSION=dev

# Set environment variables with CRAWLER_ prefix defaults
ENV TALE_VERSION=${VERSION} \
    CRAWLER_HOST=0.0.0.0 \
    CRAWLER_PORT=8002 \
    CRAWLER_WORKERS=1 \
    CRAWLER_LOG_LEVEL=info \
    CRAWLER_ALLOWED_ORIGINS="*" \
    CRAWLER_MAX_CONCURRENT_CRAWLS=5 \
    CRAWLER_DEFAULT_MAX_PAGES=100 \
    CRAWLER_DEFAULT_WORD_COUNT_THRESHOLD=100 \
    CRAWLER_DEFAULT_CONCURRENCY=20 \
    CRAWLER_REQUEST_TIMEOUT_SECONDS=300 \
    DO_NOT_TRACK=1

# Expose port
EXPOSE 8002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8002/health || exit 1

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]

