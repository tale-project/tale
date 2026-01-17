# Tale Platform Dockerfile
# Builds the Vite SPA + Convex Backend with multi-stage optimization

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

# ============================================================================
# Stage 1: Dependencies
# ============================================================================
FROM ghcr.io/get-convex/convex-backend:272e7f4d46f0a9189d6e167f39f07d152b409fed AS workspace-deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY services/platform/package.json ./services/platform/

RUN npm ci --legacy-peer-deps

# ============================================================================
# Stage 2: Builder
# ============================================================================
FROM ghcr.io/get-convex/convex-backend:272e7f4d46f0a9189d6e167f39f07d152b409fed AS builder

WORKDIR /app

COPY --from=workspace-deps /app/node_modules ./node_modules

COPY services/platform/vite.config.ts \
     services/platform/tsconfig.json \
     services/platform/postcss.config.mjs \
     services/platform/tailwind.config.ts \
     services/platform/index.html \
     services/platform/vite-env.d.ts \
     services/platform/tsr.config.json \
     services/platform/components.json \
     services/platform/package.json \
     ./

COPY services/platform/app ./app
COPY services/platform/lib ./lib
COPY services/platform/convex ./convex
COPY services/platform/public ./public
COPY services/platform/types ./types
COPY services/platform/messages ./messages
COPY services/platform/vite-plugins ./vite-plugins

COPY services/platform/server.js \
     services/platform/docker-entrypoint.sh \
     services/platform/generate-admin-key.sh \
     services/platform/env.sh \
     ./

ENV NODE_ENV=production

RUN npx vite build

# ============================================================================
# Stage 3: Pruner
# ============================================================================
FROM builder AS pruner

RUN npm prune --omit=dev --legacy-peer-deps 2>/dev/null || true \
    && rm -rf ./node_modules/@swc/core* \
              ./node_modules/lightningcss* \
              ./node_modules/@parcel/watcher* \
              ./node_modules/typescript \
              ./node_modules/@types \
              ./node_modules/@storybook \
              ./node_modules/storybook \
              ./node_modules/pdfjs-dist/legacy \
    2>/dev/null || true \
    && find ./node_modules -type d \( -name "*-musl*" -o -name "*linuxmusl*" \) -exec rm -rf {} + 2>/dev/null || true \
    && find ./node_modules -type f -name "*.map" -delete 2>/dev/null || true \
    && find ./node_modules -type d \( -name "test" -o -name "tests" -o -name "__tests__" -o -name "__mocks__" -o -name "coverage" \) -exec rm -rf {} + 2>/dev/null || true \
    && find ./node_modules -type f \( -name "*.md" -o -name "*.markdown" -o -name "CHANGELOG*" -o -name "LICENSE*" -o -name "README*" \) -delete 2>/dev/null || true

# ============================================================================
# Stage 4: Convex Dashboard
# ============================================================================
FROM ghcr.io/get-convex/convex-dashboard:272e7f4d46f0a9189d6e167f39f07d152b409fed AS convex-dashboard

# ============================================================================
# Stage 5: Runtime
# ============================================================================
FROM ghcr.io/get-convex/convex-backend:272e7f4d46f0a9189d6e167f39f07d152b409fed AS runner

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

ENV NODE_ENV=production \
    TALE_VERSION=${VERSION} \
    PORT=3000 \
    HOSTNAME="0.0.0.0" \
    CONVEX_PORT=3210 \
    INSTANCE_NAME=tale_platform

COPY --from=convex-dashboard --chown=app:app /app /dashboard

COPY --from=pruner --chown=app:app /app/dist ./dist
COPY --from=pruner --chown=app:app /app/server.js ./
COPY --from=pruner --chown=app:app /app/convex ./convex
COPY --from=pruner --chown=app:app /app/lib ./lib
COPY --from=pruner --chown=app:app /app/node_modules ./node_modules
COPY --from=pruner --chown=app:app /app/package.json ./
COPY --from=pruner --chown=app:app /app/docker-entrypoint.sh /app/generate-admin-key.sh /app/env.sh ./

RUN chmod +x ./docker-entrypoint.sh ./generate-admin-key.sh

USER app

EXPOSE 3000 3210 3211 6791

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]
