# Tale UI Docs Dockerfile — Vite SPA + Bun server, mirrors services/docs.
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
COPY packages/e2e/package.json ./packages/e2e/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY packages/marketing-ui/package.json ./packages/marketing-ui/
COPY services/platform/package.json ./services/platform/
COPY services/db/package.json ./services/db/
COPY services/proxy/package.json ./services/proxy/
COPY services/sandbox/package.json ./services/sandbox/
COPY services/sandbox-runtime/daemon/package.json ./services/sandbox-runtime/daemon/
COPY services/web/package.json ./services/web/
COPY services/docs/package.json ./services/docs/
COPY services/ui-docs/package.json ./services/ui-docs/
COPY tools/cli/package.json ./tools/cli/
COPY tools/plop/package.json ./tools/plop/
COPY tools/opengrep/package.json ./tools/opengrep/
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
COPY tsconfig.dom.json ./
COPY tsconfig.vite.json ./
COPY packages/ui ./packages/ui
COPY packages/marketing-ui ./packages/marketing-ui
COPY services/ui-docs ./services/ui-docs

ARG UI_DOCS_BASE_URL=/
ARG UI_DOCS_SITE_URL=https://ui.tale.dev
ENV NODE_ENV=production \
    UI_DOCS_BASE_URL=${UI_DOCS_BASE_URL} \
    UI_DOCS_SITE_URL=${UI_DOCS_SITE_URL}
WORKDIR /app/services/ui-docs
# `tale-seo-compile` runs after `vite build` so it can walk the content tree
# (which is present in the builder stage but NOT in the runner) and emit
# the artifact set + manifest into `dist-seo/`. The runner stage copies
# `dist-seo/` and serves it via `createPrecompiledServer`, so no source
# markdown is read at request time. The final `bun build` step bundles
# server.ts (and its `@tale/ui/*` source imports) into a self-contained
# server.js — the runner stage carries no node_modules, mirroring web/docs.
RUN bun --bun scripts/build-content.ts \
    && bun --bun vite build \
    && bun --bun vite build --ssr app/entry-server.tsx --outDir dist-ssr \
    && bun --bun scripts/prerender.ts \
    && bun --bun /app/packages/ui/bin/seo-compile.ts ./scripts/seo.config.ts --out dist-seo \
    && bun build server.ts --target=bun --outfile=server.js --external bun --external canvas
WORKDIR /app

# ============================================================================
# Stage 3: runtime
# ============================================================================
FROM oven/bun:1.3.12-slim AS runner

ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-ui-docs" \
      org.opencontainers.image.description="Tale design-system documentation site (ui.tale.dev)"

ARG LOCALE_COOKIE_DOMAIN=
# Re-declare UI_DOCS_BASE_URL here so the runner stage can promote it to ENV;
# the server uses it as the public mount prefix for locale redirects.
ARG UI_DOCS_BASE_URL=/
ENV NODE_ENV=production \
    TALE_VERSION=${VERSION} \
    PORT=3003 \
    HOSTNAME="0.0.0.0" \
    DO_NOT_TRACK=1 \
    LOCALE_COOKIE_DOMAIN=${LOCALE_COOKIE_DOMAIN} \
    UI_DOCS_BASE_URL=${UI_DOCS_BASE_URL}

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl tini ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 app \
    && useradd --system --uid 1001 --gid app app

COPY --from=builder --chown=app:app /app/services/ui-docs/dist ./dist
COPY --from=builder --chown=app:app /app/services/ui-docs/dist-seo ./dist-seo
COPY --from=builder --chown=app:app /app/services/ui-docs/server.js ./server.js
COPY --from=builder --chown=app:app /app/services/ui-docs/package.json ./package.json
COPY --from=builder --chown=app:app /app/services/ui-docs/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER app
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3003/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]
