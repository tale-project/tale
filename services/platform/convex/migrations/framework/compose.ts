/**
 * Composition layer between authored migration specs (`define.ts`) and the
 * runtime shapes the batch runner executes (`types.ts`). The generated
 * registry (`registry.gen.ts`) calls these to pair each imported module with
 * its folder-derived meta and to inject the id-bound run API.
 *
 * V8-safe: composes `db`/`component` migrations only. Node composition lives
 * in `node_helpers.ts` (`'use node'`) because binding the fs helpers needs
 * the node runtime.
 */

import type { MutationCtx } from '../../_generated/server';
import type {
  ComponentMigrationSpec,
  DbMigrationSpec,
  DbRun,
  MigrationModule,
} from './define';
import { snapshotBetterAuthRow, snapshotRow } from './snapshot_helpers';
import type {
  ComponentMigration,
  DbMigration,
  MigrationDoc,
  MigrationMeta,
} from './types';

/** Bind the snapshot writers to this migration's ledger identity. */
export function makeDbRun(ctx: MutationCtx, migrationId: string): DbRun {
  return {
    id: migrationId,
    snapshotRow: (scope: string, doc: MigrationDoc) =>
      snapshotRow(ctx, migrationId, scope, doc),
    snapshotBetterAuthRow: (model: string, doc: Record<string, unknown>) =>
      snapshotBetterAuthRow(ctx, migrationId, model, doc),
  };
}

/** Pair a `db` spec with its derived meta and inject the bound run API. */
export function composeDb(
  meta: MigrationMeta,
  module: MigrationModule<'db', DbMigrationSpec>,
): DbMigration {
  const { spec } = module;
  return {
    meta,
    table: spec.table,
    downTable: spec.downTable,
    batchSize: spec.batchSize,
    up: (ctx, doc) => spec.up(ctx, doc, makeDbRun(ctx, meta.id)),
    down: (ctx, doc) => spec.down(ctx, doc, makeDbRun(ctx, meta.id)),
  };
}

/** Pair a `component` spec with its derived meta and inject the run API. */
export function composeComponent(
  meta: MigrationMeta,
  module: MigrationModule<'component', ComponentMigrationSpec>,
): ComponentMigration {
  const { spec } = module;
  return {
    meta,
    batchSize: spec.batchSize,
    up: (ctx, cursor, batchSize) =>
      spec.up(ctx, cursor, batchSize, makeDbRun(ctx, meta.id)),
    down: (ctx, cursor) => spec.down(ctx, cursor, makeDbRun(ctx, meta.id)),
  };
}

/**
 * Dual-mode bridge for the port window: legacy folders still export the
 * runtime shape (`meta.ts` + `index.ts`) directly. The generated registry
 * routes them through these identity wrappers so its emitted code is uniform;
 * both are deleted with the legacy shape once every folder is ported.
 */
export function composeLegacyDb(migration: DbMigration): DbMigration {
  return migration;
}

export function composeLegacyComponent(
  migration: ComponentMigration,
): ComponentMigration {
  return migration;
}
