# syntax=docker/dockerfile:1.22
# ============================================================================
# Tale Convex Service
# ----------------------------------------------------------------------------
# Runs the Convex local backend + Convex Dashboard as an independent service.
# Platform service connects remotely via http://convex:3210 and pushes
# functions + env vars using `bunx convex deploy / env set` (push model).
#
# IMPORTANT: Build context MUST be the repo root, not services/convex/:
#   docker build -f services/convex/Dockerfile .
# ============================================================================

# ============================================================================
# Stage 1: Convex Dashboard assets (Next.js standalone build)
# ============================================================================
FROM ghcr.io/get-convex/convex-dashboard:5f66740ae8dd506577d27294adc55b81e4fbe91b AS convex-dashboard

# ============================================================================
# Stage 2: Runtime — Convex backend + Dashboard + builtin seed
# ----------------------------------------------------------------------------
# Base image contains `convex-local-backend` and `generate_key` binaries.
# Must stay on Debian-based convex-backend image (glibc); Alpine would break
# the binaries. Platform service uses the same base for `generate_key`.
# ============================================================================
FROM ghcr.io/get-convex/convex-backend:5f66740ae8dd506577d27294adc55b81e4fbe91b AS runner

WORKDIR /app

ARG SOPS_VERSION=3.9.4
# System packages, binary symlinks, app user (UID 1001 to match platform),
# and LLVM/docs stripping (~155 MB savings on the base image).
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl tini gosu postgresql-client ca-certificates \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL "https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/sops-v${SOPS_VERSION}.linux.$(dpkg --print-architecture)" -o /usr/local/bin/sops && chmod +x /usr/local/bin/sops \
    && mkdir -p /usr/local/share/ca-certificates \
    && chmod 755 /usr/local/share/ca-certificates \
    && chmod +x /convex/convex-local-backend /convex/generate_key \
    && ln -s /convex/convex-local-backend /usr/local/bin/convex-local-backend \
    && ln -s /convex/generate_key /usr/local/bin/generate_key \
    && groupadd --system --gid 1001 app || true \
    && useradd --system --uid 1001 --gid app app || true \
    && mkdir -p /home/app && chown app:app /home/app && chmod 755 /home/app \
    && mkdir -p /app/data/convex /app/data/agents /app/data/workflows /app/data/integrations /app/data/providers /app/data/branding \
                /dashboard \
                /app/agents-builtin /app/workflows-builtin /app/integrations-builtin /app/providers-builtin /app/branding-builtin \
    && chown -R app:app /app/data /dashboard /app/agents-builtin /app/workflows-builtin /app/integrations-builtin /app/providers-builtin /app/branding-builtin \
    # Strip system bloat from Convex backend base (~155 MB)
    && ARCH_LIB="/usr/lib/$(dpkg --print-architecture | sed 's/amd64/x86_64-linux-gnu/;s/arm64/aarch64-linux-gnu/')" \
    && rm -rf "${ARCH_LIB}"/libLLVM* "${ARCH_LIB}"/libclang* \
    && rm -rf /usr/lib/llvm-18 \
    && rm -rf /usr/share/doc/* /usr/share/man/* /usr/share/info/* \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/* \
    && apt-get clean 2>/dev/null || true

ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-convex" \
      org.opencontainers.image.description="Tale Convex Service — local backend + Dashboard" \
      org.opencontainers.image.source="https://github.com/tale-project/tale" \
      org.opencontainers.image.vendor="Tale" \
      org.opencontainers.image.licenses="MIT"

# Convex backend tuning (defaults; can be overridden at runtime if needed).
# These are carried over 1:1 from the old platform Dockerfile.
ENV NODE_ENV=production \
    TALE_VERSION=${VERSION} \
    CONVEX_BACKEND_PORT=3210 \
    CONVEX_SITE_PROXY_PORT=3211 \
    CONVEX_DASHBOARD_PORT=6791 \
    DASHBOARD_BASE_PATH=/convex-dashboard \
    INSTANCE_NAME=tale_platform \
    # Increase UDF timeout from default 1s to 5s to handle thundering herd on
    # reconnect (idle tab resubscribes all queries at once).
    DATABASE_UDF_USER_TIMEOUT_SECONDS=5 \
    # Increase V8 isolate memory thresholds to reduce cold-start latency spikes.
    # 256MB user heap + 128MB extra = 384MB total.
    ISOLATE_MAX_USER_HEAP_SIZE=268435456 \
    ISOLATE_MAX_HEAP_EXTRA_SIZE=134217728 \
    # Keep warm isolates alive up to 1h idle / 4h lifetime.
    ISOLATE_IDLE_TIMEOUT_SECONDS=3600 \
    ISOLATE_MAX_LIFETIME_SECONDS=14400 \
    # 30 minutes for Node and V8 actions (default 5 min).
    ACTIONS_USER_TIMEOUT_SECS=1800 \
    # Higher concurrency limits.
    APPLICATION_MAX_CONCURRENT_QUERIES=32 \
    APPLICATION_MAX_CONCURRENT_MUTATIONS=32 \
    APPLICATION_MAX_CONCURRENT_V8_ACTIONS=32 \
    APPLICATION_MAX_CONCURRENT_NODE_ACTIONS=32 \
    DO_NOT_TRACK=1 \
    # CA cert path for self-signed mode (entrypoint checks if file exists)
    CADDY_CA_CERT_PATH=/caddy-data/caddy/pki/authorities/local/root.crt \
    # Root config directory consumed by Convex actions (file-based configs).
    # Sub-dirs (agents/workflows/integrations/providers) are derived inside
    # Convex via `convex/*/file_utils.ts` — no need to set them explicitly.
    TALE_CONFIG_DIR=/app/data

# ----------------------------------------------------------------------------
# Convex Dashboard (Next.js standalone) — served as /convex-dashboard via Caddy
# ----------------------------------------------------------------------------
COPY --from=convex-dashboard --chown=app:app /app /dashboard

# ----------------------------------------------------------------------------
# Builtin seed assets (one-time copy on fresh volume; .history/ preserves user edits).
# Sources come from repo-root examples/ (same as platform Dockerfile).
# ----------------------------------------------------------------------------
COPY --chown=app:app examples/agents/       /app/agents-builtin/
COPY --chown=app:app examples/workflows/    /app/workflows-builtin/
COPY --chown=app:app examples/integrations/ /app/integrations-builtin/
COPY --chown=app:app examples/providers/    /app/providers-builtin/
COPY --chown=app:app examples/branding/     /app/branding-builtin/

# ----------------------------------------------------------------------------
# Entrypoint scripts
# ----------------------------------------------------------------------------
COPY --chown=app:app services/convex/docker-entrypoint.sh services/convex/env.sh ./
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3210 3211 6791

# Docker healthcheck runs as container user; checks both /version and the
# readiness marker written by entrypoint after seed completes.
HEALTHCHECK --interval=5s --timeout=3s --retries=3 --start-period=60s \
  CMD curl -sf http://localhost:${CONVEX_BACKEND_PORT}/version && [ -f /tmp/convex-ready ] || exit 1

# Run as root so entrypoint can fix volume ownership before dropping to app user.
USER root

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]
