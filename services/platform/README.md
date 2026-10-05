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
| `/api/health/ready` | Public API/database readiness; HTTP 200 with `{ok:true, service:'backend'}`. |
| `/events`, `/dav`, `/scim` | Change hints, WebDAV and SCIM. |
| `/status`, `/status.json` | Public availability summary. |
| `/docs`, `/openapi.json` | Interactive API reference and its raw schema. |
| `/llms.txt`, `/llms-full.txt` | Public reference indexes for AI clients. |

The production web shim also serves `/api/health` for its liveness probe. Local
Vite routes are not an exact copy of that shim; do not assume every production
health route exists on the development server. The
[backend README](backend/README.md) describes backend routes and process roles.

The browser uses `/api/health/ready` through the public proxy to verify API and
database availability. It refreshes failed reads after recovery and never
automatically replays writes. The service worker caches the connection screen
and its recovery script, with bounded probes and retries through HTTP proxy
failures; it does not cache application data.

Every production web replica mounts the same deployment-owned `static-assets`
volume at `/app/static-assets`. Before listening, it atomically publishes the
immutable files listed in `dist/pwa-build.json`. Serving local files first and
retained artifacts second keeps either blue-green colour compatible with the
other colour's HTML and older tabs. Running replicas refresh their artifacts
hourly; inactive artifacts expire seven days after their last refresh. Keep the
mount when maintaining your own Compose configuration.

The worker verifies the offline shell, recovery script and build identity with
SHA-256 integrity. Mismatched recovery bytes fail installation while the current
worker stays active; subsequent update checks retry after the handover. The
server serves canonical offline HTML to precache requests, and the worker scopes
the cached recovery script to the deployment's base path before displaying it.

The prose guides live on the separate docs origin. The interactive reference
links to the published developer guides and the same-origin OpenAPI document.
When operating a docs mirror, configure its proxy host with `DOCS_URL` and review
client/build links separately; `/docs` remains the platform reference route.

Through the bundled production proxy, `/health` answers only for Caddy. Use the
platform endpoints above for application monitoring. Unknown frontend paths can
return the app shell with `200`, so a monitor must validate the expected body.
The app’s `robots.txt` disallows application indexing while permitting its named
public developer/status surfaces; those rules do not enforce authorization.

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

Set `TOTP_CLIENT_NAME` and `TOTP_ENVIRONMENT` in the deployment environment
(the web tier and the backend both read them) so new authenticator entries and
backup-code downloads say which client, product and environment they belong to:
`Acme` with `te` produces `Acme Tale Platform TE` and
`acme-tale-platform-te-backup-codes.txt`, while `pr` or an unset environment adds
none and an unset client keeps `Tale Platform`. Existing saved entries keep their
names; they can be renamed in the authenticator app without changing the
secret.

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
real Postgres instance; CI's Backend integration check runs it on every pull request
that touches the backend. Drive changed UI flows in a browser and update their docs,
translations and manual coverage. Read the repository contracts before changing
code; they own the complete definition of done.

## Optional aggregate analytics

Analytics is disabled by default. Set `UMAMI_URL`, `UMAMI_WEBSITE_ID` and server-only
`UMAMI_PROXY_TOKEN` in the production service’s runtime environment to enable it. Recreate the
service after changing these values; clearing the website ID disables collection without an
image rebuild. The Vite development server does not inject this configuration.

The shared `@tale/ui/analytics` implementation loads the tracker through `/_a/script.js` and
sends curated pageviews through `/_a/api/send`. A configured base path prefixes those URLs.
Only the website ID and proxy path enter the browser; the collector origin and token remain on
the server. Known public paths and private route templates omit queries, page titles and
resource IDs. Do Not Track and Global Privacy Control disable collection.

The collector gateway must authenticate `GET /_collect/script.js` and `POST /_collect/api/send`
with the configured bearer token. Edge Caddy must overwrite `X-Analytics-Client-IP` from its
trusted client address. Keep application ports private and configure trusted proxy ranges when
another proxy sits in front. The server forwards the validated IP, browser User-Agent and
required Umami headers; it drops browser cookies, credentials and referrer headers.

See the [environment reference](../../docs/en/self-hosted/configuration/environment-reference.md)
and [observability guide](../../docs/en/self-hosted/configuration/observability-config.md) for the
collector contract, collected fields, opt-outs and verification steps.

Agent starts can use `SANDBOX_AGENT_PROFILE=agent-light` on the backend API and
worker to create workspaces without inner Docker or shared build-cache helpers.
The default `agent` and existing workspaces keep their Docker capability.
`TALE_SANDBOX_CLAUDE_EFFORT=low|medium|high|max` selects Claude Code effort per
exec; `max` preserves the existing default. Lower values omit the automatic
Ultrathink prefix without disabling adaptive thinking. Benchmark representative
outcomes before lowering effort. See the operator [environment reference](../../docs/en/self-hosted/configuration/environment-reference.md).

Agent progress coalesces to one in-flight database update and the latest pending
snapshot. Drain windows restore bounded parser/projection checkpoints from the
runtime, including partial JSONL, background tasks and accumulated usage. The
checkpoint is saved before acknowledging replay; an unrecoverable replay gap
fails explicitly. Each JSONL record, including an unfinished one, is limited to
8 MiB of UTF-8; oversized records fail explicitly instead of growing memory
without bound. Sampled backend traces separate acquire, gateway, stage,
execute, persist and harvest without carrying prompts or credentials.
