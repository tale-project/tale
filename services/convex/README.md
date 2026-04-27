# @tale/convex

Convex local backend + Convex Dashboard, packaged as a standalone service.

## Overview

Hosts the Convex runtime that the platform pushes functions and env vars into (`bunx convex deploy`, `convex env set`). Persists to Postgres; serves the dashboard at `/convex-dashboard`. Builtin example configs are seeded once on a fresh data volume.

## Interface

Ports:

- `3210` — Convex backend API (WebSocket sync + HTTP)
- `3211` — Convex HTTP actions (site proxy)
- `6791` — Convex Dashboard (Next.js)

Healthcheck hits `GET /version` and waits for `/tmp/convex-ready` (written after seed completes).

## Configuration

Notable variables (canonical list in `compose.yml`):

- `POSTGRES_URL` — DB derived from `INSTANCE_NAME`
- `INSTANCE_NAME`, `INSTANCE_SECRET`
- `TALE_CONFIG_DIR` — root for file-based configs (`agents/`, `workflows/`, `integrations/`, `providers/`, `branding/`); defaults to `/app/data`
- `DASHBOARD_BASE_PATH` — defaults to `/convex-dashboard`

Convex performance tunables (UDF/action timeouts, isolate sizes, concurrency limits) are set in the Dockerfile and can be overridden at runtime.

## Development

Build context **must** be the repo root, not `services/convex/`:

```bash
docker build -f services/convex/Dockerfile .
docker compose up -d convex
```

## Layout

- `Dockerfile` — Convex backend + Dashboard image
- `docker-entrypoint.sh` — privilege drop, CA trust, builtin seed, backend + dashboard startup, crash monitor
- `env.sh` — env normalisation shared with the platform entrypoint
