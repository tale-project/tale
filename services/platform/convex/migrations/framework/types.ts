/**
 * V8-safe contracts for the versioned data-migration framework.
 *
 * A migration is one reversible, version-pinned data transformation. It comes
 * in two flavours:
 *
 *  - `db`   — batched row rewrites over a Convex table, run as mutations. The
 *             runner paginates the table and calls `up`/`down` per row inside a
 *             transaction (so a crash resumes from the last committed cursor).
 *  - `node` — needs the filesystem (`'use node'`), e.g. exporting governance DB
 *             rows to per-org JSON files. The runner iterates organizations and
 *             calls `up`/`down` once per org for uniform resumability.
 *
 * This module declares ONLY types + the meta shape. Concrete `db` handlers live
 * in V8 modules; concrete `node` handlers live in `'use node'` modules. The two
 * are kept apart so V8 code (the runner, the meta registry) never value-imports
 * a node module — the same Layer-A/Layer-B split used by the config registry.
 */

import type { MutationCtx } from '../../_generated/server';

/**
 * `db`/`node` migrations are RUNNABLE by the runner. `reference` migrations
 * document a data-shape change that already shipped in a past release and is
 * NOT replayable against today's schema (Convex validates existing rows against
 * the new schema at push time, so an in-place field rename/removal cannot be
 * deferred to a post-deploy migration). The runner never executes a `reference`
 * migration; it exists for the audit trail and to keep its forward/inverse
 * transform under round-trip test so the documented history is provably
 * correct. See `isRunnableKind`.
 */
export type MigrationKind = 'db' | 'node' | 'reference';

/** True for kinds the runner is allowed to execute. */
export function isRunnableKind(kind: MigrationKind): boolean {
  return kind === 'db' || kind === 'node';
}

/**
 * How a migration preserves data so its `down` can rebuild it:
 *  - `none`       — fully reversible from the data already present (renames,
 *                   reversible field splits). No backup needed.
 *  - `table-rows` — snapshot the affected rows before an `up` that loses
 *                   information; `down` restores from the snapshot.
 *  - `fs-tree`    — snapshot a per-org config subtree on disk before touching
 *                   it; `down` restores the files.
 */
export type SnapshotStrategy = 'none' | 'table-rows' | 'fs-tree';

export interface MigrationMeta {
  /** Stable global id `"<semver>/<NN>_<slug>"`, e.g. `"0.2.85/01_governance_db_to_json"`. */
  readonly id: string;
  /** Canonical `major.minor.patch` the migration shipped in. */
  readonly semver: string;
  /** Per-semver sequence number, restarts at 1 in each version folder. */
  readonly numericId: number;
  /** snake/kebab slug, matches the folder name after the numeric prefix. */
  readonly slug: string;
  /** Short human title for CLI listings. */
  readonly title: string;
  /** One-paragraph description of what the `up` does (shown in `--step`). */
  readonly description: string;
  readonly kind: MigrationKind;
  /** Must be `true` — every migration in this framework is reversible. */
  readonly reversible: boolean;
  /** `true` when `up` removes/overwrites data; gates accept-all + deploy auto-run. */
  readonly destructive: boolean;
  readonly snapshot: SnapshotStrategy;
}

/** Direction a migration is being applied. */
export type MigrationDirection = 'up' | 'down';

/**
 * A `db` migration: a per-row transform over a single `table`. The runner
 * paginates `table` and calls `up`/`down` for each document inside a single
 * mutation transaction. Handlers must be IDEMPOTENT — re-running over an
 * already-migrated row is a no-op — so an interrupted batch can be safely
 * replayed.
 *
 * `up`/`down` receive a full `MutationCtx`, so a transform may read/insert/
 * patch/delete in OTHER tables too (e.g. copy a row into a new table). To read
 * or iterate a table that is no longer in the production schema (a legacy table
 * being migrated away), cast the name: `ctx.db.query('legacyTable' as never)`.
 */
export interface DbMigration {
  readonly meta: MigrationMeta;
  /**
   * Table the runner paginates. May be a legacy table absent from the current
   * schema — Convex permits reading such tables at runtime.
   */
  readonly table: string;
  /** Rows per batch transaction. Default 100. */
  readonly batchSize?: number;
  /** Forward per-row transform. Mutate via `ctx.db`; idempotent. */
  up(ctx: MutationCtx, doc: MigrationDoc): Promise<void>;
  /** Inverse per-row transform. Mutate via `ctx.db`; idempotent. */
  down(ctx: MutationCtx, doc: MigrationDoc): Promise<void>;
}

/**
 * An untyped document handed to a `db` migration. Migrations operate on rows
 * whose shape predates (up) or postdates (down) the current schema, so the
 * static `Doc<Table>` type cannot describe them. Handlers narrow with the
 * shared `type-guards` helpers (`isRecord`, `getString`, …).
 */
export type MigrationDoc = Record<string, unknown> & {
  _id: import('convex/values').GenericId<string>;
};

/** The org a `node` migration is currently processing. */
export interface MigrationOrg {
  readonly id: string;
  readonly slug: string;
}

/**
 * A `node` migration: filesystem-aware, runs once per organization. The handler
 * reads DB rows via `ctx.runQuery` and writes files via the `helpers`, and the
 * inverse for `down`. Must be idempotent per org so a partially-completed fleet
 * run can resume.
 */
export interface NodeMigration {
  readonly meta: MigrationMeta;
  up(
    ctx: NodeMigrationCtx,
    org: MigrationOrg,
    helpers: NodeMigrationHelpers,
  ): Promise<void>;
  down(
    ctx: NodeMigrationCtx,
    org: MigrationOrg,
    helpers: NodeMigrationHelpers,
  ): Promise<void>;
}

/**
 * The slice of `ActionCtx` a node migration needs. Kept structural so the
 * handler modules don't have to import the generated `ActionCtx` (which would
 * drag generated types into a `'use node'` module).
 */
export interface NodeMigrationCtx {
  // oxlint-disable-next-line typescript/no-explicit-any -- structural cross-ctx typing
  runQuery: (...args: any[]) => Promise<any>;
  // oxlint-disable-next-line typescript/no-explicit-any -- structural cross-ctx typing
  runMutation: (...args: any[]) => Promise<any>;
  // oxlint-disable-next-line typescript/no-explicit-any -- structural cross-ctx typing
  runAction: (...args: any[]) => Promise<any>;
}

/**
 * Filesystem helpers passed to node migrations so handlers never re-import
 * `node:*` directly. Thin wrappers over `convex/lib/file_io` + the snapshot
 * store. `snapshotFsTree`/`restoreFsTree` are only meaningful when the
 * migration's `snapshot` is `'fs-tree'`.
 */
export interface NodeMigrationHelpers {
  atomicWrite(filePath: string, content: string): Promise<void>;
  readFileSafe(filePath: string): Promise<string | null>;
  /** Copy `dir` into the migration's snapshot sidecar; returns the snapshot ref. */
  snapshotFsTree(
    migrationId: string,
    orgSlug: string,
    dir: string,
  ): Promise<string>;
  /**
   * Restore the snapshot captured by `snapshotFsTree(migrationId, orgSlug, …)`
   * back onto `dir`. The ref is recomputed from the same inputs, so `down`
   * never has to persist/thread it.
   */
  restoreFsTree(
    migrationId: string,
    orgSlug: string,
    dir: string,
  ): Promise<void>;
}
