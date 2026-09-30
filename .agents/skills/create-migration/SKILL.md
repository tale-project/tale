---
name: create-migration
description: Use this skill whenever you change the shape of the 0.5 backend database — a new table, a new column, an index, a constraint, a backfill, or a data reshape. It owns the authoring contract (one numbered .sql file under services/platform/backend/db/migrations/ — or a numbered .ts data migration when a backfill must decide with the app's own code — applied at boot in filename order inside one advisory lock), the forward-only doctrine (every migration must be safe to apply to a live deployment mid-roll, because the previous image is still serving while the new one migrates), the org-config file lane (config trees are NOT database rows — they move through the scaffolder), and the proof duty (the real-Postgres integration check). Load it before adding anything under backend/db/migrations/.
---

# Backend database migrations (0.5)

Every database-shape change ships as a numbered SQL file under
`services/platform/backend/db/migrations/` (a backfill that must decide with the app's own code
is a numbered `.ts` data migration there — see below). `runBootMigrations`
(`backend/db/migrate.ts`) applies them **at every backend boot**, in filename order, each in its
own transaction, tracked by filename in `app_migrations` — all inside one session-scoped advisory
lock, so N concurrently booting containers (api + worker, or scaled replicas) apply everything
exactly once while the others wait.

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
| Backfill                | Set-based `UPDATE … WHERE` in the same file; idempotent and bounded (`.ts`: see below).       |

**Encode the rule in the schema when you can.** A partial unique index that says "at most one live
grant per member" is a rule the database cannot forget; the same rule written as a scan-and-compare
in a service is a rule the next handler will miss.

Use `IF NOT EXISTS` / `IF EXISTS` freely — a migration file runs once, but a re-run after a
half-failed deploy must not be a landmine.

## Data migrations in TypeScript

A backfill whose decision is a rule the application already owns — which files an extractor reads
(`isSupported()`), which MIME types are media — must not freeze a SQL copy of that rule: the copy
is a second source of truth the moment the real one moves. Write it as a numbered `.ts` module in
the same directory instead:

```
services/platform/backend/db/migrations/NNNN_snake_case_subject.ts
```

- It exports `migrate(tx: TransactionSql): Promise<void>`. The migrator imports it by filename and
  runs it inside the migration's own transaction, in the same filename order and the same
  `app_migrations` ledger as the `.sql` files (`isMigrationFile` in `backend/db/migrate.ts`; a
  `.test.ts` or `.d.ts` beside it is never applied).
- Same rules as SQL: WHY at the top, idempotent, bounded, rolling-deploy safe. Read only the rows
  that can need the fill, lock them (`FOR UPDATE`), re-check the condition in the `UPDATE`, and
  write set-based (`unnest` of the ids and values the app's rule decided). A status write that a
  list renders emits its hint once per organization, and only for rows a list shows — written in
  the migration as an `INSERT INTO app_realtime.outbox`, like every other statement (below).
- **Import only pure rules; write every statement in the file.** A data migration runs against the
  schema as it stood at its own number, but with the code of whichever image applies it — a
  database that jumps past several releases runs it with the newest. Anything that runs SQL
  follows TODAY's schema: a domain service, `emitHintInTx` from `realtime/outbox.ts`, a job
  enqueue, a SQL fragment such as `HELD_BY_DOCUMENT_SQL`. Import one, and the release that
  reshapes its table and updates it runs the new SQL on the old table — the migration fails, or
  quietly does something else. Import only what decides from its arguments and runs no SQL and no
  I/O — `isSupported()`/`isImageFile()`, the `RAG_ERROR_*` codes, the sentence helpers in
  `backend/core/knowledge/rag_unsupported.ts` — and write the reads, the writes, an `EXISTS`
  probe and the hint's `INSERT` yourself. `backend/db/data-migrations.test.ts` walks every data
  migration's imports, transitively, and fails on a module outside its `PURE_RULES` list and on a
  package outside its `PURE_PACKAGES` list (`node:fs`, `@tale/shared/db/…`, or a runtime
  `postgres` — only `import type` from it is admitted); a rule module or a package joins its list
  only once it is known to be pure, with why.
- Schema changes stay `.sql` — those files are the schema's documentation. Scaffold with
  `bun run gen:migration`, kind `ts`; `0128_rag_unsupported_type_codes.ts` and
  `0129_rag_unsupported_image_codes.ts` are the reference — each fills the code the indexer's rule
  implies on rows written before every lane wrote it. A fill that grows once its migration may
  have run anywhere (a `main` image boots it too, not only a release) takes a new number, as
  `0129` did, never an edit of the applied file: a database that has it never runs it again.
- Prove it the way SQL backfills are proven: seed the rows in `backend/integration-check.ts`,
  import the module and run `migrate` in a transaction twice (the second run changes nothing), and
  pin its decision table with a unit test in `backend/db/data-migrations.test.ts`, which also
  guards that every `.ts` migration exports `migrate` and reaches only pure rules.

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
  for the throwaway-Postgres + MinIO invocation. CI's **Backend integration** check runs it on the
  pull request against the `tale-db` image built from it, and fails on any lane that did not run.
- `bunx vitest --run --project server` — the unit layer for the service that reads the new shape.

## Definition of done

- [ ] One numbered `.sql` file (or `.ts` data migration), no gap, never renamed after shipping
- [ ] A `.ts` data migration writes every statement itself and imports only pure rules
- [ ] Applies cleanly to a FRESH database and to one at the previous release
- [ ] The old code still works against the new schema (rolling-deploy safe)
- [ ] Rules that can be constraints/indexes are constraints/indexes
- [ ] A probe in `backend/integration-check.ts` covers what it enables
- [ ] `bun run --filter @tale/platform backend:integration` green, and the pull request's
      **Backend integration** check with it
