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
FROM ghcr.io/get-convex/convex-dashboard:903b8b96c4bceb34c62e366cf36e8f4774955e6b AS convex-dashboard

# ============================================================================
# Stage 2: Runtime — Convex backend + Dashboard + builtin seed
# ----------------------------------------------------------------------------
# Base image contains `convex-local-backend` and `generate_key` binaries.
# Must stay on Debian-based convex-backend image (glibc); Alpine would break
# the binaries. Platform service uses the same base for `generate_key`.
# ============================================================================
FROM ghcr.io/get-convex/convex-backend:903b8b96c4bceb34c62e366cf36e8f4774955e6b AS runner

WORKDIR /app

ARG SOPS_VERSION=3.9.4
# yt-dlp + Deno: pinned defaults to specific upstream releases so two
# image builds an hour apart produce byte-identical binaries. Builders
# wanting the absolute newest player-signature fixes pass an explicit
# build-arg (e.g. `--build-arg YTDLP_VERSION=2026.07.04`); ops should
# rebuild this image roughly monthly to pick up upstream fixes (the
# default pins exactly so an upgrade is a deliberate version bump, not
# a silent moving target). Empty defaults are still supported and fall
# back to resolving the `releases/latest` redirect — handy for local
# dev but discouraged for production. Resolved versions land in
# /etc/yt-dlp-version + /etc/deno-version for runtime inspection.
# Deno is required by yt-dlp's n-challenge JS solver (yt-dlp ≥ 2025.11).
ARG YTDLP_VERSION=2026.07.04
ARG DENO_VERSION=v2.5.4
# bgutil PO-token provider plugin (yt-dlp GVS tokens → dissolves YouTube's bot
# wall on flagged/datacenter IPs). MUST match the `bgutil-provider` sidecar
# image tag in compose.yml — bump both together.
ARG BGUTIL_POT_VERSION=1.3.1
# System packages, binary symlinks, app user (UID 1001 to match platform),
# and LLVM/docs stripping (~155 MB savings on the base image).
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get -o Acquire::Retries=3 update \
    && apt-get install -y --no-install-recommends \
    curl unzip tini gosu postgresql-client ca-certificates \
    jq \
    ffmpeg \
    && curl -fsSL "https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/sops-v${SOPS_VERSION}.linux.$(dpkg --print-architecture)" -o /usr/local/bin/sops && chmod +x /usr/local/bin/sops \
    # yt-dlp: per-arch asset selection + SHA256 verification against the
    # release's official SHA2-256SUMS file. Asset names use yt-dlp's own
    # naming convention, NOT dpkg arch names.
    && YTDLP_DPKG_ARCH="$(dpkg --print-architecture)" \
    && case "$YTDLP_DPKG_ARCH" in \
        amd64) YTDLP_ASSET="yt-dlp_linux" ;; \
        arm64) YTDLP_ASSET="yt-dlp_linux_aarch64" ;; \
        *) echo "Unsupported arch for yt-dlp: $YTDLP_DPKG_ARCH" >&2; exit 1 ;; \
       esac \
    # Resolve the `latest` redirect to a concrete tag ONCE, then build
    # asset + checksum URLs from the resolved tag so a release cut between
    # curls cannot land mismatched binary/sums (round-2 HIGH #21 TOCTOU).
    && if [ -z "$YTDLP_VERSION" ]; then \
        YTDLP_TAG=$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/yt-dlp/yt-dlp/releases/latest | awk -F/ '{print $NF}'); \
       else \
        YTDLP_TAG="$YTDLP_VERSION"; \
       fi \
    && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_TAG}/${YTDLP_ASSET}" -o /usr/local/bin/yt-dlp \
    && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_TAG}/SHA2-256SUMS" -o /tmp/yt-dlp.sums \
    && (cd /usr/local/bin && grep "  ${YTDLP_ASSET}$" /tmp/yt-dlp.sums | sed "s|  ${YTDLP_ASSET}$|  yt-dlp|" | sha256sum -c -) \
    && chmod 0755 /usr/local/bin/yt-dlp \
    && echo "$YTDLP_TAG" > /etc/yt-dlp-version \
    && rm -f /tmp/yt-dlp.sums \
    # Deno: required by yt-dlp's external JS runtime for n-challenge solving.
    # Per-arch zip download with checksum verify against a single resolved tag.
    && DENO_DPKG_ARCH="$(dpkg --print-architecture)" \
    && case "$DENO_DPKG_ARCH" in \
        amd64) DENO_ASSET="deno-x86_64-unknown-linux-gnu.zip" ;; \
        arm64) DENO_ASSET="deno-aarch64-unknown-linux-gnu.zip" ;; \
        *) echo "Unsupported arch for deno: $DENO_DPKG_ARCH" >&2; exit 1 ;; \
       esac \
    && if [ -z "$DENO_VERSION" ]; then \
        DENO_TAG=$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/denoland/deno/releases/latest | awk -F/ '{print $NF}'); \
       else \
        DENO_TAG="$DENO_VERSION"; \
       fi \
    # Upstream `.sha256sum` file references the original asset filename, so
    # download to that name (not `deno.zip`) and run sha256sum -c from /tmp.
    && curl -fsSL "https://github.com/denoland/deno/releases/download/${DENO_TAG}/${DENO_ASSET}" -o "/tmp/${DENO_ASSET}" \
    && curl -fsSL "https://github.com/denoland/deno/releases/download/${DENO_TAG}/${DENO_ASSET}.sha256sum" -o /tmp/deno.sums \
    && (cd /tmp && sha256sum -c deno.sums) \
    && unzip -q "/tmp/${DENO_ASSET}" -d /usr/local/bin \
    && chmod 0755 /usr/local/bin/deno \
    && echo "$DENO_TAG" > /etc/deno-version \
    && rm -f "/tmp/${DENO_ASSET}" /tmp/deno.sums \
    # bgutil PO-token provider plugin: version-pinned + SHA256-verified (like
    # yt-dlp/deno above). Unzipped under a NAMED child of the `--plugin-dirs`
    # root — yt-dlp does `iterdir()` on that root and then looks for
    # `yt_dlp_plugins/` under each child (see yt_dlp/plugins.py). Unzipping the
    # zip (which already contains `yt_dlp_plugins/`) straight into the root
    # yields `plugins/yt_dlp_plugins/…` and loads ZERO providers
    # ("Plugin directories: none"). Correct layout:
    #   /opt/yt-dlp/plugins/bgutil/yt_dlp_plugins/extractor/…
    # The token itself is served by the `bgutil-provider` compose sidecar.
    # Presence of `/opt/yt-dlp/plugins` also flips the zero-config default in
    # convex/video_links/ytdlp.ts (HAS_BAKED_YTDLP_PLUGIN).
    && mkdir -p /opt/yt-dlp/plugins/bgutil \
    && curl -fsSL "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${BGUTIL_POT_VERSION}/bgutil-ytdlp-pot-provider.zip" -o /tmp/bgutil-pot.zip \
    && echo "b8ceec7f76143da172aaf5ebeec0c2d218e5680c063b931586bca48567069b38  /tmp/bgutil-pot.zip" | sha256sum -c - \
    && unzip -q /tmp/bgutil-pot.zip -d /opt/yt-dlp/plugins/bgutil \
    && rm -f /tmp/bgutil-pot.zip \
    && echo "${BGUTIL_POT_VERSION}" > /etc/bgutil-pot-version \
    # unzip is only needed for Deno + bgutil install; remove to keep image lean
    && apt-get purge -y unzip \
    && apt-get autoremove -y \
    && mkdir -p /usr/local/share/ca-certificates \
    && chmod 755 /usr/local/share/ca-certificates \
    && chmod +x /convex/convex-local-backend /convex/generate_key \
    && ln -s /convex/convex-local-backend /usr/local/bin/convex-local-backend \
    && ln -s /convex/generate_key /usr/local/bin/generate_key \
    && groupadd --system --gid 1001 app || true \
    && useradd --system --uid 1001 --gid app app || true \
    && mkdir -p /home/app && chown app:app /home/app && chmod 755 /home/app \
    && mkdir -p /app/data/convex /app/data/default \
                /dashboard \
                /app/builtin \
                /app/system \
    && chown -R app:app /app/data /dashboard /app/builtin /app/system \
    # Strip system bloat from Convex backend base (~155 MB)
    && ARCH_LIB="/usr/lib/$(dpkg --print-architecture | sed 's/amd64/x86_64-linux-gnu/;s/arm64/aarch64-linux-gnu/')" \
    && rm -rf "${ARCH_LIB}"/libLLVM* "${ARCH_LIB}"/libclang* \
    && rm -rf /usr/lib/llvm-18 \
    && rm -rf /usr/share/doc/* /usr/share/man/* /usr/share/info/*

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
    # Module-analyze budget for `convex deploy` push (default 4s). Bumped to 10s
    # so the first cold push doesn't fail with "Function execution timed out
    # (maximum duration: ...)" on slower / CPU-loaded hosts while the backend is
    # evaluating every module's top-level code. Push-time only; not a runtime UDF limit.
    ISOLATE_ANALYZE_USER_TIMEOUT_SECONDS=10 \
    # 30 minutes for Node and V8 actions (default 5 min).
    ACTIONS_USER_TIMEOUT_SECS=1800 \
    # Higher concurrency limits.
    APPLICATION_MAX_CONCURRENT_QUERIES=32 \
    APPLICATION_MAX_CONCURRENT_MUTATIONS=32 \
    APPLICATION_MAX_CONCURRENT_V8_ACTIONS=32 \
    APPLICATION_MAX_CONCURRENT_NODE_ACTIONS=32 \
    # Index retention window (seconds; default upstream is 4*60=240s). Bumped to
    # 24h so reads pinned to an older snapshot — slow paginated queries, a
    # migration/export paginating at a consistent timestamp, long-lived
    # subscriptions — don't get forced to restart with "reads too far behind"
    # once they fall outside the default 4-minute window. Trade-off: a larger
    # window keeps more index tombstones around between sweeps, so index scans on
    # high-churn tables do more work (upstream knobs.rs warns of UDF slowdowns
    # with many tombstones). Override at runtime via .env if churn-driven query
    # latency becomes an issue. DOCUMENT_RETENTION_DELAY (default 14d) is separate.
    INDEX_RETENTION_DELAY=86400 \
    DO_NOT_TRACK=1 \
    # CA cert path for self-signed mode (entrypoint checks if file exists)
    CADDY_CA_CERT_PATH=/caddy-data/caddy/pki/authorities/local/root.crt \
    # Root config directory consumed by Convex actions (file-based configs).
    # Sub-dirs (agents/workflows/connectors/providers) are derived inside
    # Convex via `convex/*/file_utils.ts` — no need to set them explicitly.
    TALE_CONFIG_DIR=/app/data
    # NOTE: RAG_AUTH_TOKEN is not baked into the image. If set on BOTH
    # the platform/convex container and the RAG container (values must
    # match), every platform-to-RAG request carries
    # `Authorization: Bearer ${RAG_AUTH_TOKEN}` and RAG rejects mismatches
    # with 401. If unset, RAG runs unauthenticated — only safe when the
    # RAG port is bound to a private network. Auth is presence-based:
    # there is no dev-only fallback token.

# ----------------------------------------------------------------------------
# Convex Dashboard (Next.js standalone) — served as /convex-dashboard via Caddy
# ----------------------------------------------------------------------------
COPY --from=convex-dashboard --chown=app:app /app /dashboard

# ----------------------------------------------------------------------------
# Builtin seed assets (one-time copy on fresh volume; .history/ preserves user edits).
# The per-org seed catalog is configs/platform/custom/ (generic — its children
# ARE the domains, no org level); seeder reads $TALE_CONFIG_BUILTIN_DIR/<domain>.
# ----------------------------------------------------------------------------
COPY --chown=app:app configs/platform/custom/ /app/builtin/

# System config (providers/models/harnesses/connectors) is org-independent and
# read by 'use node' actions at $TALE_CONFIG_SYSTEM_DIR (set on the platform
# image, synced into the deployment env). A container has no repo checkout, so
# unlike host dev it cannot fall back to walking up to configs/platform/system.
COPY --chown=app:app configs/platform/system/ /app/system/

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
