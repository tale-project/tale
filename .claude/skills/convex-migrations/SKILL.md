---
name: convex-migrations
description: How to author versioned, reversible, tested Convex data migrations in services/platform/convex/migrations. Read before any Convex data-model change — adding/renaming/retyping a field, splitting/dropping a table, or backfilling stored data. Triggers — "this needs a migration", required-field/retype/rename, table split/drop, backfill stored rows, registering a migration, `migrations:check` failing, ledger/snapshot/rollback questions.
---

# convex-migrations

The framework for one reversible, version-pinned data transformation under
[`services/platform/convex/migrations/`](../../../services/platform/convex/migrations/).
Backend code mechanics (queries, RLS, the node/V8 boundary) live in
[`convex`](../convex/SKILL.md); the runtime that applies these on deploy is the tale-db /
platform container — see [`docker`](../docker/SKILL.md). Migrations are mandatory, tested, and
gated in CI; do not hand-write a one-off backfill query instead.

## When this applies

Whenever a schema change touches **stored data**, not just types:

- **Rollback-safe, NO migration:** adding a new _optional_ field or a brand-new table. The old
  binary tolerates it; just edit the schema.
- **Needs a migration:** a new _required_ field, a field rename or retype, splitting one table into
  two, or dropping a table/column with live rows. Convex validates _existing_ rows against the new
  schema at push time, so the data must be reshaped first.

## The rules

- **`up` MUST be idempotent.** The runner paginates in batches and resumes from the last committed
  cursor after a crash, so re-running over an already-migrated row is a no-op (guard with an
  existence check). Same for `down`. Stated in [`framework/types.ts`](../../../services/platform/convex/migrations/framework/types.ts).
- **Ship a `down`.** Every migration is reversible (`reversible: true` is a framework invariant).
  If `up` loses information, declare a `snapshot` strategy (`table-rows` / `fs-tree`) so `down` can
  rebuild — `enforced by` `migrations:check`.
- **Register it in two places.** Its `meta` goes in `ALL_META`, and a runnable `db` migration goes
  in `DB_MIGRATIONS` ([`framework/registry.ts`](../../../services/platform/convex/migrations/framework/registry.ts)) —
  a `node` migration's handler goes in `registry.node.ts` (`'use node'`, never value-imported by
  V8). Unregistered = never runs, and CI fails.
- **Tests are mandatory.** A sibling `migration.test.ts` round-trips `up` → `down` and asserts the
  ledger. Not optional — `enforced by` `migrations:check`.
- **Destructive migrations never auto-run.** The deploy-time runner
  ([`migrations.ts:runAll`](../../../services/platform/convex/migrations.ts)) applies only
  non-destructive ups and stops at the first destructive one; the operator applies it deliberately
  via `tale migrate up --step` (a snapshot is taken first).
- **`kind: 'reference'` is NOT runnable.** Historical in-place renames that already shipped in a
  tagged release can't be replayed against today's schema (push-time validation). They carry only
  `meta` (in `ALL_META`, never in `DB_MIGRATIONS`) for the audit trail and stay round-trip-tested.

## Patterns

A migration is a folder `versions/<v0_2_xx>/<NN_slug>/` with three files. Canonical `db` example:
[`v0_2_85/02_dsar_pending_table_split/`](../../../services/platform/convex/migrations/versions/v0_2_85/02_dsar_pending_table_split/).

**`meta.ts`** — the `MigrationMeta` shape (all fields `readonly`):

```ts
import type { MigrationMeta } from '../../../framework/types';

export const meta: MigrationMeta = {
  id: '0.2.85/02_dsar_pending_table_split', // "<semver>/<NN>_<slug>"
  semver: '0.2.85',
  numericId: 2, // per-version sequence, restarts at 1 each folder
  slug: 'dsar_pending_table_split',
  title: 'Move staged DSAR policy changes into dsarPolicyPendingChanges',
  description:
    'Inserts a pending row per legacy row carrying staged changes. Idempotent. down folds it back.',
  kind: 'db', // 'db' (per-row batched) | 'node' (per-org, 'use node') | 'reference' (not runnable)
  reversible: true, // always
  destructive: false, // true ⇒ snapshot must be non-'none'
  snapshot: 'none', // 'none' | 'table-rows' | 'fs-tree'
};
```

**`index.ts`** — a `DbMigration` with idempotent `up`/`down` over one `table`. The runner hands an
untyped `MigrationDoc` (rows pre/post-date the schema); narrow fields with the `type-utils` guards.
To read a table no longer in the schema, cast the name (`ctx.db.query('legacyTable' as never)`):

```ts
export const migration: DbMigration = {
  meta,
  table: 'governancePolicies',
  async up(ctx, doc) {
    const organizationId = str(doc.organizationId);
    if (!organizationId) return;
    if (await pendingRowForOrg(ctx, organizationId)) return; // idempotent guard
    await ctx.db.insert('dsarPolicyPendingChanges', { organizationId /* … */ });
  },
  async down(ctx, doc) {
    const pending = await pendingRowForOrg(ctx, str(doc.organizationId));
    if (!pending) return;
    await ctx.db.delete(pending._id); // fold back, then delete
  },
};
```

**`migration.test.ts`** — `convex-test` against `historicalSchema`, driving the real entrypoints,
asserting up, **a second up is a no-op** (idempotency), down restores, and the ledger flips
`applied` → `rolledBack`:

```ts
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);
await t.action(internal.migrations.framework.entrypoints.applyUp, {
  only: [meta.id],
});
// … assert up; run applyUp again, assert same length (idempotent) …
await t.action(internal.migrations.framework.entrypoints.applyDown, {
  to: '0.2.84',
  only: [meta.id],
});
// … assert down restored, and migrationLedger status === 'rolledBack'
```

`node` migrations (filesystem, per-org) implement `NodeMigration` in a `'use node'` `index.ts` and
use the passed `helpers` (`atomicWrite` / `snapshotFsTree` / `restoreFsTree`) — never import
`node:*` directly. See [`v0_2_85/01_governance_db_to_json/`](../../../services/platform/convex/migrations/versions/v0_2_85/01_governance_db_to_json/).

## CLI & the CI gate

- **Apply/inspect** via the framework entrypoints run through `bunx convex run` (also wrapped by
  `tale migrate up/down`): `status`, `planUp`, `planDown` (queries), `applyUp`, `applyDown`
  (actions) — [`framework/entrypoints.ts`](../../../services/platform/convex/migrations/framework/entrypoints.ts).
- **Before opening a PR, run** `bun run --filter @tale/platform migrations:check`
  ([`scripts/check-migrations.ts`](../../../services/platform/scripts/check-migrations.ts)). It is a
  pure static check (no backend) that fails if any folder is unregistered in `ALL_META`, missing a
  `migration.test.ts`, not `reversible`, destructive+runnable with `snapshot: 'none'`, or a runnable
  `db` migration absent from `DB_MIGRATIONS`.
- **Verify on the live deployment** too — exercise `applyUp`/`applyDown` and read the ledger via the
  Convex MCP before merging. See [`verify`](../verify/SKILL.md) and [`definition-of-done`](../definition-of-done/SKILL.md).
