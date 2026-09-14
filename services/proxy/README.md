# @tale/proxy

[Caddy](https://caddyserver.com/) reverse proxy. Single TLS-terminating entry point for Tale.

## Overview

Routes traffic to the platform (SPA + static) and the 0.5 Postgres backend, using the `platform` DNS alias for blue-green failover. TLS mode and base path are templated into the `Caddyfile` at startup by `docker-entrypoint.sh`.

## Interface

Ports:

- `80` — HTTP (ACME challenges; redirects to HTTPS)
- `443` — HTTPS (everything user-facing)
- `2020` — internal `/health` for Compose / load balancers

Routes (defined in `Caddyfile`):

- `platform:3000` — the SPA + static assets (catch-all), `/api/health`, and `/dav/*` while WebDAV stays on the platform handler
- `backend-api:3005` (`$BACKEND_UPSTREAM`) — the 0.5 backend: `/api/*` and the injected lanes (see below)
- `docs:3002` — the docs site (optional; only the dev/docs compose chain ships it, so passive health-checking only)
- `/metrics/*` (token-gated) → `platform:3000` (`/metrics/platform`, `/metrics/sla-rules`); `/metrics/backend` joins once `BACKEND_UPSTREAM` is set, and 404s before that

A backend 502/503/504 answers `maintenance.html` to a browser navigation. A machine door — `/api/*`, `/scim/*`, `/http_api/*`, `/events`, `/status.json`, `/openapi.json`, `/.well-known/*` — gets the JSON envelope instead (`UPSTREAM_UNAVAILABLE`, the error's own status, `Retry-After: 5`, an `X-Request-Id` of its own and no `X-Tale-Api-Version`), and a 502 caused by an HTTP/2 body that ended before its declared `Content-Length` answers 400 `BODY_LENGTH_MISMATCH` on every path — the request was malformed, not the platform; a 502 caused by a malformed HTTP/1.1 chunked request body (a non-hexadecimal chunk size, a bare LF, a missing CRLF) answers 400 `BODY_CHUNK_MALFORMED` the same way. All three rules live in the `handle_errors` block of the `Caddyfile`.

### The 0.5 backend surface

`BACKEND_UPSTREAM` (default `backend-api:3005`) is where the 0.5 backend
lanes go. The entrypoint templates a block of `handle` directives ahead of
the catch-all so the backend surface — `/api/auth/*`, `/api/app/*`,
`/events`, `/api/tools/*`, `/api/connectors/*`, `/api/automations/webhook/*`,
`/api/v1/*`, `/api/control/*`, SSO/SCIM/trusted-headers (both their native
and `/http_api/...` aliases), `/api/cloud-import/oauth2/*`, the blob-store
bucket path and `/dav/*` — reaches it; anything else under `/api/*` falls to
the backend too, while `/api/health` and the SPA stay on `platform:3000`. The
Convex fallbacks that once lived here are gone with the runtime.

## Configuration

- `BACKEND_UPSTREAM` — `host:port` of the 0.5 Postgres backend (default `backend-api:3005`)
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
- `maintenance.html` — the page a browser gets on a backend 502/503/504 (a machine door gets the JSON envelope instead — see above)
