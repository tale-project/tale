# Tale Platform (Vite + TanStack Start + Convex)

The main web application. Runs a Vite SPA with TanStack Start alongside a Convex self-hosted backend in one container. Provides a health endpoint and connects to the Tale data services over the internal Docker network.

## Ports

- 3000 — Vite application (static server)
- 3210 — Convex backend API
- 3211 — Convex HTTP actions
- 6791 — Convex dashboard UI (direct access at http://localhost:6791)

## Health

- GET /api/health returns JSON status (used by proxy health checks)

## Environment

See compose.yml for the canonical list. Notable ones:

- HOST, PORT, LOG_LEVEL
- POSTGRES_URL (no DB name in URL; Convex derives DB from INSTANCE_NAME)
- INSTANCE_NAME (default tale-platform; DB becomes tale_platform)
- INSTANCE_SECRET (used by Convex)
- CONVEX_URL, CONVEX_DASHBOARD_URL (internal HTTP URLs)
- DB_URL, GRAPH_DB_URL, RAG_URL, CRAWLER_URL (internal DNS to services)
- OPENAI_API_KEY (optional; surfaced to app logic where used)

## Running

With Compose (recommended):

```
docker compose up -d platform
```

During development you may temporarily expose 3000 in compose.yml for direct Vite access.

## Admin and Utilities

- scripts:
  - docker-entrypoint.sh — orchestrates Convex + Vite + dashboard
  - env.sh — normalizes env configuration
  - generate_admin_key.sh — helper for admin keys

## Interaction with Other Services

- Uses Postgres (db) for Convex persistence (database tale_platform)
- Talks to graph-db, rag, crawler via internal URLs
- Designed to sit behind the proxy (Caddy) for TLS termination

## Notes

- The container base comes from ghcr.io/get-convex images to ensure Convex tooling is present
- If you run this outside Compose, ensure DB and other service URLs point to reachable hosts
