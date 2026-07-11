/**
 * Authoring factories for the versioned data-migration framework.
 *
 * A migration folder ships ONE `migration.ts` that exports
 * `export const migration = define<Kind>Migration({ … })`. Authors write only
 * what cannot be derived: title, description, destructiveness, snapshot
 * strategy, subjects, kind-specific fields, and the `up`/`down` handlers.
 * Everything identity-shaped — `id`, `semver`, `numericId`, `slug`, `kind`,
 * `reversible` — is derived from the folder path by the registry codegen
 * (`bun run migrations:sync`), so the ledger key can never drift from the
 * folder name.
 *
 * The factories validate the spec at module load, so a malformed migration
 * fails vitest, the codegen, and the Convex push — long before it can run.
 *
 * V8-safe: node migrations import `defineNodeMigration` from their
 * `'use node'` modules (importing a V8 module FROM a node module is legal;
 * the reverse is what the V8/node registry split forbids).
 */

import type { MutationCtx } from '../../_generated/server';
import type {
  ComponentBatchResult,
  MigrationDoc,
  MigrationKind,
  MigrationOrg,
  NodeMigrationCtx,
} from './types';

/**
 * What a migration touches — the contract between a migration and the
 * baseline world corpus (`convex/migrations/testing/world/`). The corpus
 * coverage guard fails a runnable migration whose subjects are not seeded at
 * baseline, produced by an earlier migration, or injected mid-chain.
 */
export interface MigrationSubjects {
  /** Convex tables the handlers read or write (current or legacy names). */
  readonly tables?: readonly string[];
  /** Org-config domains (`branding`, `governance`, …) the handlers touch. */
  readonly domains?: readonly string[];
}

/** Fields every migration author writes, whatever the kind. */
export interface MigrationInfo {
  /** Short human title for CLI listings (1..100 chars). */
  readonly title: string;
  /** One-paragraph description of what `up` does (≥ 40 chars; shown in `--step`). */
  readonly description: string;
  /** `true` when `up` removes/overwrites data; gates accept-all + deploy auto-run. */
  readonly destructive: boolean;
  /** Tables/domains the handlers touch. Required for runnable kinds. */
  readonly subjects?: MigrationSubjects;
  /**
   * Ids this migration previously shipped under, when its folder was re-homed
   * to the version whose release actually carried the change. Deployments
   * that applied it under a former id are not re-run: ledger rows are adopted
   * and snapshot restores fall back to the former ids.
   */
  readonly formerIds?: readonly string[];
}

/**
 * Runner-injected API bound to the migration's identity, so handlers never
 * thread `meta.id` by hand (a mistyped id would silently orphan a snapshot).
 */
export interface DbRun {
  /** The migration's derived id (`"<semver>/<NN>_<slug>"`), e.g. for log prefixes. */
  readonly id: string;
  /** Back up one row into `migrationSnapshots` before destroying it. */
  snapshotRow(scope: string, doc: MigrationDoc): Promise<void>;
  /** Back up one Better Auth component row before destroying it. */
  snapshotBetterAuthRow(
    model: string,
    doc: Record<string, unknown>,
  ): Promise<void>;
}

/**
 * Node-migration helpers pre-bound to `(migrationId, orgSlug)` — handlers call
 * `snapshotFsTree(dir)` instead of threading ids. Assembled exclusively by
 * `node_helpers.ts` (the `'use node'` seam), so handler modules never import
 * `node:*` directly.
 */
export interface BoundNodeHelpers {
  /** The migration's derived id, e.g. for log prefixes. */
  readonly migrationId: string;
  /** The org this invocation is processing. */
  readonly orgSlug: string;
  atomicWrite(filePath: string, content: string): Promise<void>;
  readFileSafe(filePath: string): Promise<string | null>;
  /** Delete one file; missing target is a no-op. Returns true when removed. */
  removeFileSafe(filePath: string): Promise<boolean>;
  /** Recursively delete a directory (symlink-refusing); missing target is a
   *  no-op. Returns true when removed. */
  removeDirSafe(dirPath: string): Promise<boolean>;
  /** Copy `dir` into this migration's snapshot sidecar; returns the ref. */
  snapshotFsTree(dir: string): Promise<string>;
  /** Restore the sidecar snapshot captured by `snapshotFsTree` onto `dir`. */
  restoreFsTree(dir: string): Promise<void>;
}

/**
 * A `db` migration spec: a per-row transform over a single `table`. The
 * runner paginates `table` and calls `up`/`down` per row inside one batch
 * transaction. Handlers must be IDEMPOTENT — re-running over an
 * already-migrated row is a no-op — so an interrupted batch can be replayed.
 */
export interface DbMigrationSpec extends MigrationInfo {
  /** `fs-tree` is type-impossible for db migrations. */
  readonly snapshot: 'none' | 'table-rows';
  /**
   * Table the runner paginates. May be a legacy table absent from the current
   * schema — Convex permits reading such tables at runtime.
   */
  readonly table: string;
  /**
   * Table the runner paginates for `down` when `up` MOVED rows into a
   * different table (expand/contract renames) — `table` is empty after `up`,
   * so a down over it would silently restore nothing. Defaults to `table`.
   */
  readonly downTable?: string;
  /** Rows per batch transaction (1..1000). Default 100. */
  readonly batchSize?: number;
  up(ctx: MutationCtx, doc: MigrationDoc, run: DbRun): Promise<void>;
  down(ctx: MutationCtx, doc: MigrationDoc, run: DbRun): Promise<void>;
}

/**
 * A `node` migration spec: filesystem-aware, runs once per organization with
 * pre-bound helpers. Must be idempotent per org so a partially-completed
 * fleet run can resume.
 */
export interface NodeMigrationSpec extends MigrationInfo {
  /** `table-rows` is type-impossible for node migrations. */
  readonly snapshot: 'none' | 'fs-tree';
  up(
    ctx: NodeMigrationCtx,
    org: MigrationOrg,
    helpers: BoundNodeHelpers,
  ): Promise<void>;
  down(
    ctx: NodeMigrationCtx,
    org: MigrationOrg,
    helpers: BoundNodeHelpers,
  ): Promise<void>;
}

/**
 * A `component` migration spec: batched transforms over Better Auth component
 * tables via `components.betterAuth.adapter`. Cursor persistence is the
 * runner's job — handlers receive and return it.
 */
export interface ComponentMigrationSpec extends MigrationInfo {
  /** `fs-tree` is type-impossible for component migrations. */
  readonly snapshot: 'none' | 'table-rows';
  /** Rows per batch (1..1000). Default 50. */
  readonly batchSize?: number;
  up(
    ctx: MutationCtx,
    cursor: string | null,
    batchSize: number,
    run: DbRun,
  ): Promise<ComponentBatchResult & { continueCursor: string | null }>;
  down(
    ctx: MutationCtx,
    cursor: string | null,
    run: DbRun,
  ): Promise<ComponentBatchResult & { continueCursor: string | null }>;
}

/**
 * A `reference` migration spec documents a data-shape change that already
 * shipped in a past release and is NOT replayable against today's schema
 * (Convex validates existing rows at push time). The runner never executes
 * it; the handlers exist so the documented forward/inverse transform stays
 * under round-trip test. No run API — there is no live run to bind to.
 */
export interface ReferenceMigrationSpec extends MigrationInfo {
  /** Documents how the shipped change preserved data; never executed. */
  readonly snapshot: 'none' | 'table-rows' | 'fs-tree';
  /** Table the documented transform operated on. */
  readonly table: string;
  up(ctx: MutationCtx, doc: MigrationDoc): Promise<void>;
  down(ctx: MutationCtx, doc: MigrationDoc): Promise<void>;
}

/** What a migration module exports: the kind tag + the validated spec. */
export interface MigrationModule<K extends MigrationKind, S> {
  readonly kind: K;
  readonly spec: S;
}

export type AnyMigrationModule =
  | MigrationModule<'db', DbMigrationSpec>
  | MigrationModule<'node', NodeMigrationSpec>
  | MigrationModule<'component', ComponentMigrationSpec>
  | MigrationModule<'reference', ReferenceMigrationSpec>;

const TITLE_MAX = 100;
const DESCRIPTION_MIN = 40;
const BATCH_MIN = 1;
const BATCH_MAX = 1000;

function fail(kind: MigrationKind, spec: MigrationInfo, why: string): never {
  const label = spec.title ? `"${spec.title}"` : '(untitled)';
  throw new Error(`define ${kind} migration ${label}: ${why}`);
}

const MIGRATION_ID_RE = /^\d+\.\d+\.\d+\/\d{2}_[a-z0-9_]+$/;

function validateInfo(kind: MigrationKind, spec: MigrationInfo): void {
  if (!spec.title || spec.title.length > TITLE_MAX) {
    fail(kind, spec, `title must be 1..${TITLE_MAX} chars`);
  }
  for (const formerId of spec.formerIds ?? []) {
    if (!MIGRATION_ID_RE.test(formerId)) {
      fail(
        kind,
        spec,
        `formerIds entry "${formerId}" is not a migration id ("<semver>/<NN>_<slug>")`,
      );
    }
  }
  if (!spec.description || spec.description.length < DESCRIPTION_MIN) {
    fail(
      kind,
      spec,
      `description must be at least ${DESCRIPTION_MIN} chars — say what up does and how down reverses it`,
    );
  }
  if (kind !== 'reference') {
    const tables = spec.subjects?.tables?.length ?? 0;
    const domains = spec.subjects?.domains?.length ?? 0;
    if (tables + domains === 0) {
      fail(
        kind,
        spec,
        'runnable migrations must declare subjects (the tables/domains the handlers touch) so the world corpus can cover them',
      );
    }
  }
}

function validateSnapshot(
  kind: MigrationKind,
  spec: MigrationInfo & { snapshot: string },
): void {
  if (kind !== 'reference' && spec.destructive && spec.snapshot === 'none') {
    fail(
      kind,
      spec,
      "destructive migrations must declare a snapshot strategy ('table-rows' or 'fs-tree') so down can rebuild the data",
    );
  }
}

function validateBatchSize(
  kind: MigrationKind,
  spec: MigrationInfo & { batchSize?: number },
): void {
  if (spec.batchSize === undefined) return;
  if (
    !Number.isInteger(spec.batchSize) ||
    spec.batchSize < BATCH_MIN ||
    spec.batchSize > BATCH_MAX
  ) {
    fail(
      kind,
      spec,
      `batchSize must be an integer in ${BATCH_MIN}..${BATCH_MAX}`,
    );
  }
}

export function defineDbMigration(
  spec: DbMigrationSpec,
): MigrationModule<'db', DbMigrationSpec> {
  validateInfo('db', spec);
  validateSnapshot('db', spec);
  validateBatchSize('db', spec);
  if (!spec.table) fail('db', spec, 'table is required');
  return { kind: 'db', spec };
}

export function defineNodeMigration(
  spec: NodeMigrationSpec,
): MigrationModule<'node', NodeMigrationSpec> {
  validateInfo('node', spec);
  validateSnapshot('node', spec);
  return { kind: 'node', spec };
}

export function defineComponentMigration(
  spec: ComponentMigrationSpec,
): MigrationModule<'component', ComponentMigrationSpec> {
  validateInfo('component', spec);
  validateSnapshot('component', spec);
  validateBatchSize('component', spec);
  return { kind: 'component', spec };
}

export function defineReferenceMigration(
  spec: ReferenceMigrationSpec,
): MigrationModule<'reference', ReferenceMigrationSpec> {
  validateInfo('reference', spec);
  if (!spec.table) fail('reference', spec, 'table is required');
  return { kind: 'reference', spec };
}
