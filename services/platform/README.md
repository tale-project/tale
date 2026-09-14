# @tale/platform

Tale’s web app and application backend. The app uses Vite, React and TanStack
Router; the backend uses Node, Hono, Postgres and pg-boss. One platform image runs
as the web server, API or worker according to its startup role.

## Start local development

Run these commands from the repository root with Bun, compatible Node.js and a
working Docker Compose installation:

```bash
bun install
bun run setup:check
bun run dev
```

The root development command starts the backing containers, the Node backend and
Vite. Wait for `READY`, then open `http://localhost:3000`. The pre-flight checks Bun
and ports 3000/3005; check Node and Docker separately. The
[contributor setup guide](../../docs/en/develop/contributor-setup.md) covers tool
versions, the local login, persisted state, frontend-only work and startup failures.

For the packaged deployment, use the
[self-hosted quickstart](../../docs/en/self-hosted/install/quickstart.md). The
repository Compose files are development inputs; production workspace deployments
use CLI-generated files.

## Runtime interfaces

| Interface | Purpose |
| --- | --- |
| Port 3000 | Vite during development; the web server in the platform container. |
| Port 3005 | Backend HTTP and SSE in `api` or `all` mode. |
| `/api/auth` | Sessions and authentication. |
| `/api/app` | The application’s authenticated operations. |
| `/api/v1` | Public REST API and inbound MCP endpoint. |
| `/events`, `/dav`, `/scim` | Change hints, WebDAV and SCIM. |
| `/status`, `/status.json` | Public availability summary. |

The production web shim also serves `/api/health` for its liveness probe. Local
Vite routes are not an exact copy of that shim; do not assume every production
health route exists on the development server. The
[backend README](backend/README.md) describes backend routes and process roles.

## Configuration and state

Use the [environment reference](../../docs/en/self-hosted/configuration/environment-reference.md)
for deployment variables and their consumers. The main configuration boundaries
are:

- `DATABASE_URL` for the application database and `KNOWLEDGE_DATABASE_URL` for
  the knowledge corpus.
- `TALE_CONFIG_DIR` for organization configuration, separate from the read-only
  builtin and system catalogs.
- `INSTANCE_SECRET`, `BETTER_AUTH_SECRET` and `ENCRYPTION_SECRET_HEX` for distinct
  cryptographic purposes. Preserve the matching secrets with recovery plans.
- `SANDBOX_URL`, `SANDBOX_TOKEN` and
  `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` for the sandbox and model gateway.

A second worktree does not isolate databases, container names or ports. Use
separate backing state when parallel work must not affect another instance.

## Find the implementation

| Directory | Contents |
| --- | --- |
| `app/` | Routes, product features and browser components. |
| `backend/` | API routes, authentication, jobs, database migrations and domains. |
| `backend/core/` | Domain and runtime modules used by backend services. |
| `lib/` | Shared utilities, schemas, i18n, harnesses and protocol code. |
| `messages/` | English, German and French YAML catalogs with regional overrides. |
| `scripts/` | Development, validation and operational helpers. |
| `tests/manual/` | Repeatable manual suites and run history. |
| `tests/docs-screenshots/` | Reproducible documentation image captures. |

## Validate a change

Run commands from the repository root:

```bash
bun run --filter @tale/platform test
bun run --filter @tale/platform typecheck
bun run check
```

Choose browser and integration checks according to the change. Database migrations
require `bun run --filter @tale/platform backend:integration` against an isolated
real Postgres instance. Drive changed UI flows in a browser and update their docs,
translations and manual coverage. Read the repository contracts before changing
code; they own the complete definition of done.
