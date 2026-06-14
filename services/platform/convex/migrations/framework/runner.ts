/**
 * Batch primitives for `db` migrations. Each is a single mutation = a single
 * transaction, so an interrupted run resumes from the last committed cursor
 * (persisted to the ledger row in the SAME transaction as the data change).
 *
 * The orchestration that loops these batches and dispatches `node` migrations
 * lives in `entrypoints.ts` (an action, the only context that can both
 * `runMutation` and `runAction`).
 */

import { v } from 'convex/values';

import { internalMutation, type MutationCtx } from '../../_generated/server';
import { DB_MIGRATIONS } from './registry';
import type { MigrationDoc } from './types';

/** Default rows processed per batch transaction. */
const DEFAULT_BATCH_SIZE = 100;

const batchResultValidator = v.object({
  isDone: v.boolean(),
  processed: v.number(),
});

function ledgerRowQuery(ctx: MutationCtx, migrationId: string) {
  return ctx.db
    .query('migrationLedger')
    .withIndex('by_migrationId', (q) => q.eq('migrationId', migrationId))
    .unique();
}

/**
 * Apply one batch of a `db` migration's per-row transform over its `table`,
 * forward (`up`) or inverse (`down`). Deleting the current row inside the
 * transform is safe — forward pagination never revisits a yielded row.
 *
 * Only used for `down` when the migration's snapshot strategy is `none`; for
 * `table-rows` migrations the inverse is `restoreSnapshotBatch`.
 */
export const applyDbBatch = internalMutation({
  args: {
    migrationId: v.string(),
    direction: v.union(v.literal('up'), v.literal('down')),
  },
  returns: batchResultValidator,
  handler: async (ctx, args) => {
    const migration = DB_MIGRATIONS[args.migrationId];
    if (!migration) {
      throw new Error(`Unknown db migration: ${args.migrationId}`);
    }
    const row = await ledgerRowQuery(ctx, args.migrationId);
    if (!row) {
      throw new Error(
        `No ledger row for running migration ${args.migrationId}`,
      );
    }

    const batchSize = migration.batchSize ?? DEFAULT_BATCH_SIZE;
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy/undeclared tables are read untyped
    const page = await (ctx.db.query(migration.table as any) as any).paginate({
      cursor: row.cursor ?? null,
      numItems: batchSize,
    });

    for (const doc of page.page as MigrationDoc[]) {
      if (args.direction === 'up') await migration.up(ctx, doc);
      else await migration.down(ctx, doc);
    }

    await ctx.db.patch(row._id, {
      cursor: page.isDone ? null : page.continueCursor,
    });
    return { isDone: page.isDone, processed: page.page.length };
  },
});

/**
 * Restore one batch of a `table-rows` migration's snapshot: re-insert the
 * snapshotted payloads into the migration's `table` and consume the snapshot
 * rows. This is the inverse of a destructive `up` that snapshotted-then-deleted.
 *
 * Restored rows receive FRESH `_id`s (Convex cannot re-use a deleted id). This
 * is safe for config-style tables that aren't referenced by `_id` elsewhere —
 * the only tables this framework drops. Do not use `table-rows` for a table
 * whose `_id` is a foreign key.
 */
export const restoreSnapshotBatch = internalMutation({
  args: { migrationId: v.string() },
  returns: batchResultValidator,
  handler: async (ctx, args) => {
    const migration = DB_MIGRATIONS[args.migrationId];
    if (!migration) {
      throw new Error(`Unknown db migration: ${args.migrationId}`);
    }
    const row = await ledgerRowQuery(ctx, args.migrationId);
    if (!row) {
      throw new Error(
        `No ledger row for running migration ${args.migrationId}`,
      );
    }

    const batchSize = migration.batchSize ?? DEFAULT_BATCH_SIZE;
    const page = await ctx.db
      .query('migrationSnapshots')
      .withIndex('by_migration', (q) => q.eq('migrationId', args.migrationId))
      .paginate({ cursor: row.cursor ?? null, numItems: batchSize });

    for (const snap of page.page) {
      const payload = snap.payload as Record<string, unknown> | undefined;
      if (payload) {
        // oxlint-disable-next-line typescript/no-explicit-any -- restoring into a possibly-legacy table
        await ctx.db.insert(migration.table as any, payload as any);
      }
      await ctx.db.delete(snap._id);
    }

    await ctx.db.patch(row._id, {
      cursor: page.isDone ? null : page.continueCursor,
    });
    return { isDone: page.isDone, processed: page.page.length };
  },
});
