# Tale Ai-gateway Dockerfile — Vite SPA, no backend coupling
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
# `bun install` resolves the WHOLE workspace, not just this service: the root
# manifest names `services/sandbox-runtime/daemon` explicitly and every
# `workspace:*` dependency has to resolve, so every workspace manifest is
# copied — the same set `services/ui-docs` copies. Three alone fail with
# `error: Workspace not found "services/sandbox-runtime/daemon"`.
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
COPY services/ai-gateway/package.json ./services/ai-gateway/
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
COPY packages/ui ./packages/ui
COPY services/ai-gateway ./services/ai-gateway

ENV NODE_ENV=production
WORKDIR /app/services/ai-gateway
# Build the SPA, then bundle the Bun server into one file. The runner
# stage carries no `node_modules`, so every import `server.ts` makes —
# `@tale/ui/server`, the service's own modules, its dependencies — has to
# be inlined here (the pattern `services/web` and `services/docs` use).
RUN bun --bun vite build \
    && bun build server.ts --target=bun --outfile=server.js --external bun
WORKDIR /app

# ============================================================================
# Stage 3: runtime
# ============================================================================
FROM oven/bun:1.3.12-slim AS runner

ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-ai-gateway" \
      org.opencontainers.image.description="Multi-provider AI subscription credential gateway"

ENV NODE_ENV=production \
    TALE_VERSION=${VERSION} \
    PORT=3004 \
    HOSTNAME="0.0.0.0" \
    DO_NOT_TRACK=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl tini ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 app \
    && useradd --system --uid 1001 --gid app app

COPY --from=builder --chown=app:app /app/services/ai-gateway/dist ./dist
COPY --from=builder --chown=app:app /app/services/ai-gateway/server.js ./server.js
COPY --from=builder --chown=app:app /app/services/ai-gateway/package.json ./package.json
COPY --from=builder --chown=app:app /app/services/ai-gateway/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# The credential pool's mount point, created here so a named volume inherits
# the unprivileged user rather than root — the server could not write it
# otherwise. `AI_GATEWAY_DATA_DIR` still decides where the document goes.
RUN mkdir -p /data && chown app:app /data
VOLUME ["/data"]

USER app
EXPOSE 3004
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3004/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]
