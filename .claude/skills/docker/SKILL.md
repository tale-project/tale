---
name: docker
description: The local Docker stack — root compose.*.yml files, per-service Dockerfiles, the two-Postgres + dbmate model, and the three sandbox containers, plus SQL-migration and Bash-entrypoint conventions. Read before touching a compose.*.yml, a Dockerfile, services/db (entrypoint/init-scripts/migrations), or the sandbox containers; or when a fresh stack has empty knowledge schemas (queries fail with undefined_table / 42P01). Convex data-model changes live in convex-migrations.
---

# docker

How the Tale stack runs in containers: the root [`compose.*.yml`](../../../) files, the per-service
`Dockerfile`s, the **two-Postgres** model (Convex owns the platform DB; dbmate owns the knowledge
corpus), and the three sandbox containers — plus the SQL-migration conventions. Convex data-model
changes are a different concern ([`convex-migrations`](../convex-migrations/SKILL.md)); entrypoint
shell idioms are [`bash`](../bash/SKILL.md); SSRF/egress posture is [`security`](../security/SKILL.md).

## When this applies

Editing any root `compose.*.yml`, a `services/*/Dockerfile`,
[`services/db/`](../../../services/db/) (entrypoint, init-scripts, migrations), or the sandbox trio
([`sandbox`](../../../services/sandbox/), [`sandbox-egress`](../../../services/sandbox-egress/),
[`sandbox-runtime`](../../../services/sandbox-runtime/)). Also when a freshly-built stack has empty
knowledge schemas — a sign a migration didn't ship or didn't run.

## Compose files (root)

`compose.yml` is the base, **local-dev-only** stack (exposes `5432` + app ports `8001-8003` that prod
never exposes; prod configs come from `tale deploy`). Overlay with `-f`:

- `compose.dev.yml` — source mounts + relaxed health checks + debug logs for HMR
  (`-f compose.yml -f compose.dev.yml up --build`).
- `compose.test.yml` — container-e2e: shifts ports off the host to avoid CI collisions.
- `compose.test.mock.yml` — DB-only port mock (`db` on `15432`).
- `compose.bifrost.dev.yml` — applied **only** when Convex + Vite run on the host (`scripts/dev.ts`),
  never by the fully-dockerized dev command; publishes Bifrost on loopback (`127.0.0.1:8080`).
- `compose.docs.yml` / `compose.web.yml` (+ their `*.test.yml`) — standalone docs / marketing sites.

Root `package.json` scripts: `docker:build` (turbo), `docker:up`, `docker:down`, `docker:logs`.
Container integration suites under
[`services/platform/tests/integration/`](../../../services/platform/tests/integration/) run via
`docker:test` (smoke), `docker:test:image|web|docs|sandbox-runtime|vulnerability`, and `docker:e2e`
(full master e2e) — these are direct-run Bun, not Vitest (see [`testing`](../testing/SKILL.md)).

## The rules

- **A schema change ships its migration in the SAME PR, and you verify a clean `docker compose up`
  populates both knowledge schemas.** An orphaned migration leaves the corpus DB tableless and every
  query fails with `undefined_table` / `42P01`. Reviewer- and runtime-caught.
- **`TALE_DB_ROLE` picks the migration set, not the image.** The `db` and `knowledge-db` services run
  the _same_ `tale-db` image; `db` sets `platform` (skips corpus migrations — Convex owns that schema)
  and `knowledge-db` sets `knowledge` (applies the corpus). Default is `knowledge` so a
  standalone/misconfigured run never strands the corpus DB. The selection lives in
  [`services/db/docker-entrypoint.sh:178`](../../../services/db/docker-entrypoint.sh); see the snippet.
- **`migrations/db/` stays empty.** The `tale_platform` schema is migrated by `bunx convex deploy`,
  not dbmate. Add raw SQL there only for things Convex can't express (extensions, roles).
- **Migration files are idempotent and reversible-by-intent.** Timestamped `…_desc.sql`, one schema
  per file, `CREATE … IF NOT EXISTS` so re-runs on every container start are no-ops. A `migrate:down`
  that can't truly reverse a baseline says so explicitly — don't fake it.
- **Init-scripts create infra, never tables.** [`services/db/init-scripts/*.sql`](../../../services/db/init-scripts/)
  are idempotent and own extensions, databases, and role grants; table DDL belongs in migrations. They
  run _before_ migrations, and `/tmp/.db_ready` is touched only after both succeed — so dependents
  wait on the tables, not just the socket.
- **Same image, two roles → don't fork the Dockerfile.** Multi-stage builds, layers ordered for cache
  hits (deps before source). Role selection is a runtime env var, not a build arg.
- **Entrypoints split PID-1 setup from the long-running process.** `docker-entrypoint.sh` does
  privileged/one-time setup as PID 1, then `exec`s the next stage so SIGTERM reaches the real process;
  never background the main process. The full two-file idiom is [`bash`](../bash/SKILL.md). (The db
  image renames the upstream script to `postgres-entrypoint.sh` so its `exec` doesn't recurse.)

## Patterns

A dbmate migration — one schema per file, idempotent `up`, honest `down`
([`migrations/knowledge-db/private_knowledge/…_baseline.sql`](../../../services/db/migrations/knowledge-db/private_knowledge/)):

```sql
-- migrate:up
CREATE SCHEMA IF NOT EXISTS private_knowledge;
CREATE TABLE IF NOT EXISTS private_knowledge.documents (
    id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
-- Baseline is not reversible once later migrations build on it.
-- To reset: DROP SCHEMA private_knowledge CASCADE;
```

The `TALE_DB_ROLE` gate — each schema keeps its own `<schema>.schema_migrations` table, so dbmate
runs once per schema subdir against `tale_knowledge`, retried with backoff (first-time PG init bounces
its bootstrap server) ([`services/db/docker-entrypoint.sh:178`](../../../services/db/docker-entrypoint.sh)):

```bash
case "$TALE_DB_ROLE" in
  knowledge) dbmate_up_schema private_knowledge && dbmate_up_schema public_web ;;  # corpus
  platform)  echo "Convex-managed; no dbmate migrations." ;;                       # db service
  *)         dbmate_up_schema private_knowledge && dbmate_up_schema public_web ;;  # safe default
esac
```

## The sandbox trio

Three cooperating containers (read their `README.md`s before editing); each uses the split entrypoint:

- [`sandbox`](../../../services/sandbox/) — a thin, **stateless** `docker run` spawner that launches
  one ephemeral `sandbox-runtime` per execute call (plus optional persistent sessions). Mounts the
  host docker socket (an accepted threat boundary).
- [`sandbox-egress`](../../../services/sandbox-egress/) — `tinyproxy` behind an `iptables` SSRF
  firewall; all runtime egress is forced through it; REJECT rules block the cloud-metadata endpoint
  (IMDS) and RFC1918 ranges. **Fails closed** — if rules can't install, the proxy won't start.
  Security-critical; pair edits with [`security`](../security/SKILL.md).
- [`sandbox-runtime`](../../../services/sandbox-runtime/) — the ephemeral Python/Node executor
  (one-shot or persistent `daemon` mode), egress REDIRECTed through the proxy, debug/VNC endpoints
  bound loopback-only.

## Verify

After a schema or compose change, run a clean `docker compose -f compose.yml up --build` and confirm
both `private_knowledge` and `public_web` tables exist (and dependents pass health checks) — not just
that the container started. See [`verify`](../verify/SKILL.md).
