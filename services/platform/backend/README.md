# Platform backend (0.5)

The Tale 0.5 backend: a Hono HTTP/SSE API plus pg-boss job queues, both on
PostgreSQL. It lives inside `@tale/platform` and ships in the **platform
image**: the same image starts as an `api` container or a `worker` container
(role picked at boot), replacing the separate Convex container. The default
deployment runs one of each; either role scales horizontally on its own. 0.5
is a fresh instance (no data migration). This backend now carries the whole
product surface. The domain logic ported from 0.4 lives in `core/` (driven
through the ctx-shim seams by the doors and jobs here); `MIGRATION.md` is the
campaign ledger that got it here.

## Constitution

Three rules every handler here follows. The Convex runtime enforced their
equivalents implicitly; the Postgres port enforces them by convention +
review + (eventually) lint guards:

1. **Writes run serializable and retried.** Every mutation-shaped handler goes
   through `transactSerializable` (`@tale/shared/db/serializable`), which
   reruns the whole transaction on SQLSTATE 40001/40P01. Callbacks are pure
   apart from their database writes — no `fetch`, no timers — because they
   re-execute on retry.
2. **Side effects are jobs, enqueued transactionally.** Anything beyond a
   database write (LLM calls, sandbox control, email, webhooks) is a pg-boss
   job enqueued via `addJobInTx` inside the same transaction as the state
   change (`send({ db })` rides the caller's tx) — rollback enqueues nothing,
   commit enqueues exactly once, delivery is at-least-once, so every task
   handler is idempotent, deduped via `singletonKey` derived from durable ids.
   Queues are declared in `jobs/tasks.ts` (one queue per identifier,
   notify-enabled: workers wake in milliseconds over LISTEN/NOTIFY, polling
   stays as the recovery backstop).
3. **Realtime is hints, not data.** Tier-2 live UI (boards, chips, badges) is
   fed by the `app_realtime.outbox` table: writers call `emitHintInTx` in the
   changing transaction, API pods fan hints out over `GET /events` (SSE), the
   web app maps hints to TanStack Query invalidations and refetches through
   normal authorized endpoints. No LISTEN/NOTIFY on the write path. Delivered
   hints are kept for an hour (`OUTBOX_RETENTION_MS`) and reclaimed by a
   bounded, strict-id-prefix sweep — ticked lazily from the `/events` poll
   loop while a browser is connected, and by the worker's
   `realtime.reclaim_outbox` cron so a headless deployment prunes too — and a
   client resuming from a cursor older than that gets a `resync` event and
   refetches its org scope. An open
   stream re-proves membership and the session every 15s and ends with a
   terminal `forbidden` event once either is gone. Tier-1 hot streams (chat
   tokens, execution logs) will get dedicated SSE lanes, not the hint bus.

## Process roles

One codebase, one image, role via `ROLE`:

- `api` — HTTP + SSE only (the default `api` container); still runs a
  send-only pg-boss instance (`supervise: false`).
- `worker` — pg-boss workers only (the default `worker` container).
- `all` — both in one process; local-dev convenience only.

Environment: `DATABASE_URL` (required), `PORT` (default 3005), `ROLE`
(default `all`), `WORKER_CONCURRENCY` (default 5), `SENTRY_DSN` (optional —
Sentry-compatible error reporting, errors only, no traces; see
`error-reporting.ts`). Production runtime is
**Node** (>= 22.18) running the `.ts` sources directly with
`--experimental-transform-types` and the `node-loader.mjs` resolve hook — the
hook lets the backend import the ported modules (extensionless specifiers
under `core/**` and `../lib/**`) unchanged, so ports reuse instead of
fork-copying. Bun stays the package manager, build toolchain, and
dev runner for the rest of the workspace.

Run locally: `bun run --filter @tale/platform backend:dev` (needs
`DATABASE_URL`; `TALE_CONFIG_DIR`/`TALE_CONFIG_BUILTIN_DIR` for org-config
reads and scaffolding).

`bun run dev` (repo root or this workspace) spawns this backend and the Vite
dev server together; Vite proxies `/api`, `/events`, `/dav`, and `/scim` here
(see `vite.config.ts`, `TALE_BACKEND_URL`). The app-side data layer lives in
`app/lib/backend/` (fetch client, `['backend', orgId, entity]` query keys,
and the `/events` hint → `invalidateQueries` hook).

## Tests

- Unit tests ride the platform vitest `server` project:
  `bun run --filter @tale/platform test`.
- `bun run --filter @tale/platform backend:integration` — the real-Postgres
  proof (380+ checks: boot migrations, serializable retry, transactional
  enqueue, worker pickup latency, auth + SSE replay, org scaffold drain, every
  migrated domain's surface, the REST machine door, SSO/SCIM, the task-agent
  and automation lanes, governance, cloud import, login lockout, audit-chain
  verification, the dev seeder). Every session-bearing lane runs through
  `runLanes`: a lane that throws, or one that leaves the suite's shared
  session dead, ends the run as a recorded `RUN TRUNCATED at lane N of M`
  failure — a run that executed fewer checks than it contains never reads as
  green. A probe that must invalidate its own session (2FA enrolment,
  sign-out, revocation) acts as a throwaway user, never as the shared one —
  and every extra identity a lane needs comes from `signUpOrgMember` (a
  member of the suite's org, `memberId` returned for role rewrites) or
  `signUpUser` (no membership yet: the members API under test, an org the
  user goes on to create, an account-only probe), never a hand-rolled
  sign-up. Needs a **throwaway** database and an S3 —
  the blob-backed lanes (files, documents, knowledge, residency, chat) skip
  visibly without `ITEST_S3_ENDPOINT`, and `TALE_CONFIG_DIR` is where the
  probes write the deployment-default config tree:

  ```sh
  docker run --rm -d --name tale-backend-itest \
    -e POSTGRES_PASSWORD=itest -p 54329:5432 \
    ghcr.io/tale-project/tale/tale-db:latest
  docker run --rm -d --name tale-itest-minio -p 59000:9000 \
    -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
    quay.io/minio/minio:latest server /data
  # Wait for REAL readiness: pg_isready lies during first-boot init (the
  # bootstrap server accepts connections, then shuts down). The image writes
  # /tmp/.db_ready after init scripts + migrations — same gate compose uses.
  until docker exec tale-backend-itest test -f /tmp/.db_ready; do sleep 1; done
  DATABASE_URL=postgres://tale:itest@127.0.0.1:54329/tale \
    ITEST_S3_ENDPOINT=http://127.0.0.1:59000 \
    TALE_CONFIG_DIR=$(mktemp -d) \
    bun run --filter @tale/platform backend:integration
  docker stop tale-backend-itest tale-itest-minio
  ```

  Credentials default to `minioadmin` / `minioadmin`; override with
  `ITEST_S3_ACCESS_KEY` / `ITEST_S3_SECRET_KEY`.
  The fake video downloader still generates real audio. On a macOS/Homebrew
  host, also set `VIDEO_INGEST_FFMPEG_LOCATION=/opt/homebrew/bin/ffmpeg` (or the
  installed absolute path); Linux defaults to the image's `/usr/bin/ffmpeg`.

  **Both** services must be THROWAWAY, recreated per run. Reusing the
  database truncates the run at the first lane that re-creates a fixture
  user (`duplicate key … user_email_key`); reusing the object store fails
  the bootstrap probe, which deletes the bucket to simulate a vanished
  store and cannot delete one a previous run left objects in.

## Auth & migrations

- **Better Auth on Postgres** (`auth/`): email+password with the 0.4
  login-throttle gate (per-IP flood guard + per-account exponential lockout),
  the organization plugin (teams, access-control role matrix, slug/name
  hooks, scaffold-on-create), and the apiKey / twoFactor / passkey plugins —
  all served under `/api/auth/*`. Session middleware (`requireSession`) gates
  app routes; org scope is checked against the `member` table
  (`requireOrgMember` / `auth/membership.ts` — the 0.4 mirror apparatus is
  gone). Requires `BETTER_AUTH_SECRET` (api/all roles) and `SITE_URL` (the
  public origin cookies bind to; HTTPS enforced for non-loopback hosts).
  Note: Better Auth rejects POSTs without an `Origin` header (CSRF policy) —
  non-browser clients must send one.
- **Boot migrations** (`db/migrate.ts`): app SQL migrations from
  `db/migrations/*.sql` (tracked in `app_migrations`) plus Better Auth's own
  schema migrations, all inside one session-scoped advisory lock so
  concurrently booting containers apply everything exactly once. pg-boss
  migrates its own `pgboss` schema on `start()`. Better Auth creates
  unqualified tables — they land in the first `search_path` schema (`tale` on
  the tale-db image).
- **Knowledge index verification** (`domains/knowledge/index-health.ts` over
  `core/knowledge/index_health.ts`): every role verifies the default corpus's
  BM25 indexes with `pdb.verify_index` before it serves or consumes jobs — a
  block zeroed by a crash-mode stop otherwise PANICs the knowledge database on
  every chunk insert. An unhealthy index at most
  `KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES` (1 GiB) is rebuilt inline; a
  larger one by the `knowledge.reindex_bm25` job (`REINDEX CONCURRENTLY`)
  while writes to that corpus are refused with `rag_error_code`
  `index_rebuilding`. One attempt per index per process, an advisory lock on
  the knowledge database so one process repairs, and every outcome lands in
  the logs, the audit log (`knowledge_index_*`, actor `system`), and the admin
  bell. Bring-your-own corpora get the same check inside their pool bootstrap.
  `KNOWLEDGE_INDEX_REPAIR_DISABLED=1` switches it off.

## Surface

Every product domain is served here — `/api/app/*`, the `/api/v1` REST
machine door, `/api/auth`, `/events`, `/dav`, `/scim`, webhooks, and the
pg-boss job lanes (automations, agent turns, sync, watchdogs, crons).
[MIGRATION.md](./MIGRATION.md) is the completed campaign ledger — the
domain-by-domain record of how each surface got here and the semantics it
carries.

## Native conversation sources

The `/api/v1/conversations` family synchronizes an external app's conversation
system with the native Inbox. Its OpenAPI contract is served at `/docs`, generated
from the same snapshot schema the handler validates. It requires an editor-or-above
API-key user and an explicit `X-Organization-Slug` on every request. A dedicated
service user owns each `(organization, source, externalId)` binding; replacing that
user's key does not change ownership.

Create the customer's contact first with `/api/v1/contacts/bulk` and a stable
`externalId`. POST a complete, bounded source snapshot to `/conversations/sync`.
For contact updates, optional `expectedUpdatedAt` on `PATCH /contacts/:id` checks
the current revision under the row lock. Stale writes return `409 CONTACT_STALE`
without changing data. Refetch and merge source-owned fields before retrying;
every successful update advances `updatedAt`, even when the clock does not.
The source revision is an increasing integer: a replay is a no-op, conflicting
content at the same revision is refused, and an older revision cannot undo newer
content. Attachments are org-scoped, owned uploads with verified sizes. Reading the
snapshot state returns its revision and bound attachment refs for crash recovery.

An office reply on this API channel writes a native queued Inbox message and a
durable delivery row in one transaction. It never schedules an email send. The
external worker claims due deliveries, commits them idempotently in its app using
the Tale message ID, then acknowledges with that app's message ID and committed
source revision. Older snapshots cannot retract that newer receipt. Claim closes the
undo window; acknowledgement links the existing native row to its source receipt
so later source edits/retractions update that row without an echo. Unacknowledged
replies are never removed by a source snapshot. A deleted source snapshot closes
the binding and removes only acknowledged/source-owned messages.

Claims carry a five-minute visibility lease and a fresh `claimToken`. Report
failures through `/deliveries/:id/fail` with an allowlisted error code; duplicate
or stale claim reports do not alter a newer attempt. Transient failures back off
from one minute to one hour, stopping after ten reports. Permanent refusals stop
immediately. Failed messages reuse native Inbox Retry/Discard, and retry restarts
the API outbox without scheduling email. API outbox rows are excluded from the
email-job watchdog. Only static error codes are stored, never destination bodies.

Migration `0086_conversation_api_sync.sql` adds bindings, message receipts and the
delivery outbox without altering existing rows. The native integration probe
`domains/conversations/api-sync.integration.ts` exercises replay, tenant/user
isolation, key rotation, attachments, reply/undo/claim/ack, edits and tombstones
against real HTTP and Postgres. API source presence opens the Inbox without a
deployed email automation; existing assignment privacy and write roles still apply.

## Native identity clients

The `@better-auth/oauth-provider` plugin owns OIDC discovery, RS256 signing keys,
authorization codes, PKCE validation and native token storage. Boot uses the
existing advisory-locked Better Auth migration path; no separate issuer service
or seed credentials are required. `/api/app/identity/clients` is the only client
administration door: current org administrators, matching active org and browser
Origin, strict HTTPS callback, organization-serialized idempotent registration.
Its create response shows the secret once; drift requires explicit review, and
rotation/status routes keep the same org-bound client ID. Native organization
retirement removes these clients and cascades grants through the provider's FKs.

External access-token audiences are disabled (`validAudiences: []`); the provider
permits only its native userinfo audience for OpenID scopes. REST continues to
require native API keys. This enforces the single-resource mitigation for
[GHSA-p2fr-6hmx-4528](https://github.com/advisories/GHSA-p2fr-6hmx-4528), whose
stable 1.6.x provider line does not bind resource indicators to authorization
grants. The real identity probe refuses foreign and API-base resource requests,
verifies the userinfo audience, and refuses that access token at REST routes.

A verified native email, current membership in the client's organization and
native MFA policy are required for signed identity claims. Verified Entra Graph
identity can reconcile an existing member's email verification flag, but may
never change a linked subject, rename the user or link a nonmember. The browser
keeps the signed OAuth query through native login and MFA; Better Auth's fetch
plugin owns the single redirect after consent. The browser's existing Sentry
normalizer removes request bodies, credentials and URL queries/fragments,
including navigation breadcrumbs, so authorization codes/state stay local.

`backend/auth/oidc-integration.ts` is mounted in `backend:integration` and proves
the real HTTP/Postgres code flow, replay and concurrent redemption, PKCE, nonce,
issuer/discovery, membership/MFA loss, trusted SSO reconciliation, secret
rotation, disable/reenable and organization retirement. Component
`oauth-authorization.test.tsx` covers consent accessibility and prevents duplicate
callback navigation; `resume-oauth.test.ts` preserves repeated signed parameters
while refusing foreign return paths. Consumer setup is in the localized
[API reference](../../../docs/en/develop/api-reference.md).
