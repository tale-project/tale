# Crawler Service Dockerfile
# Independent service for web crawling using Crawl4AI
# Resolves dependency conflicts with cognee in the RAG service

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

FROM python:3.11-slim

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

# Copy requirements file
COPY services/crawler/requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browsers (Chromium)
# Note: We already installed dependencies manually above, so we skip `playwright install-deps`
# which has compatibility issues with newer Debian versions (missing ttf-unifont, ttf-ubuntu-font-family)
RUN playwright install chromium

# Copy application code
COPY services/crawler/app ./app

# Re-declare VERSION arg (ARGs don't persist after FROM)
ARG VERSION=dev

# Set version environment variable
ENV TALE_VERSION=${VERSION}

# Expose port
EXPOSE 8002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8002/health || exit 1

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]

