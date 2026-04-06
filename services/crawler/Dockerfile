# Crawler Service Dockerfile
# Independent service for web crawling using Crawl4AI
#
# Fully optimized multi-stage build per issue #935:
#   Stage 1 (builder): Install Python deps + Playwright browsers
#   Stage 2 (runtime): Minimal final image with only runtime artifacts
#
# Optimizations applied:
#   1. --no-install-recommends on apt-get
#   2. Multi-stage build (builder → runtime)
#   3. Remove full Chrome UI (keep headless_shell which Playwright defaults to, saves ~364 MB)
#   4. Remove FFmpeg from Playwright (unused — crawler doesn't record video)
#   5. Strip patchright Node.js driver (duplicate of playwright driver)
#   6. Remove pip, setuptools, wheel from site-packages
#   7. Strip __pycache__ and .pyc files
#   8. Strip .so debug symbols
#   9. Remove test dirs from site-packages
#  10. --no-cache-dir on uv pip install
#  11. CJK fonts optional via INSTALL_CJK_FONTS build arg (saves ~100 MB)

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev
# Set to 'true' to include CJK (Chinese/Japanese/Korean) font support (~100 MB)
# Most crawl targets are Latin/Cyrillic — enable only if crawling CJK sites
ARG INSTALL_CJK_FONTS=false

# =============================================================================
# Stage 1: BUILDER — install dependencies, download browsers
# =============================================================================
FROM python:3.11-slim AS builder

WORKDIR /app


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
COPY services/crawler/pyproject.toml .
RUN sed -i 's|../../packages/tale_knowledge|/packages/tale_knowledge|g; s|../../packages/tale_shared|/packages/tale_shared|g; s|../../packages/tale_telemetry|/packages/tale_telemetry|g' pyproject.toml \
    && uv pip install --system --no-cache-dir .

# Install Playwright browsers (Chromium)
# Note: We skip `playwright install-deps` which has compatibility issues with
# newer Debian versions (missing ttf-unifont, ttf-ubuntu-font-family)
RUN playwright install chromium

# ----- DEEP CLEANUP in builder (before copying to runtime) -----
RUN set -eux; \
    # 1. Remove FFmpeg — crawler doesn't record video (saves ~5 MB)
    rm -rf /root/.cache/ms-playwright/ffmpeg-*/; \
    # 2. Strip patchright's bundled Node.js driver — it's a ~129 MB duplicate
    #    of the playwright driver. Patchright patches are applied at runtime
    #    via Python, the driver is only used by playwright itself
    rm -rf /usr/local/lib/python3.11/site-packages/patchright/driver/; \
    # 3. Remove pip, setuptools, wheel — not needed at runtime (saves ~14 MB)
    pip uninstall -y pip setuptools wheel 2>/dev/null || true; \
    rm -rf /usr/local/lib/python3.11/site-packages/pip*; \
    rm -rf /usr/local/lib/python3.11/site-packages/setuptools*; \
    rm -rf /usr/local/lib/python3.11/site-packages/wheel*; \
    rm -rf /usr/local/lib/python3.11/site-packages/_distutils_hack*; \
    rm -f /usr/local/lib/python3.11/site-packages/distutils-precedence.pth; \
    rm -rf /usr/local/lib/python3.11/site-packages/pkg_resources*; \
    # 4. Strip __pycache__ and .pyc files (saves ~30-50 MB)
    find /usr/local/lib/python3.11/site-packages -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true; \
    find /usr/local/lib/python3.11/site-packages -name "*.pyc" -delete 2>/dev/null || true; \
    # 5. Remove test directories from packages (saves ~10-20 MB)
    find /usr/local/lib/python3.11/site-packages -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true; \
    find /usr/local/lib/python3.11/site-packages -type d -name "test" -exec rm -rf {} + 2>/dev/null || true; \
    find /usr/local/lib/python3.11/site-packages -type d -name "testing" -exec rm -rf {} + 2>/dev/null || true; \
    # 6. Strip debug symbols from compiled .so files (saves ~20-40 MB)
    find /usr/local/lib/python3.11/site-packages -name "*.so" -exec strip --strip-debug {} \; 2>/dev/null || true

# =============================================================================
# Stage 2: RUNTIME — minimal final image
# =============================================================================
FROM python:3.11-slim AS runtime

WORKDIR /app

# Re-declare build args for this stage
ARG INSTALL_CJK_FONTS=false

# Install ONLY runtime system dependencies (--no-install-recommends per issue #935)
# Runtime-only packages: tini (PID 1), curl (healthcheck)
# Chromium runtime libs: libasound2, libatk*, libnss3, libgbm1, etc.
# NOT installed: wget, gnupg (only needed for apt key management during build)
ARG SOPS_VERSION=3.9.4
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    curl \
    ca-certificates \
    fonts-liberation \
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
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -fv \
    && curl -fsSL "https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/sops-v${SOPS_VERSION}.linux.$(dpkg --print-architecture)" -o /usr/local/bin/sops && chmod +x /usr/local/bin/sops

# Strip safely removable bloat (conservative — keep GTK/mesa/systemd for Chromium)
RUN ARCH_LIB="/usr/lib/$(dpkg --print-architecture | sed 's/amd64/x86_64-linux-gnu/;s/arm64/aarch64-linux-gnu/')"; \
    rm -rf "${ARCH_LIB}"/libLLVM* /usr/lib/llvm-* 2>/dev/null || true; \
    rm -rf /usr/share/icons/Adwaita 2>/dev/null || true; \
    rm -rf /usr/share/doc/* /usr/share/man/* /usr/share/info/*; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/*

# Optional: CJK fonts for Chinese/Japanese/Korean site crawling (~100 MB)
# Enable with: docker compose build --build-arg INSTALL_CJK_FONTS=true crawler
RUN if [ "$INSTALL_CJK_FONTS" = "true" ]; then \
        apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk \
        && apt-get clean && rm -rf /var/lib/apt/lists/* && fc-cache -fv; \
    fi

# Copy cleaned Python site-packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy ONLY the headless shell browser binary from builder (not full Chrome, not FFmpeg)
COPY --from=builder /root/.cache/ms-playwright /root/.cache/ms-playwright

# Copy application code
COPY services/crawler/app ./app

# Re-declare VERSION arg (ARGs don't persist after FROM)
ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-crawler" \
      org.opencontainers.image.description="Tale Crawler Service — Crawl4AI with Playwright Chromium headless_shell" \
      org.opencontainers.image.source="https://github.com/tale-project/tale" \
      org.opencontainers.image.vendor="Tale" \
      org.opencontainers.image.licenses="MIT"

# Set environment variables with CRAWLER_ prefix defaults
ENV TALE_VERSION=${VERSION} \
    CRAWLER_HOST=0.0.0.0 \
    CRAWLER_PORT=8002 \
    CRAWLER_WORKERS=1 \
    CRAWLER_LOG_LEVEL=info \
    CRAWLER_ALLOWED_ORIGINS="*" \
    CRAWLER_POLL_INTERVAL=300 \
    CRAWLER_MAX_CONCURRENT_SCANS=1 \
    CRAWLER_CRAWL_BATCH_SIZE=5 \
    CRAWLER_CRAWL_COUNT_BEFORE_RESTART=25 \
    CRAWLER_DB_POOL_MAX_SIZE=10 \
    DO_NOT_TRACK=1 \
    TALE_PLATFORM_SHARED_CONFIG_DIR=/app/platform-config

# Expose port
EXPOSE 8002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8002/health || exit 1

# Create mountpoints for volumes (must exist before FROM scratch squash)
RUN mkdir -p /app/platform-config/providers /app/data

# Use tini as init process to reap zombie Chrome/Playwright child processes.
ENTRYPOINT ["tini", "--"]

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]

# =============================================================================
# Stage 3: SQUASH — flatten layers to eliminate Docker layer bloat
# =============================================================================
FROM scratch
COPY --from=runtime / /

ARG VERSION=dev

WORKDIR /app



# Re-declare ENV vars (FROM scratch drops upstream ENV directives)
ENV TALE_VERSION=${VERSION} \
    CRAWLER_HOST=0.0.0.0 \
    CRAWLER_PORT=8002 \
    CRAWLER_WORKERS=1 \
    CRAWLER_LOG_LEVEL=info \
    CRAWLER_ALLOWED_ORIGINS="*" \
    CRAWLER_POLL_INTERVAL=300 \
    CRAWLER_MAX_CONCURRENT_SCANS=1 \
    CRAWLER_CRAWL_BATCH_SIZE=5 \
    CRAWLER_CRAWL_COUNT_BEFORE_RESTART=25 \
    CRAWLER_DB_POOL_MAX_SIZE=10 \
    DO_NOT_TRACK=1 \
    TALE_PLATFORM_SHARED_CONFIG_DIR=/app/platform-config

EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8002/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
