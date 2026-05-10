# Tale Docs Dockerfile — Vite SPA + Bun server, mirrors services/web.
ARG VERSION=dev

FROM oven/bun:1.3.12 AS bun-bin

# ============================================================================
# Stage 1: workspace deps
# ============================================================================
FROM debian:bookworm-slim AS workspace-deps
COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/tale_knowledge/package.json ./packages/tale_knowledge/
COPY packages/tale_shared/package.json ./packages/tale_shared/
COPY packages/tale_telemetry/package.json ./packages/tale_telemetry/
COPY packages/ui/package.json ./packages/ui/
COPY packages/webui/package.json ./packages/webui/
COPY services/platform/package.json ./services/platform/
COPY services/crawler/package.json ./services/crawler/
COPY services/rag/package.json ./services/rag/
COPY services/db/package.json ./services/db/
COPY services/proxy/package.json ./services/proxy/
COPY services/web/package.json ./services/web/
COPY services/docs/package.json ./services/docs/
COPY tools/cli/package.json ./tools/cli/
COPY tools/plop/package.json ./tools/plop/
COPY patches/ ./patches/

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && HUSKY=0 bun install

# ============================================================================
# Stage 2: builder
# ============================================================================
FROM workspace-deps AS builder
WORKDIR /app

COPY tsconfig.base.json ./
COPY packages/i18n ./packages/i18n
COPY packages/ui ./packages/ui
COPY packages/webui ./packages/webui
COPY services/docs ./services/docs
COPY docs ./docs

ARG DOCS_BASE_URL=/
ARG DOCS_SITE_URL=https://docs.tale.dev
ENV NODE_ENV=production \
    DOCS_BASE_URL=${DOCS_BASE_URL} \
    DOCS_SITE_URL=${DOCS_SITE_URL}
WORKDIR /app/services/docs
RUN bun --bun scripts/build-search-index.ts \
    && bun --bun vite build \
    && bun --bun vite build --ssr app/entry-server.tsx --outDir dist-ssr \
    && bun --bun scripts/prerender.ts \
    && bun --bun scripts/build-llms-artifacts.ts \
    && bun build server.ts --target=bun --outfile=server.js --external bun
WORKDIR /app

# ============================================================================
# Stage 3: runtime
# ============================================================================
FROM oven/bun:1.3.12-slim AS runner

ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-docs" \
      org.opencontainers.image.description="Tale documentation site"

ARG LOCALE_COOKIE_DOMAIN=
# Re-declare DOCS_BASE_URL here so the runner stage can promote it to ENV;
# the server uses it as the public mount prefix for locale redirects.
ARG DOCS_BASE_URL=/
ENV NODE_ENV=production \
    TALE_VERSION=${VERSION} \
    PORT=3002 \
    HOSTNAME="0.0.0.0" \
    DO_NOT_TRACK=1 \
    LOCALE_COOKIE_DOMAIN=${LOCALE_COOKIE_DOMAIN} \
    DOCS_BASE_URL=${DOCS_BASE_URL}

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl tini ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 app \
    && useradd --system --uid 1001 --gid app app

COPY --from=builder --chown=app:app /app/services/docs/dist ./dist
COPY --from=builder --chown=app:app /app/services/docs/server.js ./server.js
COPY --from=builder --chown=app:app /app/services/docs/package.json ./package.json
COPY --from=builder --chown=app:app /app/services/docs/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER app
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3002/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]
