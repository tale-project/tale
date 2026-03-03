# Tale Platform Dockerfile
# Builds the Vite SPA + Convex Backend with multi-stage optimization

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

# Bun binary for all stages
FROM oven/bun:1.3.10 AS bun-bin

# ============================================================================
# Stage 1: Dependencies
# ============================================================================
FROM ghcr.io/get-convex/convex-backend:5f66740ae8dd506577d27294adc55b81e4fbe91b AS workspace-deps

COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY services/platform/package.json ./services/platform/
COPY services/crawler/package.json ./services/crawler/
COPY services/rag/package.json ./services/rag/
COPY services/operator/package.json ./services/operator/
COPY services/db/package.json ./services/db/
COPY services/proxy/package.json ./services/proxy/
COPY tools/cli/package.json ./tools/cli/
COPY patches/ ./patches/

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
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
COPY --from=workspace-deps /app/services/platform/package.json /tmp/workspace/services/platform/
COPY --from=workspace-deps /app/services/crawler/package.json /tmp/workspace/services/crawler/
COPY --from=workspace-deps /app/services/rag/package.json /tmp/workspace/services/rag/
COPY --from=workspace-deps /app/services/operator/package.json /tmp/workspace/services/operator/
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
    2>/dev/null || true \
    && find /app/node_modules -type d \( -name "*-musl*" -o -name "*linuxmusl*" \) -exec rm -rf {} + 2>/dev/null || true \
    && find /app/node_modules -type f -name "*.map" -delete 2>/dev/null || true \
    && find /app/node_modules -type d \( -name "test" -o -name "tests" -o -name "__tests__" -o -name "__mocks__" -o -name "coverage" \) -exec rm -rf {} + 2>/dev/null || true \
    && find /app/node_modules -type f \( -name "*.md" -o -name "*.markdown" -o -name "CHANGELOG*" -o -name "LICENSE*" -o -name "README*" \) -delete 2>/dev/null || true

# ============================================================================
# Stage 4: Convex Dashboard
# ============================================================================
FROM ghcr.io/get-convex/convex-dashboard:5f66740ae8dd506577d27294adc55b81e4fbe91b AS convex-dashboard

# ============================================================================
# Stage 5: Runtime
# ============================================================================
FROM ghcr.io/get-convex/convex-backend:5f66740ae8dd506577d27294adc55b81e4fbe91b AS runner

COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl tini postgresql-client ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/local/share/ca-certificates \
    && chmod 755 /usr/local/share/ca-certificates \
    && chmod +x /convex/convex-local-backend /convex/generate_key \
    && ln -s /convex/convex-local-backend /usr/local/bin/convex-local-backend \
    && ln -s /convex/generate_key /usr/local/bin/generate_key \
    && groupadd --system --gid 1001 app || true \
    && useradd --system --uid 1001 --gid app app || true \
    && mkdir -p /home/app && chmod 777 /home/app \
    && mkdir -p /app/convex-data /dashboard \
    && chown -R app:app /app/convex-data /dashboard

# Re-declare VERSION arg (ARGs don't persist after FROM)
ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}"

ENV NODE_ENV=production \
    TALE_VERSION=${VERSION} \
    PORT=3000 \
    HOSTNAME="0.0.0.0" \
    CONVEX_PORT=3210 \
    INSTANCE_NAME=tale_platform \
    # Increase UDF timeout from default 1s to 5s to handle thundering herd on reconnect.
    # When a browser tab is idle and reconnects, all subscribed queries fire simultaneously,
    # causing burst load that can exceed the default timeout under contention.
    DATABASE_UDF_USER_TIMEOUT_SECONDS=5 \
    # Increase V8 isolate memory thresholds to reduce cold-start latency spikes.
    # Default heap (64MB) triggers memory_carry_over recycling when V8 external
    # memory accumulates to ~48 MiB, causing 3-5s cold-start on the next query.
    # USER_HEAP 256MB + EXTRA 128MB = 384MB total heap limit per isolate.
    ISOLATE_MAX_USER_HEAP_SIZE=268435456 \
    ISOLATE_MAX_HEAP_EXTRA_SIZE=134217728 \
    # Increase V8 isolate idle timeout from default 10min to 1 hour.
    # Keeps warm isolates alive longer, avoiding cold-start latency on
    # queries that fire every 5-10 minutes.
    ISOLATE_IDLE_TIMEOUT_SECONDS=3600 \
    # Increase isolate max lifetime from default 1h to 4h (must be >= idle timeout).
    ISOLATE_MAX_LIFETIME_SECONDS=14400 \
    # CA cert path for self-signed mode - entrypoint script checks if file exists
    # With Let's Encrypt, this file doesn't exist and is safely ignored
    CADDY_CA_CERT_PATH=/caddy-data/caddy/pki/authorities/local/root.crt \
    DO_NOT_TRACK=1

COPY --from=convex-dashboard --chown=app:app /app /dashboard

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
COPY --from=pruner --chown=app:app /app/services/platform/docker-entrypoint.sh /app/services/platform/generate-admin-key.sh /app/services/platform/env.sh ./

RUN chmod +x ./docker-entrypoint.sh ./generate-admin-key.sh

USER app

EXPOSE 3000 3210 3211 6791

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]
