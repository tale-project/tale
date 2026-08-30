---
name: create-migration
description: Use this skill whenever you change the shape of the 0.5 backend database — a new table, a new column, an index, a constraint, a backfill, or a data reshape. It owns the authoring contract (one numbered .sql file under services/platform/backend/db/migrations/, applied at boot in filename order inside one advisory lock), the forward-only doctrine (every migration must be safe to apply to a live deployment mid-roll, because the previous image is still serving while the new one migrates), the org-config file lane (config trees are NOT database rows — they move through the scaffolder), and the proof duty (the real-Postgres integration check). Load it before adding anything under backend/db/migrations/.
---

# Backend database migrations (0.5)

Every database-shape change ships as a numbered SQL file under
`services/platform/backend/db/migrations/`. `runBootMigrations` (`backend/db/migrate.ts`) applies
them **at every backend boot**, in filename order, each in its own transaction, tracked by
filename in `app_migrations` — all inside one session-scoped advisory lock, so N concurrently
booting containers (api + worker, or scaled replicas) apply everything exactly once while the
others wait.

There is no `tale migrate up/down`, no versioned framework, no rollback ledger: a deployed image
is at its own schema by construction. `tale migrate` means something else entirely — re-provision
built-in defaults into every org (`/api/control/provision`).

> The 0.4 Convex versioned-migration framework (`defineDbMigration`, `migrations:runAll`,
> `tale migrate status/up/down`, the world corpus) is **retired**. 0.5 is a fresh instance and
> carries no data forward from it.

## The authoring contract

```
services/platform/backend/db/migrations/NNNN_snake_case_subject.sql
```

- **`NNNN`** is the next zero-padded number, no gaps, no reuse. Filename order IS apply order, and
  the filename is the identity recorded in `app_migrations` — **never rename a file that has
  shipped**, or every existing deployment re-applies it.
- **One subject per file.** The name says what it is (`0057_competence_records.sql`), not what you
  did (`0057_fix.sql`).
- **Everything lands in the `app` schema** (`CREATE TABLE app.x`), the app's own namespace. Better
  Auth owns the unqualified tables (`"user"`, `"member"`, `"organization"`) and migrates itself;
  pg-boss owns `pgboss`. Never write either from here.
- **Comment the WHY at the top**, and on any column whose meaning is not obvious from its name —
  these files are the schema's documentation. Look at `0057_competence_records.sql` for the house
  style (what the table is for, which rule an index encodes, why a row is retained rather than
  deleted).
- Timestamps are `bigint` epoch-millis columns named `*_at_ms` (the app's clock is JS). `id text
  PRIMARY KEY DEFAULT gen_random_uuid()` is the standard key.

## Forward-only, and safe to apply under a rolling deploy

The previous image keeps serving while the new one migrates, so **every migration must leave the
OLD code working**. That is the whole discipline:

| Change                  | How                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| New table               | Just create it.                                                                             |
| New column              | Nullable, or `NOT NULL DEFAULT …`. Never bare `NOT NULL` on a populated table.               |
| Retire a column         | Stop reading it in code and ship that FIRST; drop it in a later release.                     |
| Rename a column         | Two steps: add the new one + backfill, ship the code that writes both, then drop the old.    |
| New constraint          | Only if existing rows already satisfy it — otherwise clean the data in the same file, first. |
| New index               | Plain `CREATE INDEX` (each migration is one transaction, so `CONCURRENTLY` is unavailable).  |
| Backfill                | Set-based `UPDATE … WHERE` in the same file; it must be idempotent and bounded.              |

**Encode the rule in the schema when you can.** A partial unique index that says "at most one live
grant per member" is a rule the database cannot forget; the same rule written as a scan-and-compare
in a service is a rule the next handler will miss.

Use `IF NOT EXISTS` / `IF EXISTS` freely — a migration file runs once, but a re-run after a
half-failed deploy must not be a landmine.

## What does NOT belong here

- **Org config files** (agents, automations, connectors, providers, skills, governance policies)
  live on the config volume, not in Postgres. They move through the org scaffolder
  (`backend/domains/organizations/scaffold.ts`), which is idempotent per domain and re-runnable
  via `tale migrate` / `tale deploy --override-all`.
- **The knowledge corpus schema** has its own migrations under `services/db/migrations/knowledge-db/`,
  applied by `ensureDefaultCorpusSchema()`; a BYO corpus bootstraps on first use.
- **pg-boss queues** — declared in `backend/jobs/boss.ts`, created by `ensureQueues`.

## Prove it

A migration is not done until something exercises the shape it created:

- `bun run --filter @tale/platform backend:integration` — the real-Postgres proof. It runs boot
  migrations twice CONCURRENTLY (the advisory lock's own test) and then drives every domain over
  the real schema. Add a probe for the behaviour your migration enables; see the backend README
  for the throwaway-Postgres + MinIO invocation.
- `bunx vitest --run --project server` — the unit layer for the service that reads the new shape.

## Definition of done

- [ ] One numbered `.sql` file, no gap, never renamed after shipping
- [ ] Applies cleanly to a FRESH database and to one at the previous release
- [ ] The old code still works against the new schema (rolling-deploy safe)
- [ ] Rules that can be constraints/indexes are constraints/indexes
- [ ] A probe in `backend/integration-check.ts` covers what it enables
- [ ] `bun run --filter @tale/platform backend:integration` green
