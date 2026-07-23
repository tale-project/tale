---
name: create-migration
description: Use this skill whenever you add, change, move, test, or operate a versioned data migration — a Convex table reshape, an org-config file cutover, a Better Auth component transform, or a red migrations:check / check-migration-corpus gate. It owns the authoring contract (scaffold with gen:migration, define<Kind>Migration in one migration.ts, derived identity, declared subjects), the reversibility doctrine (idempotent up AND down, snapshot strategies, downTable for table moves), version truth (the per-release checkpoint store, the versions suite, re-homing with formerIds ledger aliases), the test contract (defineMigrationTest + the chain suite + the world corpus duty incl. version-boundary injections), and the operator surface (tale migrate status/up/down, the deploy hook, failure surfacing). Load it before touching anything under convex/migrations/; never hand-edit a registry.gen file or ship a migration the chain cannot cover.
---

# Convex migrations

Every data-shape change ships as a **versioned, reversible, idempotent** migration under
`services/platform/convex/migrations/versions/<vX_Y_Z>/<NN_slug>/`. The framework proves — per
migration and across the whole chain — that data survives `up ↔ down` byte-for-byte. Your job is
to keep that proof true; the gates make it hard to do otherwise.

## The one-command start

```bash
bun run gen:migration        # scaffolds migration.ts + migration.test.ts, registers it
```

Never hand-copy a neighbouring folder. The generator computes the `NN` prefix, picks the kind's
snapshot strategy, and runs `migrations:sync` so the scaffold is registered and shape-validated
before you write a line.

## The authoring contract

One `migration.ts` per folder, exporting exactly one factory call:

| Kind        | Factory                                         | Runs as                                | Typical job                                             |
| ----------- | ----------------------------------------------- | -------------------------------------- | ------------------------------------------------------- |
| `db`        | `defineDbMigration`                             | batched per-row mutations over `table` | reshape/backfill/move Convex rows                       |
| `node`      | `defineNodeMigration` (`'use node'` first line) | once per organization                  | rewrite org-config JSON under `$TALE_CONFIG_DIR/<org>/` |
| `component` | `defineComponentMigration`                      | batched over the Better Auth adapter   | transform auth component rows                           |
| `reference` | `defineReferenceMigration`                      | **never**                              | document an already-shipped change (audit trail)        |

Identity is **derived from the folder path** (`id`, `semver`, `numericId`, `slug`) — you write only
`title`, `description` (≥ 40 chars: say what `up` does AND how `down` reverses it), `destructive`,
`snapshot`, `subjects`, kind fields, and the handlers. The generated registries
(`framework/registry.gen.ts`, `registry.node.gen.ts`) are codegen output — regenerate with
`bun run --filter @tale/platform migrations:sync`, never edit.

Rules the factories and `migrations:check` enforce (so you don't have to remember them):
unique ids/orderKeys, contiguous `NN`, `'use node'` ⟺ node kind, destructive ⇒ snapshot,
`table-rows` never on a `v.id()`-referenced table, a sibling `migration.test.ts` that uses
`defineMigrationTest` for db/node kinds, a version checkpoint fixture for every version
folder (see "Version truth" below), and index truth — every `withIndex` in a runnable
migration must name an index the CURRENT schema defines (the live backend serves no
custom indexes on a table that left the schema; read legacy tables with a filtered scan —
the world schema keeps era indexes for shape validation, so vitest alone won't catch it).

### Re-homing a migration — `formerIds`

A migration lives in the version folder whose **release actually shipped its change** (the
versions suite proves this against real per-release schemas). If a shipped migration turns out to
be mis-homed, move the folder AND declare its shipped id:

```ts
formerIds: ['0.2.89/02_thread_files_absolute_paths'],
```

Deployments that applied it under the old id never re-run it: the apply actions adopt former-id
ledger rows before planning, status/plan queries fold them read-only, and snapshot restores
(table-rows pages, fs-tree sidecars) fall back to former-id captures. The codegen rejects
formerIds that collide with a live id. Two things NEVER change on a re-home: `formerIds` values
(they are live ledger keys) and any **persisted marker** the handlers write (e.g. an
`installedBy: 'migration:v0_2_90_…'` stamp or a sidecar filename) — those are frozen at the
original name even though the folder moved.

### Reversibility doctrine

- `up` and `down` are **idempotent**: the runner replays the crash batch (db) or the crashed
  org's page (node) on resume — a replayed, already-transformed row/org must be a no-op.
- `snapshot: 'table-rows'` — `up` backs each row up via `run.snapshotRow(scope, doc)` **before**
  destroying it; the generic restore rebuilds them on `down` (with fresh `_id`s — hence the FK
  guard). `'fs-tree'` — `up` calls `helpers.snapshotFsTree(dir)` first; `down` restores.
- **Moving rows to another table?** Declare `downTable: '<target>'` — `down` must walk the
  populated target; the legacy table is empty after `up` and a down over it silently restores
  nothing (a real bug the chain suite caught on its first run).
- `subjects` declares every table/domain the handlers touch. The corpus guard
  (`check-migration-corpus`) fails when the world cannot exercise a subject — a subject is covered
  when it is seeded at baseline, produced by an earlier migration (manifest `produces`), or
  injected at a version boundary (`world/injections.testkit.ts`).
- **Corpus rows live at their true version.** The baseline world must be a valid v0.2.84
  deployment (the versions suite validates it against the real 0.2.84 schema). A row whose table
  or shape was born later goes into `WORLD_INJECTIONS` keyed by the release that introduced it —
  the versions suite seeds it when its walk crosses that boundary; chains A/B/C run
  injection-free by design.
- Module scope must stay side-effect-free — the codegen imports every migration module.

## The test contract

`migration.test.ts` is a single `defineMigrationTest({ id, modules, seed, expectUp, … })` call
(see `convex/migrations/testing/harness.testkit.ts`). You provide data and migration-specific
truth; the harness runs the ritual through the **real production path**: real-runner up, TRUE
handler idempotency over migrated state, digest-equal down (the seeded world must come back
byte-for-byte), ledger transitions, snapshot hygiene, destructive gating, and — for node kinds —
the real org fleet loop with the registered betterAuth component. Edge scenarios go in `cases`;
pure transforms in `unit`. Reference tests call the handlers directly; the component kind's test
is hand-written until a sanctioned user-seeding support fn exists.

The chain suite (`convex/migrations/testing/chain.test.ts`) then runs EVERY runnable migration
0.2.84 → newest → 0.2.84 on every PR and requires frontier-by-frontier digest equality. The
real-stack twin (`bun run docker:test:migrations`, CI `migrations-e2e.yml`) replays the operator
surface against the live compose stack — never run it beside a running dev stack (it pins the
`tale-*` container names).

## Version truth: the checkpoint store + versions suite

`testing/versions/` holds the **ground truth of every released version**, extracted from git tags
into a content-addressed store: the Convex schema fingerprint, the org-config Zod schemas (as
JSON Schema), and the initialized-project scaffold of that era. The versions suite
(`testing/versions.test.ts`) holds the chain against it on every PR:

- the seed corpus must be a valid **v0.2.84** deployment;
- after the last migration of each version X, the world must be a valid **release-X** deployment
  (no rows in tables X does not declare, every row valid under X's real schema) — a mis-homed
  migration fails here with the release and table named;
- for each version X: a fresh project migrated `up --to X` validates as X, continues to newest,
  and `down --to X` restores the at-X world byte-identically.

**Cutting a release / creating a new version folder?** Run
`bun services/platform/scripts/dump-version-schemas.ts` once — the corpus guard fails any
migration version without a checkpoint fixture. `scripts/audit-migration-versions.ts` is the
read-only placement report (schema-diff + first-shipping-tag evidence).

## Schema changes: the snapshot ritual

`migrations:check` fingerprints the Convex schema and every org-config Zod schema against the
committed baselines. **Data-safe growth** (new optional field, widened union, removed config
field) → refresh with `bun run --filter @tale/platform migrations:snapshot`. **Data-incompatible**
(new required field, retype, narrowed union/literal, optional→required) → ship the migration that
reshapes existing data FIRST, then refresh — `migrations:check` names every drifted baseline.

## Operating migrations

- Every deploy runs `migrations:runAll`: non-destructive pending migrations apply automatically;
  destructive ones are skipped and warned. A failed migration never wedges the boot — it prints a
  grep-stable `[migrations][deploy-failure]` line, the entrypoint banners it, and
  `tale migrate status` shows the FAILED section with the recorded error.
- `tale migrate status` — frontier, pending, destructive flags, failures. `tale migrate up`
  (`--step` to review each, `--yes` for CI) applies pending; destructive steps snapshot first.
  `tale migrate down --to <version>` rolls back — the ledger makes both directions resumable.

## Definition of done

- [ ] `bun run --filter @tale/platform migrations:check` green (registries, guards, corpus, snapshots, checkpoints)
- [ ] `bunx vitest --run --project server convex/migrations` green — including the chain AND versions suites
- [ ] Schema change ⇒ snapshot ritual completed (safe refresh, or migration-first)
- [ ] New subject ⇒ corpus extended at its TRUE version (baseline seed, `produces`, or injection)
- [ ] New version folder ⇒ checkpoint fixtures dumped (`dump-version-schemas.ts`)
- [ ] Re-homed migration ⇒ `formerIds` declared; persisted markers untouched
