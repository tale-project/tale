# @tale/platform

Tale's web application. Vite SPA with TanStack Start, served behind the proxy.

## Overview

Talks to the standalone `convex` service over the internal Docker network. Pushes Convex functions to that service via `bunx convex deploy` at startup; clients reach Convex through the proxy, not through this container. Calls `rag` and `crawler` for knowledge ingestion and retrieval.

## Interface

Ports:

- `3000` — Vite app (static server)

Endpoints:

- `GET /api/health` — JSON status, used by the proxy for blue-green health checks

## Configuration

Notable variables (canonical list in `compose.yml`, which is local-dev only — production deployments use CLI-generated compose configs via `tale deploy`):

- `HOST`, `PORT`, `LOG_LEVEL`
- `CONVEX_URL`, `CONVEX_DEPLOY_KEY` — point at the `convex` service
- `DB_URL`, `RAG_URL`, `CRAWLER_URL` — internal DNS to sibling services
- `INSTANCE_NAME`, `INSTANCE_SECRET` — used when generating Convex admin keys

## Development

```bash
docker compose up -d platform        # via Compose (recommended)
bun run dev                          # default: spawns an ephemeral local Convex backend
CONVEX_EXTERNAL=true bun run dev     # connects Vite to the convex container (docker compose up convex)
bun run check                        # format + lint + typecheck + tests
```

## Layout

- `app/` — TanStack Start routes, features, and UI components
- `convex/` — Convex functions deployed to the `convex` service
- `lib/` — shared utilities, including TanStack DB collection infrastructure
- `messages/` — i18n message catalogues (`en.json` is the source of truth)
- `scripts/` — operational helpers (see `scripts/README.md`)
- `server.ts` — minimal HTTP shim wrapping the Vite static server with `/api/health`
- `generate-admin-key.sh` — generates Convex admin keys for the dashboard
