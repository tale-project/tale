# Tale Platform Dockerfile
# Builds the Vite SPA + Convex Backend with multi-stage optimization

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

# Bun binary for all stages
FROM oven/bun:1.3.12 AS bun-bin

# ============================================================================
# Stage 1: Dependencies
# ============================================================================
FROM ghcr.io/get-convex/convex-backend:5f66740ae8dd506577d27294adc55b81e4fbe91b AS workspace-deps

COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY docs/package.json ./docs/
COPY packages/tale_knowledge/package.json ./packages/tale_knowledge/
COPY packages/tale_shared/package.json ./packages/tale_shared/
COPY packages/tale_telemetry/package.json ./packages/tale_telemetry/
COPY services/platform/package.json ./services/platform/
COPY services/crawler/package.json ./services/crawler/
COPY services/rag/package.json ./services/rag/
COPY services/db/package.json ./services/db/
COPY services/proxy/package.json ./services/proxy/
COPY tools/cli/package.json ./tools/cli/
COPY patches/ ./patches/

RUN sed -i -E 's|(security|archive)\.ubuntu\.com/ubuntu|azure.archive.ubuntu.com/ubuntu|g' \
        /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list 2>/dev/null || true \
    && apt-get -o Acquire::Retries=5 update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && HUSKY=0 bun install

# ============================================================================
# Stage 2: Builder
# ============================================================================
FROM ghcr.io/get-convex/convex-backend:5f66740ae8dd506577d27294adc55b81e4fbe91b AS builder

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
     services/platform/components.json \
     services/platform/package.json \
     ./services/platform/

COPY services/platform/app ./services/platform/app
COPY services/platform/lib ./services/platform/lib
COPY services/platform/convex ./services/platform/convex
COPY services/platform/public ./services/platform/public
COPY services/platform/types ./services/platform/types
COPY services/platform/messages ./services/platform/messages
COPY services/platform/vite-plugins ./services/platform/vite-plugins

COPY services/platform/docker-entrypoint.sh \
     services/platform/generate-admin-key.sh \
     services/platform/reset-owner.sh \
     services/platform/reset-owner.ts \
     services/platform/env.sh \
     ./services/platform/

ENV NODE_ENV=production

RUN cd services/platform && bun --bun vite build

# Server-side files copied after vite build to avoid invalidating the build cache
COPY services/platform/server.ts \
     services/platform/telemetry.ts \
     services/platform/convex-metrics.ts \
     ./services/platform/

# ============================================================================
# Stage 3: Pruner
# ============================================================================
FROM builder AS pruner

COPY --from=workspace-deps /app/package.json /app/bun.lock /app/bunfig.toml /tmp/workspace/
COPY --from=workspace-deps /app/docs/package.json /tmp/workspace/docs/
COPY --from=workspace-deps /app/packages/tale_knowledge/package.json /tmp/workspace/packages/tale_knowledge/
COPY --from=workspace-deps /app/packages/tale_shared/package.json /tmp/workspace/packages/tale_shared/
COPY --from=workspace-deps /app/packages/tale_telemetry/package.json /tmp/workspace/packages/tale_telemetry/
COPY --from=workspace-deps /app/services/platform/package.json /tmp/workspace/services/platform/
COPY --from=workspace-deps /app/services/crawler/package.json /tmp/workspace/services/crawler/
COPY --from=workspace-deps /app/services/rag/package.json /tmp/workspace/services/rag/
COPY --from=workspace-deps /app/services/db/package.json /tmp/workspace/services/db/
COPY --from=workspace-deps /app/services/proxy/package.json /tmp/workspace/services/proxy/
COPY --from=workspace-deps /app/tools/cli/package.json /tmp/workspace/tools/cli/
COPY --from=workspace-deps /app/patches/ /tmp/workspace/patches/

RUN cd /tmp/workspace && HUSKY=0 bun install --production \
    && rm -rf /app/node_modules \
    && mv /tmp/workspace/node_modules /app/node_modules \
    && rm -rf /app/node_modules/@swc/core* \
              /app/node_modules/lightningcss* \
              /app/node_modules/@parcel/watcher* \
              /app/node_modules/typescript \
              /app/node_modules/@types \
              /app/node_modules/@storybook \
              /app/node_modules/storybook \
              /app/node_modules/pdfjs-dist/legacy \
              /app/node_modules/@vitest \
              /app/node_modules/vitest \
              /app/node_modules/@rolldown \
              /app/node_modules/playwright-core \
              /app/node_modules/core-js-pure \
               /app/node_modules/tsx \
               /app/node_modules/jsdom \
    2>/dev/null || true \
    && find /app/node_modules -type d \( -name "*-musl*" -o -name "*linuxmusl*" \) -exec rm -rf {} + 2>/dev/null || true \
    && find /app/node_modules -type f -name "*.map" -delete 2>/dev/null || true \
    && find /app/node_modules -type d \( -name "test" -o -name "tests" -o -name "__tests__" -o -name "__mocks__" -o -name "coverage" \) -exec rm -rf {} + 2>/dev/null || true \
    && find /app/node_modules -type f \( -name "*.md" -o -name "*.markdown" -o -name "CHANGELOG*" -o -name "LICENSE*" -o -name "README*" \) -delete 2>/dev/null || true \
    && find /app/node_modules -type f \( -name "*.d.ts" -o -name "*.d.ts.map" -o -name "*.d.mts" \) -delete 2>/dev/null || true \
    && find /app/node_modules -type d \( -name "docs" -o -name "doc" -o -name "example" -o -name "examples" \) -exec rm -rf {} + 2>/dev/null || true \
    && find /app/node_modules -type d -empty -delete 2>/dev/null || true

# ============================================================================
# Stage 4: Runtime
# ----------------------------------------------------------------------------
# Platform container runs Vite + TanStack Start only.
# Convex backend + Dashboard live in the sibling `convex` service (see
# services/convex/Dockerfile). Platform KEEPS the convex-backend base so
# `generate_key` (glibc Rust binary) is available for computing the admin
# key used when pushing functions/env vars to the remote convex service.
# ============================================================================
FROM ghcr.io/get-convex/convex-backend:5f66740ae8dd506577d27294adc55b81e4fbe91b AS runner

COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

WORKDIR /app

ARG SOPS_VERSION=3.9.4
RUN sed -i -E 's|(security|archive)\.ubuntu\.com/ubuntu|azure.archive.ubuntu.com/ubuntu|g' \
        /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list 2>/dev/null || true \
    && apt-get -o Acquire::Retries=5 update \
    && apt-get install -y --no-install-recommends \
    curl tini gosu postgresql-client ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL "https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/sops-v${SOPS_VERSION}.linux.$(dpkg --print-architecture)" -o /usr/local/bin/sops && chmod +x /usr/local/bin/sops \
    && mkdir -p /usr/local/share/ca-certificates \
    && chmod 755 /usr/local/share/ca-certificates \
    # Phase 2: platform does NOT run the convex backend; only needs
    # `generate_key` (glibc Rust binary) to compute admin keys for remote
    # `convex env set` / `convex deploy` calls.
    && chmod +x /convex/generate_key \
    && ln -s /convex/generate_key /usr/local/bin/generate_key \
    && groupadd --system --gid 1001 app || true \
    && useradd --system --uid 1001 --gid app app || true \
    && mkdir -p /home/app && chmod 777 /home/app \
    # Strip system bloat from Convex backend base (~155 MB)
    && ARCH_LIB="/usr/lib/$(dpkg --print-architecture | sed 's/amd64/x86_64-linux-gnu/;s/arm64/aarch64-linux-gnu/')" \
    && rm -rf "${ARCH_LIB}"/libLLVM* "${ARCH_LIB}"/libclang* \
    && rm -rf /usr/lib/llvm-18 \
    && rm -rf /usr/share/doc/* /usr/share/man/* /usr/share/info/* \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/* \
    && apt-get clean 2>/dev/null || true

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
    # INSTANCE_NAME is shared with convex service; platform uses it + INSTANCE_SECRET
    # to compute the admin key for `bunx convex env set` and `bunx convex deploy`.
    INSTANCE_NAME=tale_platform \
    DO_NOT_TRACK=1 \
    # Semantic value of the file-config parent path inside the convex
    # container. Platform forces this at push time in docker-entrypoint.sh
    # (to tombstone any stale host-side `.env` value). Convex derives the
    # sub-dirs (agents/workflows/integrations/providers) from it.
    TALE_CONFIG_DIR=/app/data

COPY --from=pruner --chown=app:app /app/services/platform/dist ./dist
COPY --from=pruner --chown=app:app \
     /app/services/platform/server.ts \
     /app/services/platform/telemetry.ts \
     /app/services/platform/convex-metrics.ts \
     ./
COPY --from=pruner --chown=app:app /app/services/platform/convex ./convex
COPY --from=pruner --chown=app:app /app/services/platform/lib ./lib
COPY --from=pruner --chown=app:app /app/node_modules ./node_modules
COPY --from=pruner --chown=app:app /app/services/platform/package.json ./
COPY --from=pruner --chown=app:app /app/services/platform/docker-entrypoint.sh /app/services/platform/generate-admin-key.sh /app/services/platform/reset-owner.sh /app/services/platform/reset-owner.ts /app/services/platform/env.sh ./

RUN chmod +x ./docker-entrypoint.sh ./generate-admin-key.sh ./reset-owner.sh

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
    INSTANCE_NAME=tale_platform \
    DO_NOT_TRACK=1 \
    TALE_CONFIG_DIR=/app/data

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]
