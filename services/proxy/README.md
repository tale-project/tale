# @tale/proxy

[Caddy](https://caddyserver.com/) reverse proxy. Single TLS-terminating entry point for Tale.

## Overview

Routes traffic to the platform and Convex using the `platform` DNS alias for blue-green failover. TLS mode and base path are templated into the `Caddyfile` at startup by `docker-entrypoint.sh`.

## Interface

Ports:

- `80` — HTTP (ACME challenges; redirects to HTTPS)
- `443` — HTTPS (everything user-facing)
- `2020` — internal `/health` for Compose / load balancers

Routes (defined in `Caddyfile`):

- `platform:3000` — the SPA + REST/health endpoints (catch-all)
- `convex:3210` — WebSocket sync (`/ws_api/*`, `/api/*/sync`), admin API, actions, storage
- `convex:3211` — Convex HTTP actions and `/api/*` site proxy
- `convex:6791` — Convex Dashboard at `/convex-dashboard`
- `platform:3000`, `convex` — `/metrics/*` (token-gated)

`maintenance.html` is served on backend 5xx.

### Postgres backend cutover

When `BACKEND_UPSTREAM` is set (e.g. `backend-api:3005`, the `backend`
compose profile), the entrypoint templates a block of `handle` directives
ahead of the Convex ones so the migrated surface — `/api/auth/*`,
`/api/app/*`, `/events`, `/api/tools/*`, `/api/automations/webhook/*`,
`/api/v1/*`, `/api/control/*`, SSO/SCIM/trusted-headers (both their native
and `/http_api/...` aliases), `/api/cloud-import/oauth2/*` and `/dav/*` —
reaches the Postgres backend. Everything not named there keeps flowing to
Convex, and unsetting the variable puts the whole stack back on the 0.4
lanes.

## Configuration

- `BACKEND_UPSTREAM` — `host:port` of the 0.5 Postgres backend (unset = all lanes to Convex)
- `TLS_MODE` — `selfsigned` (default, Caddy internal CA) or `letsencrypt`
- `TLS_EMAIL` — Let's Encrypt notifications (recommended when using `letsencrypt`)
- `SITE_ORIGIN` — e.g. `https://localhost`
- `BASE_PATH` — for subpath deployments

## Development

```bash
bun run logs         --filter=@tale/proxy   # docker compose logs -f proxy
bun run shell        --filter=@tale/proxy   # exec into the running container
bun run trust-certs  --filter=@tale/proxy   # caddy trust (local self-signed)
```

## Layout

- `Caddyfile` — route definitions and TLS template
- `docker-entrypoint.sh` — substitutes `TLS_MODE` / `BASE_PATH` placeholders before launching Caddy
- `maintenance.html` — fallback served on backend 5xx
