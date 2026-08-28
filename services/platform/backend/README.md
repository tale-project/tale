# Platform backend (0.5)

The Tale 0.5 backend: a Hono HTTP/SSE API plus pg-boss job queues, both on
PostgreSQL. It lives inside `@tale/platform` and ships in the **platform
image**: the same image starts as an `api` container or a `worker` container
(role picked at boot), replacing the separate Convex container. The default
deployment runs one of each; either role scales horizontally on its own. 0.5
is a fresh instance (no data migration), so this backend grows feature by
feature until it carries the whole product surface, then `services/convex`
and `convex/` are removed at cutover.

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
   normal authorized endpoints. No LISTEN/NOTIFY on the write path. Tier-1 hot
   streams (chat tokens, execution logs) will get dedicated SSE lanes, not the
   hint bus.

## Process roles

One codebase, one image, role via `ROLE`:

- `api` — HTTP + SSE only (the default `api` container); still runs a
  send-only pg-boss instance (`supervise: false`).
- `worker` — pg-boss workers only (the default `worker` container).
- `all` — both in one process; local-dev convenience only.

Environment: `DATABASE_URL` (required), `PORT` (default 3005), `ROLE`
(default `all`), `WORKER_CONCURRENCY` (default 5). Production runtime is
**Node** (>= 22.18) running the `.ts` sources directly with
`--experimental-transform-types` and the `node-loader.mjs` resolve hook — the
hook lets the backend import runtime-clean 0.4 modules (extensionless
specifiers under `../convex/**` and `../lib/**`) unchanged, so ports reuse
instead of fork-copying. Bun stays the package manager, build toolchain, and
dev runner for the rest of the workspace.

Run locally: `bun run --filter @tale/platform backend:dev` (needs
`DATABASE_URL`; `TALE_CONFIG_DIR`/`TALE_CONFIG_BUILTIN_DIR` for org-config
reads and scaffolding).

## Tests

- Unit tests ride the platform vitest `server` project:
  `bun run --filter @tale/platform test`.
- `bun run --filter @tale/platform backend:integration` — the real-Postgres
  proof (22 checks: boot migrations, serializable retry, transactional
  enqueue, worker pickup latency, auth + SSE replay, org scaffold drain,
  notifications bell, identity-domain smoke, login lockout, audit-chain
  verification). Needs a **throwaway** database:

  ```sh
  docker run --rm -d --name tale-backend-itest \
    -e POSTGRES_PASSWORD=itest -p 54329:5432 \
    ghcr.io/tale-project/tale/tale-db:latest
  # Wait for REAL readiness: pg_isready lies during first-boot init (the
  # bootstrap server accepts connections, then shuts down). The image writes
  # /tmp/.db_ready after init scripts + migrations — same gate compose uses.
  until docker exec tale-backend-itest test -f /tmp/.db_ready; do sleep 1; done
  DATABASE_URL=postgres://tale:itest@127.0.0.1:54329/tale \
    bun run --filter @tale/platform backend:integration
  docker stop tale-backend-itest
  ```

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

## Ported surface (so far)

`/api/app/*`: audit-logs, members, notifications, organizations,
user-preferences, users — see [MIGRATION.md](./MIGRATION.md) for the
domain-by-domain ledger and what each row still owes.

## Deliberately not here yet

SSO/trusted-headers/SCIM doors, 2FA org-enforcement hooks, crons, the
remaining domain ports (tracked in [MIGRATION.md](./MIGRATION.md)), proxy
routing, dev-loop integration.
