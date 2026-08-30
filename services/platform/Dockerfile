# syntax=docker/dockerfile:1.7
# Tale Platform Dockerfile
# Builds the Vite SPA (web tier) and the Postgres backend (api/worker roles)
# from ONE image — they share their wire contracts, so they must never
# version-skew. Plain Debian base: the Convex backend image this used to
# build on retired with the runtime it carried.

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

# Bun binary for all stages
FROM oven/bun:1.3.12 AS bun-bin

# Node binary for the 0.5 backend roles (api/worker). The backend runs its .ts
# sources directly via Node's type stripping (>= 22.18); only the binary is
# needed — no npm, no corepack.
FROM node:22.21.1-bookworm-slim AS node-bin

# ============================================================================
# Stage 1: Dependencies
# ============================================================================
FROM debian:bookworm-slim AS workspace-deps

COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY packages/e2e/package.json ./packages/e2e/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY services/platform/package.json ./services/platform/
COPY services/db/package.json ./services/db/
COPY services/proxy/package.json ./services/proxy/
COPY services/sandbox/package.json ./services/sandbox/
COPY services/sandbox-runtime/daemon/package.json ./services/sandbox-runtime/daemon/
COPY services/web/package.json ./services/web/
COPY services/docs/package.json ./services/docs/
COPY tools/cli/package.json ./tools/cli/
COPY tools/plop/package.json ./tools/plop/
COPY tools/opengrep/package.json ./tools/opengrep/
COPY patches/ ./patches/

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get -o Acquire::Retries=3 update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && HUSKY=0 bun install

# ============================================================================
# Stage 2: Builder
# ============================================================================
FROM debian:bookworm-slim AS builder

COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

WORKDIR /app

# In hoisted mode all dependencies are in root node_modules
COPY --from=workspace-deps /app/node_modules ./node_modules

COPY tsconfig.base.json ./tsconfig.base.json

COPY services/platform/vite.config.ts \
     services/platform/tsconfig.json \
     services/platform/postcss.config.mjs \
     services/platform/tailwind.config.ts \
     services/platform/index.html \
     services/platform/vite-env.d.ts \
     services/platform/tsr.config.json \
     services/platform/package.json \
     ./services/platform/

COPY packages/ui ./packages/ui
# @tale/shared backs the convex logger + the knowledge config/db/utils re-export
# shims; convex deploy bundles its source at runtime, so the full source (not
# just package.json) must be present for the `@tale/shared/*` subpath imports to
# resolve. Mirrors the packages/ui copy above.
COPY packages/shared ./packages/shared

COPY services/platform/app ./services/platform/app
# lib/agent-adapters lives here now (convex run_agent.ts bundles it at deploy
# time), so the lib copy below carries it into the builder.
COPY services/platform/lib ./services/platform/lib
COPY services/platform/convex ./services/platform/convex
COPY services/platform/public ./services/platform/public
COPY services/platform/types ./services/platform/types
COPY services/platform/messages ./services/platform/messages
COPY services/platform/vite-plugins ./services/platform/vite-plugins
COPY services/platform/scripts ./services/platform/scripts
# Knowledge-corpus DDL — the dev image inherits this stage, and preparing a
# new corpus applies these at runtime (see the runner stage's note).
COPY services/db/migrations/knowledge-db ./services/db/migrations/knowledge-db

COPY services/platform/docker-entrypoint.sh \
     services/platform/env.sh \
     ./services/platform/

# status-probe.ts is imported by vite-plugins/serve-status.ts (loaded via
# vite.config.ts) so it must be present before `vite build` for rolldown
# to resolve the static import, even though the plugin itself is dev-only.
# server.ts also imports it for the production /status handler.
COPY services/platform/status-probe.ts ./services/platform/

ENV NODE_ENV=production

# Build the SPA, then precompile the SEO + LLM artifact set into
# `dist-seo/`. The runtime stage serves these via @tale/ui's precompiled
# SEO server, so no source markdown is needed at request time.
WORKDIR /app/services/platform
RUN bun --bun vite build \
    && bun scripts/prerender-boot-shell.tsx \
    && bun --bun /app/packages/ui/bin/seo-compile.ts ./scripts/seo.config.ts --out dist-seo
WORKDIR /app

# Server-side files copied after vite build to avoid invalidating the build cache
COPY services/platform/server.ts \
     services/platform/telemetry.ts \
     services/platform/sla-targets.ts \
     ./services/platform/

# 0.5 backend (Hono API + pg-boss worker on Postgres) — server-side only, so
# copied after the vite build for the same cache reason as server.ts above.
COPY services/platform/backend ./services/platform/backend

# ============================================================================
# Stage 2b: Dev (local hot-reload image — NOT used by prod/CI)
# ----------------------------------------------------------------------------
# Selected only by compose.dev.yml (`build.target: dev`). Unlike the pruned
# runner, this keeps the builder intact: full (unpruned) node_modules — vite +
# the rolldown bundler + lightningcss + @parcel/watcher — and the complete
# frontend source under /app/services/platform. That is what lets the entrypoint
# run `vite build --watch` (frontend hot reload) and `convex dev` (function hot
# push) against the host source bind-mounted by compose.dev.yml. The image ships
# the already-built dist/ from the builder, so server.ts serves immediately
# while the first watch rebuild runs in the background.
#
# Runtime extras the pruned runner installs but the builder lacks: curl (the
# entrypoint's health waits), tini (PID 1 signal handling), and a writable
# /home/app. The container runs as root (see TALE_DEV_NO_PRIVDROP) so no app
# user / chown dance is needed.
#
# It also symlinks node_modules into the platform workspace: deps are hoisted
# to /app/node_modules (monorepo root), and a tool running from
# /app/services/platform resolves against <project-root>/node_modules. The
# pruned runner is a flat /app with node_modules already at the project root,
# so it needs no link.
# ============================================================================
FROM builder AS dev

ARG VERSION=dev

# Node for the 0.5 backend roles; the dev image keeps sources at the workspace
# path, so the entrypoint's role dispatch needs the dir override below.
COPY --from=node-bin /usr/local/bin/node /usr/local/bin/node
ENV TALE_BACKEND_DIR=/app/services/platform/backend

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get -o Acquire::Retries=3 update \
    && apt-get install -y --no-install-recommends curl tini ca-certificates iptables \
    && mkdir -p /home/app && chmod 777 /home/app \
    && ln -sfn /app/node_modules /app/services/platform/node_modules \
    && chmod +x /app/services/platform/docker-entrypoint.sh

# convex.json carries `node.externalPackages`; `convex deploy`/`convex dev` read
# it from the platform dir. Absent → heavy node-only libs (jsdom, …) get bundled
# inline and the push fails at analyze. (The runner copies it for the same
# reason.)
COPY services/platform/convex.json /app/services/platform/convex.json

# Override the builder's production defaults. These mirror the runner's runtime
# ENV (so the entrypoint behaves identically) except NODE_ENV, which gates the
# dev hot-reload watchers, and TALE_DEV_NO_PRIVDROP, which keeps the container
# as root for bind-mount write access.
ENV NODE_ENV=development \
    TALE_VERSION=${VERSION} \
    PORT=3000 \
    HOSTNAME="0.0.0.0" \
    CONVEX_URL=http://convex:3210 \
    SANDBOX_STORAGE_INTERNAL_BASE_URL=http://convex:3210 \
    INSTANCE_NAME=tale_platform \
    DO_NOT_TRACK=1 \
    TALE_CONFIG_DIR=/app/data \
    TALE_CONFIG_BUILTIN_DIR=/app/builtin \
    TALE_CONFIG_SYSTEM_DIR=/app/system \
    KNOWLEDGE_MIGRATIONS_DIR=/app/services/db/migrations/knowledge-db \
    TALE_DEV_NO_PRIVDROP=1

WORKDIR /app/services/platform

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/services/platform/docker-entrypoint.sh"]

# ============================================================================
# Stage 3: Pruner
# ============================================================================
FROM builder AS pruner

COPY --from=workspace-deps /app/package.json /app/bun.lock /app/bunfig.toml /tmp/workspace/
# bun resolves the whole workspace graph even for --production installs; every
# manifest stage 1 copies must exist here too or install fails ("Workspace
# dependency not found") before dev deps are even pruned.
COPY --from=workspace-deps /app/packages/e2e/package.json /tmp/workspace/packages/e2e/
COPY --from=workspace-deps /app/packages/shared/package.json /tmp/workspace/packages/shared/
COPY --from=workspace-deps /app/packages/ui/package.json /tmp/workspace/packages/ui/
COPY --from=workspace-deps /app/services/platform/package.json /tmp/workspace/services/platform/
COPY --from=workspace-deps /app/services/db/package.json /tmp/workspace/services/db/
COPY --from=workspace-deps /app/services/proxy/package.json /tmp/workspace/services/proxy/
COPY --from=workspace-deps /app/services/sandbox/package.json /tmp/workspace/services/sandbox/
COPY --from=workspace-deps /app/services/sandbox-runtime/daemon/package.json /tmp/workspace/services/sandbox-runtime/daemon/
COPY --from=workspace-deps /app/services/web/package.json /tmp/workspace/services/web/
COPY --from=workspace-deps /app/services/docs/package.json /tmp/workspace/services/docs/
COPY --from=workspace-deps /app/tools/cli/package.json /tmp/workspace/tools/cli/
COPY --from=workspace-deps /app/tools/plop/package.json /tmp/workspace/tools/plop/
COPY --from=workspace-deps /app/patches/ /tmp/workspace/patches/

WORKDIR /tmp/workspace
RUN HUSKY=0 bun install --production \
    && rm -rf /app/node_modules \
    && mv /tmp/workspace/node_modules /app/node_modules \
    && rm -rf /app/node_modules/@swc/core* \
              /app/node_modules/lightningcss* \
              /app/node_modules/@parcel/watcher* \
              /app/node_modules/typescript \
              /app/node_modules/@types \
              /app/node_modules/@storybook \
              /app/node_modules/storybook \
              /app/node_modules/@vitest \
              /app/node_modules/vitest \
              /app/node_modules/@rolldown \
              /app/node_modules/playwright-core \
              /app/node_modules/core-js-pure \
               /app/node_modules/tsx \
    2>/dev/null || true \
    && find /app/node_modules -type d \( -name "*-musl*" -o -name "*linuxmusl*" \) -exec rm -rf {} + 2>/dev/null || true \
    && find /app/node_modules -type f -name "*.map" -delete 2>/dev/null || true \
    && find /app/node_modules -type d \( -name "test" -o -name "tests" -o -name "__tests__" -o -name "__mocks__" -o -name "coverage" \) -exec rm -rf {} + 2>/dev/null || true \
    && find /app/node_modules -type f \( -name "*.md" -o -name "*.markdown" -o -name "CHANGELOG*" -o -name "LICENSE*" -o -name "README*" \) -delete 2>/dev/null || true \
    && find /app/node_modules -type f \( -name "*.d.ts" -o -name "*.d.ts.map" -o -name "*.d.mts" \) -delete 2>/dev/null || true \
    && find /app/node_modules -type d \( -name "docs" -o -name "doc" -o -name "example" -o -name "examples" \) 2>/dev/null \
       | while IFS= read -r d; do [ -f "${d%/*}/package.json" ] && rm -rf "$d"; done || true \
    && find /app/node_modules -type d -empty -delete 2>/dev/null || true

# ============================================================================
# Stage 4: Runtime
# ----------------------------------------------------------------------------
# One image, three roles (TALE_ROLE): the web tier (Vite + TanStack Start) and
# the backend's api/worker. It therefore carries BOTH toolchains — the SPA
# server and the media pipeline the ingest lanes shell out to (ffmpeg, yt-dlp
# + its Deno JS runtime, the bgutil PO-token plugin), which used to live in
# the retired Convex image.
# ============================================================================
FROM debian:bookworm-slim AS runner

COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun
# Node runs the 0.5 backend roles (api/worker); Bun keeps running server.ts.
COPY --from=node-bin /usr/local/bin/node /usr/local/bin/node
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

WORKDIR /app

ARG SOPS_VERSION=3.9.4
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get -o Acquire::Retries=3 update \
    && apt-get install -y --no-install-recommends \
    curl tini gosu postgresql-client ca-certificates iptables iproute2 \
    && curl -fsSL "https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/sops-v${SOPS_VERSION}.linux.$(dpkg --print-architecture)" -o /usr/local/bin/sops && chmod +x /usr/local/bin/sops \
    && mkdir -p /usr/local/share/ca-certificates \
    && chmod 755 /usr/local/share/ca-certificates \
    && groupadd --system --gid 1001 app || true \
    && useradd --system --uid 1001 --gid app app || true \
    && mkdir -p /home/app && chmod 777 /home/app \
    && rm -rf /usr/share/doc/* /usr/share/man/* /usr/share/info/*

# ----------------------------------------------------------------------------
# Media toolchain (video ingest + transcription)
# ----------------------------------------------------------------------------
# The ingest lanes shell out to these, so they ship WITH the process that runs
# them — they moved here from the retired Convex image, pins and checksum
# verification unchanged:
#   * ffmpeg      — audio extract/compress for the transcription pipeline.
#   * yt-dlp      — metadata + caption + audio fetch. Pinned so two builds an
#                   hour apart are byte-identical; ops rebuild ~monthly for
#                   upstream player fixes. An empty ARG falls back to
#                   `releases/latest` (handy in dev, discouraged in prod).
#   * deno        — yt-dlp's JS runtime for the n-challenge solver (>= 2025.11).
#   * bgutil      — PO-token provider plugin; dissolves YouTube's bot wall on
#                   datacenter IPs. MUST match the `bgutil-provider` sidecar
#                   image tag in compose.yml — bump both together.
# Resolved versions land in /etc/yt-dlp-version + /etc/deno-version.
ARG YTDLP_VERSION=2026.07.04
ARG DENO_VERSION=v2.5.4
ARG BGUTIL_POT_VERSION=1.3.1
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get -o Acquire::Retries=3 update \
    && apt-get install -y --no-install-recommends unzip jq ffmpeg \
    # yt-dlp: per-arch asset selection + SHA256 verification against the
    # release's official SHA2-256SUMS. Asset names are yt-dlp's own, NOT
    # dpkg arch names.
    && YTDLP_DPKG_ARCH="$(dpkg --print-architecture)" \
    && case "$YTDLP_DPKG_ARCH" in \
        amd64) YTDLP_ASSET="yt-dlp_linux" ;; \
        arm64) YTDLP_ASSET="yt-dlp_linux_aarch64" ;; \
        *) echo "Unsupported arch for yt-dlp: $YTDLP_DPKG_ARCH" >&2; exit 1 ;; \
       esac \
    # Resolve the `latest` redirect to a concrete tag ONCE, then build asset +
    # checksum URLs from it, so a release cut between curls cannot land a
    # mismatched binary/sums pair.
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
    # Deno: per-arch zip + checksum verify against a single resolved tag. The
    # upstream `.sha256sum` references the original asset filename, so keep it.
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
    && curl -fsSL "https://github.com/denoland/deno/releases/download/${DENO_TAG}/${DENO_ASSET}" -o "/tmp/${DENO_ASSET}" \
    && curl -fsSL "https://github.com/denoland/deno/releases/download/${DENO_TAG}/${DENO_ASSET}.sha256sum" -o /tmp/deno.sums \
    && (cd /tmp && sha256sum -c deno.sums) \
    && unzip -q "/tmp/${DENO_ASSET}" -d /usr/local/bin \
    && chmod 0755 /usr/local/bin/deno \
    && echo "$DENO_TAG" > /etc/deno-version \
    && rm -f "/tmp/${DENO_ASSET}" /tmp/deno.sums \
    # bgutil plugin: unzipped under a NAMED child of the `--plugin-dirs` root.
    # yt-dlp iterdir()s that root and looks for `yt_dlp_plugins/` under each
    # child, so unzipping straight into the root loads ZERO providers.
    # Presence of `/opt/yt-dlp/plugins` also flips the zero-config default in
    # the ingest lane (HAS_BAKED_YTDLP_PLUGIN).
    && mkdir -p /opt/yt-dlp/plugins/bgutil \
    && curl -fsSL "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${BGUTIL_POT_VERSION}/bgutil-ytdlp-pot-provider.zip" -o /tmp/bgutil-pot.zip \
    && echo "b8ceec7f76143da172aaf5ebeec0c2d218e5680c063b931586bca48567069b38  /tmp/bgutil-pot.zip" | sha256sum -c - \
    && unzip -q /tmp/bgutil-pot.zip -d /opt/yt-dlp/plugins/bgutil \
    && rm -f /tmp/bgutil-pot.zip \
    && echo "${BGUTIL_POT_VERSION}" > /etc/bgutil-pot-version \
    # unzip was only needed for the Deno + bgutil archives.
    && apt-get purge -y unzip \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*


# Re-declare VERSION arg (ARGs don't persist after FROM)
ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-platform" \
      org.opencontainers.image.description="Tale Platform — TanStack Start SPA + Convex Backend" \
      org.opencontainers.image.source="https://github.com/tale-project/tale" \
      org.opencontainers.image.vendor="Tale" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    TALE_VERSION=${VERSION} \
    PORT=3000 \
    HOSTNAME="0.0.0.0" \
    # Convex service DNS name (compose-internal). Overridable via CONVEX_URL.
    CONVEX_URL=http://convex:3210 \
    # Origin that the sandbox spawner uses to POST presigned-URL output
    # uploads back to Convex. Read by Convex Node actions via process.env
    # in toSandboxStorageUrl() (see convex/lib/helpers/public_storage_url.ts).
    # Node actions only see vars that this container's entrypoint pushes
    # into Convex's deployment env via `convex env set`, so baking the
    # value into the platform image is what guarantees the rewrite has
    # a reachable origin on every docker deploy. Direct to convex:3210
    # rather than the Caddy proxy because Caddy is HTTPS-only with a
    # self-signed cert and would 308-redirect plain HTTP POSTs.
    SANDBOX_STORAGE_INTERNAL_BASE_URL=http://convex:3210 \
    # INSTANCE_NAME is shared with convex service; platform uses it + INSTANCE_SECRET
    # to compute the admin key for `bunx convex env set` and `bunx convex deploy`.
    INSTANCE_NAME=tale_platform \
    DO_NOT_TRACK=1 \
    # Semantic value of the file-config parent path inside the convex
    # container. Platform forces this at push time in docker-entrypoint.sh
    # (to tombstone any stale host-side `.env` value). Under the org-first
    # layout, every per-domain config dir is derived as
    # $TALE_CONFIG_DIR/<orgSlug>/<domain>/ — e.g.
    # /app/data/default/agents/, /app/data/default/providers/, etc.
    # The previous per-domain env vars (AGENTS_DIR, …) are no longer
    # honored; the entrypoint actively purges them from Convex on every
    # boot.
    TALE_CONFIG_DIR=/app/data \
    # Read-only builtin catalog baked into the convex image (see
    # services/convex/Dockerfile). Declared here because Convex Node
    # actions only see env vars that this container pushes to Convex's
    # deployment env via the entrypoint's `convex env set` loop — even
    # though the path points at files inside the *convex* container.
    # Generic catalog — its children ARE the domains
    # ($TALE_CONFIG_BUILTIN_DIR/<domain>/), with no org level and no fallback.
    # Every org is seeded from it. See convex/organizations/scaffold.ts.
    TALE_CONFIG_BUILTIN_DIR=/app/builtin \
    # Org-independent system config (providers/models/harnesses/connectors),
    # read by 'use node' actions. Same push-to-Convex-env path as above; a
    # container has no repo checkout to fall back on. Baked at /app/system in
    # the convex image (services/convex/Dockerfile).
    TALE_CONFIG_SYSTEM_DIR=/app/system \
    # Where the corpus DDL lives in this image (copied below). Set
    # explicitly because `findMigrationsDir`'s fallback walks up the module
    # path looking for a repo checkout, and a container has none.
    KNOWLEDGE_MIGRATIONS_DIR=/app/db/migrations/knowledge-db

COPY --from=pruner --chown=app:app /app/services/platform/dist ./dist
COPY --from=pruner --chown=app:app /app/services/platform/dist-seo ./dist-seo
COPY --from=pruner --chown=app:app \
     /app/services/platform/server.ts \
     /app/services/platform/telemetry.ts \
     /app/services/platform/sla-targets.ts \
     /app/services/platform/status-probe.ts \
     ./
COPY --from=pruner --chown=app:app /app/services/platform/convex ./convex
# convex.json carries `node.externalPackages`; the runtime `convex deploy` (run
# from /app) reads it from /app/convex.json. Without it the heavy node-only libs
# (jsdom, …) get bundled inline and the push fails at analyze.
COPY --chown=app:app services/platform/convex.json ./convex.json
COPY --from=pruner --chown=app:app /app/services/platform/lib ./lib
# 0.5 backend sources (run unbundled by Node via type stripping; role dispatch
# in docker-entrypoint.sh execs `node /app/backend/main.ts`).
COPY --from=pruner --chown=app:app /app/services/platform/backend ./backend
COPY --from=pruner --chown=app:app /app/node_modules ./node_modules
# Workspace packages backing the `@tale/*` symlinks in node_modules. The
# platform runs `bun server.ts` unbundled, so server-side imports of
# `@tale/ui/seo/*` resolve at runtime through these directories — the
# docs + web Dockerfiles bundle their server.ts and don't need this.
COPY --from=pruner --chown=app:app /app/packages ./packages
COPY --from=pruner --chown=app:app /app/services/platform/package.json ./
# Knowledge-corpus DDL. Preparing a NEW corpus (the deployment default on
# first boot, and every BYO per-org database) applies these at runtime, and
# `findMigrationsDir` walks up from the module path — which finds nothing in
# a container. Without them the bootstrap degrades to "apply them yourself",
# so the image ships them and names the directory in KNOWLEDGE_MIGRATIONS_DIR
# below. They are plain .sql text; the `knowledge-db` container applies the
# same tree with dbmate for the default database it owns.
COPY --chown=app:app services/db/migrations/knowledge-db ./db/migrations/knowledge-db
COPY --from=pruner --chown=app:app /app/services/platform/docker-entrypoint.sh /app/services/platform/env.sh ./

RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]

# =============================================================================
# Stage 5: SQUASH — flatten layers to eliminate Docker layer bloat
# =============================================================================
FROM scratch
COPY --from=runner / /

ARG VERSION=dev

WORKDIR /app

# Run as root so entrypoint can fix volume ownership before dropping to app user
USER root

# Re-declare all ENV vars (FROM scratch drops upstream ENV directives)
ENV NODE_ENV=production \
    TALE_VERSION=${VERSION} \
    PORT=3000 \
    HOSTNAME="0.0.0.0" \
    CONVEX_URL=http://convex:3210 \
    SANDBOX_STORAGE_INTERNAL_BASE_URL=http://convex:3210 \
    INSTANCE_NAME=tale_platform \
    DO_NOT_TRACK=1 \
    TALE_CONFIG_DIR=/app/data \
    TALE_CONFIG_BUILTIN_DIR=/app/builtin \
    TALE_CONFIG_SYSTEM_DIR=/app/system

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]
