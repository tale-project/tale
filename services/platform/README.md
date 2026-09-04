# @tale/platform

Tale's web application and its backend. A Vite SPA (React 19 + TanStack
Router) served behind the proxy, plus the Postgres backend (`backend/` — a
Hono HTTP/SSE API and pg-boss job queues) that carries the whole product
surface. One image ships both: the web tier and the backend's `api` / `worker`
roles (role picked at boot).

## Interface

Ports:

- `3000` — Vite app (static server, `server.ts`)
- `3005` — backend HTTP/SSE API (`backend/main.ts`, `api`/`all` roles)

Endpoints:

- `GET /api/health` — JSON status, used by the proxy for blue-green health checks
- `/api/auth`, `/api/app`, `/api/v1`, `/events`, `/dav`, `/scim` — the backend's doors (see [backend/README.md](backend/README.md))

## Configuration

Notable variables (canonical list in `compose.yml`, which is local-dev only — production deployments use CLI-generated compose configs via `tale deploy`):

- `HOST`, `PORT`, `LOG_LEVEL`
- `DATABASE_URL` — the backend's Postgres
- `SANDBOX_URL` — internal DNS to the sandbox spawner
- `SANDBOX_TOKEN` — shared HMAC secret for spawner requests (required — the spawner refuses to boot without it)
- `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` — LLM-gateway management-API credential (required — the backend refuses management calls without it)
- `KNOWLEDGE_DATABASE_URL` — knowledge corpus (ParadeDB) used by the in-process RAG/crawler path
- `INSTANCE_SECRET` — root secret the WebDAV HMAC and encryption keys derive from
- `TALE_CONFIG_DIR`, `TALE_CONFIG_BUILTIN_DIR`, `TALE_CONFIG_SYSTEM_DIR` — the file-based org-config trees

## Development

```bash
docker compose up -d platform        # via Compose (recommended)
bun run setup:check                  # pre-flight: Bun, Node, Docker, ports
bun run dev                          # spawns the backend (+ its Postgres) and Vite together
bun run check                        # format + lint + typecheck + tests
```

For prerequisites, the pre-flight check, and port-conflict handling, see the [contributor setup guide](../../docs/en/develop/contributor-setup.md).

## Layout

- `app/` — TanStack Router routes, features, and UI components
- `backend/` — the Postgres backend: doors, jobs, auth, migrations; `backend/core/` is the ported domain logic the doors and jobs drive
- `lib/` — shared utilities (schemas, i18n, PII, harnesses, WebDAV protocol layer, …)
- `messages/` — i18n message catalogues (`en.json` is the source of truth)
- `scripts/` — operational helpers (see `scripts/README.md`)
- `server.ts` — minimal HTTP shim wrapping the Vite static server with `/api/health`
