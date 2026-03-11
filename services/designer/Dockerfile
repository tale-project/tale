# Designer Service Dockerfile
# AI-powered document transformation service using Pencil MCP + pandoc

ARG VERSION=dev
ARG TARGETARCH

FROM python:3.11-slim

# Re-declare after FROM (ARGs don't persist across FROM)
ARG TARGETARCH

WORKDIR /app

# System dependencies: pandoc for DOCX conversion + Electron shared libs for Pencil MCP server
RUN apt-get update && apt-get install -y \
    curl \
    pandoc \
    # Electron/Chromium shared libraries required by the Pencil MCP server binary
    libgtk-3-0 \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libasound2 \
    libxss1 \
    libxtst6 \
    libxrandr2 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi6 \
    libx11-xcb1 \
    libxkbcommon0 \
    libdrm2 \
    libglib2.0-0 \
    libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (Electron/Chrome sandbox requirement)
RUN groupadd -r designer && useradd -r -g designer -m designer

# Install uv for fast Python package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Extract Pencil for the target architecture.
# Both tarballs have root dir Pencil-<version>-linux-<arch>/ so --strip-components=1
# places the contents directly under /opt/pencil/.
COPY services/designer/Pencil-linux-x64.tar /tmp/Pencil-linux-x64.tar
COPY services/designer/Pencil-linux-arm64.tar /tmp/Pencil-linux-arm64.tar
RUN mkdir -p /opt/pencil && \
    if [ "$TARGETARCH" = "arm64" ]; then \
        tar -xf /tmp/Pencil-linux-arm64.tar -C /opt/pencil --strip-components=1; \
        chmod +x /opt/pencil/resources/app.asar.unpacked/out/mcp-server-linux-arm64; \
    else \
        tar -xf /tmp/Pencil-linux-x64.tar -C /opt/pencil --strip-components=1; \
        chmod +x /opt/pencil/resources/app.asar.unpacked/out/mcp-server-linux-x64; \
    fi && \
    rm /tmp/Pencil-linux-*.tar

# Install shared Python packages
COPY packages/tale_telemetry/pyproject.toml /packages/tale_telemetry/pyproject.toml
COPY packages/tale_telemetry/src/ /packages/tale_telemetry/src/
RUN uv pip install --system /packages/tale_telemetry

COPY packages/tale_shared/pyproject.toml /packages/tale_shared/pyproject.toml
COPY packages/tale_shared/src/ /packages/tale_shared/src/
RUN uv pip install --system /packages/tale_shared

# Install service dependencies
# Fix local package paths: relative ../../packages/* → absolute /packages/* for Docker context
COPY services/designer/pyproject.toml .
RUN sed -i \
    -e 's|../../packages/tale_telemetry|/packages/tale_telemetry|g' \
    -e 's|../../packages/tale_shared|/packages/tale_shared|g' \
    pyproject.toml \
    && uv pip install --system .

# Copy application code
COPY services/designer/app ./app

# Copy entrypoint script
COPY services/designer/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}"

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && chown -R designer:designer /app

# Set default environment variables
ENV TALE_VERSION=${VERSION} \
    DESIGNER_HOST=0.0.0.0 \
    DESIGNER_PORT=8005 \
    DESIGNER_WORKERS=1 \
    DESIGNER_LOG_LEVEL=info \
    DESIGNER_MAX_AGENT_ITERATIONS=5 \
    DO_NOT_TRACK=1


USER designer
EXPOSE 8005

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8005/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8005"]
