# Operator Service Dockerfile
# AI-powered operator service with direct Playwright browser automation

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
    xvfb \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -fv

# Create non-root user for running Chrome (required for sandbox)
RUN groupadd -r pwuser \
    && useradd -r -g pwuser -G audio,video -m pwuser

# Install uv for faster package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy pyproject.toml and install dependencies (includes playwright)
COPY services/operator/pyproject.toml .
RUN uv pip install --system .

# Install Playwright Chromium browser
RUN playwright install chromium \
    && mkdir -p /home/pwuser/.cache \
    && cp -r /root/.cache/ms-playwright /home/pwuser/.cache/ \
    && chown -R pwuser:pwuser /home/pwuser/.cache

# Copy application code
COPY services/operator/app ./app

# Copy entrypoint script
COPY services/operator/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Set ownership for app directory
RUN chown -R pwuser:pwuser /app

# Re-declare VERSION arg (ARGs don't persist after FROM)
ARG VERSION=dev

# Set environment variables
ENV TALE_VERSION=${VERSION} \
    OPERATOR_HOST=0.0.0.0 \
    OPERATOR_PORT=8004 \
    OPERATOR_WORKERS=4 \
    OPERATOR_LOG_LEVEL=info \
    OPERATOR_HEADLESS=false \
    OPERATOR_MAX_CONCURRENT_REQUESTS=10 \
    OPERATOR_REQUEST_TIMEOUT=180 \
    HOME=/home/pwuser \
    DO_NOT_TRACK=1

# Switch to non-root user
USER pwuser

# Expose port
EXPOSE 8004

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8004/health || exit 1

# Use entrypoint to handle Xvfb for non-headless mode
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8004"]
