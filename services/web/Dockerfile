# Tale Web Dockerfile — Vite SPA, no backend coupling
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
COPY services/web/package.json ./services/web/
COPY packages/ui/package.json ./packages/ui/
COPY packages/webui/package.json ./packages/webui/
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
COPY packages/ui ./packages/ui
COPY packages/webui ./packages/webui
COPY services/web ./services/web

ENV NODE_ENV=production
WORKDIR /app/services/web
RUN bun --bun vite build
WORKDIR /app

# ============================================================================
# Stage 3: runtime
# ============================================================================
FROM oven/bun:1.3.12-slim AS runner

ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-web" \
      org.opencontainers.image.description="Tale marketing site"

ENV NODE_ENV=production \
    TALE_VERSION=${VERSION} \
    PORT=3001 \
    HOSTNAME="0.0.0.0" \
    DO_NOT_TRACK=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl tini ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 app \
    && useradd --system --uid 1001 --gid app app

COPY --from=builder --chown=app:app /app/services/web/dist ./dist
COPY --from=builder --chown=app:app /app/services/web/server.ts ./server.ts
COPY --from=builder --chown=app:app /app/services/web/package.json ./package.json
COPY --from=builder --chown=app:app /app/services/web/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3001/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]
