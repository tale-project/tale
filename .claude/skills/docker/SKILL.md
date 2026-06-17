---
name: docker
description: The local Docker stack — compose files, Dockerfiles, the two-Postgres + dbmate model, the sandbox containers, and SQL-migration / Bash-entrypoint conventions. Read before touching compose.*.yml, a Dockerfile, services/db migrations/entrypoint, or the sandbox containers; or when a fresh stack has empty knowledge schemas (queries fail with undefined_table / 42P01). Convex DB-schema changes live in convex-migrations.
---

# docker

How the Tale stack runs in containers: the root [`compose.*.yml`](../../../) files, the per-service
`Dockerfile`s, the **two-Postgres** model (Convex owns the platform DB; dbmate owns the knowledge
corpus), and the three sandbox containers. This is also the home for SQL-migration conventions and
Bash-in-entrypoint basics. Convex data-model changes are a different concern — see
[`convex-migrations`](../convex-migrations/SKILL.md). SSRF/egress posture cross-links
[`security`](../security/SKILL.md); entrypoint shell idioms cross-link [`bash`](../bash/SKILL.md).

## When this applies

Editing any root `compose.*.yml`, a `services/*/Dockerfile`,
[`services/db/`](../../../services/db/) (entrypoint, init-scripts, migrations), or the sandbox trio
([`sandbox`](../../../services/sandbox/), [`sandbox-egress`](../../../services/sandbox-egress/),
[`sandbox-runtime`](../../../services/sandbox-runtime/)). Also when a freshly-built stack has empty
knowledge schemas — a sign a migration didn't ship or didn't run.

## Compose files (root)

`compose.yml` is the base, **local-dev-only** stack (exposes `5432` + app ports `8001-8003` that prod
never exposes; prod configs come from `tale deploy`). Overlay with `-f`:

- `compose.dev.yml` — source mounts + relaxed health checks + debug logs for HMR (`-f compose.yml -f compose.dev.yml up --build`).
- `compose.test.yml` — container-e2e: shifts ports off the host to avoid collisions in CI.
- `compose.test.mock.yml` — minimal DB-only port mock (`db` on `15432`).
- `compose.bifrost.dev.yml` — applied **only** when Convex + Vite run on the host (`scripts/dev.ts`), never by the fully-dockerized dev command; publishes Bifrost on loopback.
- `compose.docs.yml` / `compose.docs.test.yml` — standalone docs site + its CI overrides.
- `compose.web.yml` / `compose.web.test.yml` — standalone marketing site + its CI overrides.

`docker:*` scripts in the root `package.json`: `docker:build` (turbo), `docker:up` (`compose up -d`),
`docker:down`, `docker:logs`. Container integration tests under
[`services/platform/tests/integration/`](../../../services/platform/tests/integration/):
`docker:test` (smoke), `docker:test:image`, `docker:test:web`, `docker:test:docs`,
`docker:test:sandbox-runtime`, `docker:test:vulnerability`, and `docker:e2e` (full master e2e).

## The rules

- **A schema change ships its migration in the SAME PR, and you verify a clean `docker compose up`
  populates both knowledge schemas.** An orphaned migration leaves the corpus DB tableless and every
  query fails with `undefined_table` / `42P01`. Reviewer- and runtime-caught.
- **`TALE_DB_ROLE` picks the migration set, not the image.** The `db` and `knowledge-db` services run
  the _same_ `tale-db` image; `db` sets `platform` (skips corpus migrations — Convex owns that
  schema), `knowledge-db` sets `knowledge` (applies the corpus). Default is `knowledge` so a
  standalone/misconfigured run never strands the corpus DB. See the pattern below.
- **`migrations/db/` stays empty.** The platform/`tale_platform` schema is migrated by `bunx convex
deploy`, not dbmate. Only add raw SQL there for things Convex can't express (extensions, roles).
- **Migration files are idempotent and reversible-by-intent.** Timestamped
  `YYYYMMDDhhmmss_desc.sql`, one schema per file, `CREATE … IF NOT EXISTS` so re-runs on every
  container start are no-ops. A `migrate:down` that can't truly reverse a baseline says so explicitly
  (don't fake it).
- **Init-scripts create infra, never tables.** `services/db/init-scripts/*.sql` are idempotent
  (`IF NOT EXISTS` / `CREATE OR REPLACE`) and own extensions, databases, and role grants — table DDL
  belongs in migrations. They run _before_ migrations; `/tmp/.db_ready` is touched only after both
  succeed, so dependents wait on the tables, not just the socket.
- **Same image, two roles → don't fork the Dockerfile.** Use multi-stage builds and order layers for
  cache hits (deps before source). Role selection is a runtime env var, not a build arg.
- **Entrypoints split PID-1 setup from the long-running process.** `docker-entrypoint.sh` does
  privileged/one-time setup as PID 1, then `exec`s `entrypoint.sh` so SIGTERM reaches the real
  process. Never background the main process — `exec` it. (The db image renames the upstream script to
  `postgres-entrypoint.sh` so its `exec` doesn't recurse into the wrapper.)

## Patterns

A dbmate migration ([`knowledge-db/private_knowledge/…_baseline.sql`](../../../services/db/migrations/knowledge-db/private_knowledge/)).
One schema per file; `up` is idempotent; `down` is honest:

```sql
-- migrate:up
CREATE SCHEMA IF NOT EXISTS private_knowledge;
CREATE TABLE IF NOT EXISTS private_knowledge.documents (
    id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- …
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
-- Baseline is not reversible once later migrations build on it.
-- To reset: DROP SCHEMA private_knowledge CASCADE;
```

The `TALE_DB_ROLE` gate ([`services/db/docker-entrypoint.sh`](../../../services/db/docker-entrypoint.sh)) —
the role, set per-service in compose, chooses the set; each schema keeps its own
`<schema>.schema_migrations` table, so dbmate runs once per schema subdir against `tale_knowledge`,
with a retry/backoff loop (first-time PG init bounces its bootstrap server):

```bash
case "$TALE_DB_ROLE" in
  knowledge) dbmate_up_schema private_knowledge && dbmate_up_schema public_web ;;  # corpus
  platform)  echo "Convex-managed; no dbmate migrations." ;;                       # db service
  *)         dbmate_up_schema private_knowledge && dbmate_up_schema public_web ;;  # safe default
esac
# dbmate --url …?sslmode=disable --migrations-dir "$dir" \
#        --migrations-table "${schema}.schema_migrations" up   # retried 30× w/ sleep 2
```

## The sandbox trio

Three cooperating containers (read their `README.md`s before editing):

- [`sandbox`](../../../services/sandbox/) — a thin, **stateless** `docker run` spawner that launches
  one ephemeral `sandbox-runtime` container per execute call (plus optional persistent sessions).
  Mounts the host docker socket (an accepted threat boundary).
- [`sandbox-egress`](../../../services/sandbox-egress/) — `tinyproxy` behind an `iptables` SSRF
  firewall. All runtime egress is forced through it; REJECT rules block the cloud-metadata endpoint
  (IMDS) and RFC1918 ranges. **Fails closed** — if firewall rules can't install, the proxy won't
  start. Security-critical; pair edits with [`security`](../security/SKILL.md).
- [`sandbox-runtime`](../../../services/sandbox-runtime/) — the ephemeral Python/Node executor, in
  one-shot or persistent-session (`daemon`) mode, with all egress REDIRECTed through the proxy and
  debug/VNC endpoints bound loopback-only.

Each uses the split entrypoint (`docker-entrypoint.sh` PID-1 setup → `exec entrypoint.sh`).

## Verify

After a schema or compose change, run a clean `docker compose -f compose.yml up --build` and confirm
both `private_knowledge` and `public_web` tables exist (and that dependents pass their health checks),
not just that the container started. See [`verify`](../verify/SKILL.md).
