# Platform backend

The platform backend serves the application and public APIs through Hono and
runs durable work with pg-boss. Both use PostgreSQL. Organization configuration
remains files under `TALE_CONFIG_DIR`; it is not a second set of database rows.
This code ships in the platform image and runs on Node, while Bun manages the
workspace and its build/test commands.

## Find the owner of a change

| Area | Location |
| --- | --- |
| Process startup, shutdown and roles | `main.ts`, `env.ts`, `http-shutdown.ts` |
| Browser-facing domain routes and SQL services | `domains/` |
| Public REST resources and error contracts | `rest/` |
| Accounts, sessions, membership and native identity | `auth/` |
| Durable jobs, schedules and queue policies | `jobs/` |
| Application migrations and transaction setup | `db/` |
| Realtime invalidation events | `realtime/` |
| Reused domain logic and compatibility types | [`core/`](core/README.md) |

The [public API reference](../../../docs/en/develop/api-reference.md) describes
consumer requests. Internal `/api/app` routes are the browser application's
implementation surface; do not expose a compatibility handler as a public API.
[`MIGRATION.md`](MIGRATION.md) is historical context for the earlier backend port.

## Start the backend

Follow the [platform setup](../README.md) for a working local database, object
store, configuration tree and frontend. From the repository root:

```bash
bun run dev
```

For backend-only development against already configured services:

```bash
bun run --filter @tale/platform backend:dev
```

This starts Node with the repository's TypeScript loader and watch mode. Use the
Node and Bun versions pinned by the repository. The loader resolves imports used
by the shared platform code; launching `main.ts` with a different runtime command
can fail before the application starts.

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | Required application database connection |
| `ROLE` | `api`, `worker`, or `all` (default) |
| `PORT` | Backend HTTP port, default `3005` |
| `BETTER_AUTH_SECRET` | Required when the process serves APIs (`api` or `all`) |
| `SITE_URL` | Public origin used by authentication; non-loopback origins require HTTPS |
| `TALE_CONFIG_DIR` / `TALE_CONFIG_BUILTIN_DIR` | Writable deployment configuration and shipped catalog |
| `WORKER_CONCURRENCY` | Jobs one worker process runs at once, default `5` (1–64); raise `KNOWLEDGE_DB_POOL_MAX` with it |
| `KNOWLEDGE_DB_POOL_MAX` | Connections one process opens to the knowledge corpus, default `10`; an indexing job holds one per slice commit, so keep it at or above `WORKER_CONCURRENCY` |
| `SENTRY_DSN` | Optional error reporting |

An `api` process serves HTTP/SSE and can enqueue work; a `worker` consumes jobs
and runs schedules. `all` combines both for local development. Every role runs
application migrations under the same advisory lock. Auth migrations run where
auth is configured, and pg-boss manages its own schema when it starts.

## Preserve transaction and tenant boundaries

Use `transactSerializable` from `@tale/shared/db/serializable` for retryable
mutation transactions. Serialization conflicts and deadlocks can rerun the
entire callback. Keep network calls, timers and other non-transactional effects
outside that callback.

Enqueue durable work with `addJobInTx` in the transaction that records the state
change. A rollback must not leave a queued effect. Job delivery can repeat, so
handlers must use durable identities and idempotent processing; queue singleton
keys do not make an arbitrary external side effect exactly-once.

Check both organization scope and the caller's permission at each boundary.
Use the organization's knowledge pool through `getKnowledgePoolForOrg`, rather
than assuming the deployment-default corpus belongs to every organization.
Configuration readers used for authorization must fail closed when required
configuration is unreadable; display-cache behavior is not an authorization rule.

## Follow realtime updates

Writers emit invalidation hints transactionally into `app_realtime.outbox`.
`GET /events` streams authorized hints; the browser invalidates its
`['backend', orgId, entity]` query keys and refetches through ordinary authorized
endpoints. Hints contain change information, not a bypass around read permissions.

Clients with an expired replay cursor receive a resync signal. Open streams
periodically recheck session and membership, and the worker also reclaims old
outbox entries when no browser is connected. Token streaming uses the chat
thread's dedicated stream route; do not send token payloads through the general
invalidation bus.

## Diagnose startup and indexing

Inspect the first failed startup stage before restarting. Database migrations,
queue setup, knowledge bootstrap and object-store bootstrap have different
failure and recovery paths. A listening API does not prove that uploads or
knowledge indexing are ready.

Knowledge index verification runs before a role can write to the default corpus;
organization-specific pools install the same health hook when opened. Small
unhealthy indexes can be rebuilt inline; larger repairs use a background job and
refuse affected writes while rebuilding. Inspect the logged outcome and admin
notification. The implementation and size threshold live in
[`domains/knowledge/index-health.ts`](domains/knowledge/index-health.ts).

## Integrate conversations and identity

External conversation systems use `rest/v1-conversations.ts` and
[`domains/conversations/api-sync.ts`](domains/conversations/api-sync.ts).
Organization/source/external-ID bindings and increasing source revisions prevent
replays from overwriting newer data. Native replies are durable delivery records:
the external worker claims and acknowledges them rather than scheduling email.
See the public reference for payloads, ownership, leases and retry behavior.

Native identity clients use [`auth/oidc-integration.ts`](auth/oidc-integration.ts)
and the Better Auth OAuth provider. The admin API creates an organization-bound
client and shows its secret once. Current membership, verified email and applicable
MFA policy remain prerequisites for identity claims. Native userinfo tokens are
not REST API keys. Keep callback validation, audience restrictions, secret
rotation and organization retirement covered when changing this integration.

## Verify a backend change

```bash
bun run --filter @tale/platform test
bun run --filter @tale/platform backend:integration
```

The second command requires a **fresh, disposable application database** and its
own configuration directory. Never point it at a development or customer database
you need to retain. It creates users and fixtures; some probes deliberately
revoke sessions or make storage unavailable. Reusing a previous run's state can
invalidate the proof.

Set `DATABASE_URL` to the fresh `tale_app` database and `TALE_CONFIG_DIR` to the
isolated test tree. Blob-backed probes also need a fresh S3-compatible service
through `ITEST_S3_ENDPOINT`; its test credentials default to `minioadmin` and can
be overridden by `ITEST_S3_ACCESS_KEY` / `ITEST_S3_SECRET_KEY`. Without that
endpoint the affected probes report skips, so do not describe the result as full
storage coverage. Supply a working `VIDEO_INGEST_FFMPEG_LOCATION` when the host's
ffmpeg is not at the path expected by the probe.

Use the [database image's readiness check](../../db/README.md) before starting the
suite. A bootstrap PostgreSQL process can accept a connection before initialization
finishes. `integration-check.ts` registers the proof lanes; a thrown lane or lost
shared session truncates the run as a failure. Identity-destructive probes must
create their own throwaway account instead of invalidating the shared one.
