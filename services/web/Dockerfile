# Web Service Dockerfile
# AI-powered web interaction service using OpenCode + Playwright MCP
# Based on crawler service pattern for Playwright/Chromium support

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

# Install Node.js for Playwright MCP Server
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Playwright MCP Server and OpenCode CLI globally
RUN npm install -g @playwright/mcp opencode-ai@latest

# Create non-root user for running Chrome (required for sandbox)
RUN groupadd -r pwuser \
    && useradd -r -g pwuser -G audio,video -m pwuser

# Install Playwright browsers (Chrome) for MCP Server as root first
# MCP Server specifically requires Chrome, not Chromium
RUN npx playwright install chrome \
    && mkdir -p /home/pwuser/.cache \
    && cp -r /root/.cache/ms-playwright /home/pwuser/.cache/ \
    && chown -R pwuser:pwuser /home/pwuser/.cache

# Install uv for faster package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy pyproject.toml and install dependencies
COPY services/web/pyproject.toml .
RUN uv pip install --system .

# Copy application code
COPY services/web/app ./app

# Copy entrypoint script
COPY services/web/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Set ownership for app directory and create OpenCode config dir
RUN chown -R pwuser:pwuser /app \
    && mkdir -p /home/pwuser/.config/opencode /home/pwuser/.local/share/opencode \
    && chown -R pwuser:pwuser /home/pwuser/.config /home/pwuser/.local

# Re-declare VERSION arg (ARGs don't persist after FROM)
ARG VERSION=dev

# Set environment variables with WEB_ prefix defaults
ENV TALE_VERSION=${VERSION} \
    WEB_HOST=0.0.0.0 \
    WEB_PORT=8004 \
    WEB_WORKERS=1 \
    WEB_LOG_LEVEL=info \
    WEB_ALLOWED_ORIGINS="*" \
    WEB_HEADLESS=true \
    WEB_TIMEOUT=30 \
    WEB_MAX_STEPS=30 \
    HOME=/home/pwuser

# Switch to non-root user
USER pwuser

# Expose port
EXPOSE 8004

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8004/health || exit 1

# Use entrypoint to handle Xvfb for non-headless mode
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8004"]
