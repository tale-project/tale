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
| Who a billable call is booked under (the usage ledger's billing subject) | [`domains/governance/README.md`](domains/governance/README.md) |
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
| `WORKER_CONCURRENCY` | Jobs one worker process runs at once per queue, default `5` (1–64); agent turn starts get at least 8 and drive windows at least 16 per queue (`slotQueueSlots`); raise `KNOWLEDGE_DB_POOL_MAX` with it |
| `AGENT_START_SLOTS` | Agent turn starts one worker runs at once per lane, default `WORKER_CONCURRENCY` and at least 8 (1–256) |
| `AGENT_DRIVE_SLOTS` | Live agent turns' drive windows one worker runs at once per lane, default `WORKER_CONCURRENCY` and at least 16 (1–256); a worker drains about 2.5× this many live turns per lane before their windows wait past the recovery horizon |
| `KNOWLEDGE_DB_POOL_MAX` | Connections one process opens to the knowledge corpus, default `10`; an indexing job holds one per slice commit, so keep it at or above `WORKER_CONCURRENCY` |
| `SENTRY_DSN` | Optional error reporting |
| `BACKEND_SENTRY_TRACES_SAMPLE_RATE` | Manual HTTP and worker trace sample rate, `0` (disabled) by default, `0`–`1`; requires `SENTRY_DSN` and transaction support at the destination |

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
The ID token's `email`/`profile` claims come from Tale's own
`customIdTokenClaims` hook (`oidcScopeClaims` in [`auth/oidc.ts`](auth/oidc.ts)):
from Better Auth 1.7 the library itself delivers them at userinfo only.
[`auth/oidc.id-token.test.ts`](auth/oidc.id-token.test.ts) verifies the minted
token in the CI `test` lane, without a database; the **Backend integration** check
runs `oidc-integration.ts` over real HTTP and Postgres.

## Verify a backend change

```bash
bun run --filter @tale/platform test
bun run --filter @tale/platform backend:integration
```

CI runs the second command in the **Backend integration** check
(`.github/workflows/checks.yml`): on every push to `main`, merge group and release
candidate, and on every pull request that touches the backend, its libraries,
either database's migrations, `services/db`, the object-store pin, the
dependencies or the workflow. It builds `tale-db` from the commit's own
`services/db`, starts the object store the CLI pins
(`THIRD_PARTY_IMAGES['object-store']`) and runs the suite on the platform image's
Node with `ITEST_REQUIRE_ALL_LANES=1`. It calls the script directly, so its verdict is
never a turbo replay; the job's summary lists the failed checks. A lane that starts
importing a file outside that path list fails
[`tests/guards/integration-scope.guard.test.ts`](../tests/guards/integration-scope.guard.test.ts)
until the list names it. The suite's HTTP stays on the box:
[`integration-vendor-stub.ts`](integration-vendor-stub.ts) answers the shipped
vendor origins the lanes call (the OpenRouter and Vercel AI Gateway catalogs, the
AI title lane's Anthropic call), lets the object store through wherever
`ITEST_S3_ENDPOINT` points, and refuses any other host the way a network without
egress does, a redirect's next hop included. `safeFetch` and the video-link
pre-resolution read every name as a documentation-range address and never ask a
real resolver. A lane that needs a new vendor surface extends the stub, and a lane
that leaves its own `fetch` stub installed fails `harness: <lane> puts the
outbound boundary back`. The run's `[itest] off the box:` line names what the stub
answered and what was refused.

The job requires both `pg_search` and `vector` to be loaded. Its
`backend-integration-<run>-<attempt>` artifact retains the raw suite and service
logs, checked-out source and workflow identity, runtime versions, image identity,
extensions and suite-step exit code for 14 days, including failed runs. Configuration
trees are excluded. A setup failure can leave a partial bundle; the artifact's
presence alone is not a passing proof. The database build output remains in the
existing Buildx step's Actions log.

The second command requires a **fresh, disposable application database** and its
own configuration directory. Never point it at a development or customer database
you need to retain. It creates users and fixtures; some probes deliberately
revoke sessions or make storage unavailable. Reusing a previous run's state can
invalidate the proof.

`ITEST_LANES=checkWatchdogs,checkDevSeed` runs only the named lanes — to prove one
lane on the real schema while an unrelated earlier lane truncates the full run. The
tally names the filter; a filtered run is never full coverage.

Set `DATABASE_URL` to the fresh `tale_app` database and `TALE_CONFIG_DIR` to the
isolated test tree. Blob-backed probes also need a fresh S3-compatible service
through `ITEST_S3_ENDPOINT`; its test credentials default to `minioadmin` and can
be overridden by `ITEST_S3_ACCESS_KEY` / `ITEST_S3_SECRET_KEY`. Without that
endpoint the affected probes report skips, so do not describe the result as full
storage coverage. The transcription probe runs the real `ffmpeg` and `ffprobe`
from `PATH`. The video-link probe does not look at `PATH`: it hands yt-dlp an
explicit `--ffmpeg-location`, which is `VIDEO_INGEST_FFMPEG_LOCATION` or else
`/usr/bin/ffmpeg`. Set it whenever ffmpeg lives elsewhere, for example
`VIDEO_INGEST_FFMPEG_LOCATION="$(command -v ffmpeg)"` on Homebrew.

`ITEST_REQUIRE_ALL_LANES=1` asks for full coverage. The harness then refuses to
start with a lane filter or without all three `ITEST_S3_*` variables, and a check
that cannot run fails instead of reporting a skip. Every skip goes through
`recordSkip` in [`integration-lane-helpers.ts`](integration-lane-helpers.ts), and
lanes read the harness's own variables only through that module
(`tests/guards/integration-skips.guard.test.ts`). Without the flag a skip is a pass
whose name ends in `(SKIPPED)`, and the tally counts those apart.

Use the [database image's readiness check](../../db/README.md) before starting the
suite. A bootstrap PostgreSQL process can accept a connection before initialization
finishes. `integration-check.ts` registers the proof lanes; a thrown lane or lost
shared session truncates the run as a failure. Identity-destructive probes must
create their own throwaway account instead of invalidating the shared one. A lane
must also leave the shared user's organization memberships as it found them, or
it fails: every later `/api/v1` call on that user's keys would answer
`ORG_SLUG_REQUIRED`. A probe that needs another organization gives it an owner of
its own.

A lane that does not settle within 10 minutes truncates the run the same way, and
a truncated run still prints its tally and exits: the teardown closes the backend
the way the deployment does (ending every live `/events` stream, then any
connection a stuck lane still holds), and bounds each of its steps. A lane reads
`/events` through `connectSse` in
[`integration-lane-helpers.ts`](integration-lane-helpers.ts), whose `close()`
ends the tail within seconds or fails the lane naming it. The harness's outbound
boundary hands fetch the caller's own abort signal: a signal that only followed it
through an intermediate `Request` was lost to garbage collection, and a closed
tail then read on forever (#4112).

## Measure backend work

Prometheus request labels use a finite vocabulary of HTTP methods and mounted app
domains. Unknown methods and paths share fallback labels. Concurrent `/metrics`
scrapes share one render and one round of collectors; the next scrape reads afresh.

Set `BACKEND_SENTRY_TRACES_SAMPLE_RATE` above `0` to sample backend operations
independently of browser tracing. HTTP spans measure handler completion, excluding
response-body streaming and health/metrics probes. Worker spans measure each job
and its drain check, handler or handover. Jobs in a batch have independent traces.
Trace data contains bounded operation names, HTTP method/route class/status,
process role and release, without request/job payloads, raw SQL, identifiers,
URLs, inherited user context or breadcrumbs. Automatic performance integrations
stay disabled and outgoing requests receive no trace headers. See the
[operator guide](https://docs.tale.dev/self-hosted/configuration/observability-config)
for configuration and sampling limits.
