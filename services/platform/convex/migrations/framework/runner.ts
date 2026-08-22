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

import { components } from '../../_generated/api';
import { internalMutation, type MutationCtx } from '../../_generated/server';
import {
  COMPONENT_MIGRATIONS,
  DB_MIGRATIONS,
  requireMeta,
} from './registry.gen';
import type { MigrationDoc } from './types';

/** Default rows processed per batch transaction. */
const DEFAULT_BATCH_SIZE = 100;

const batchResultValidator = v.object({
  isDone: v.boolean(),
  processed: v.number(),
});

const componentBatchResultValidator = v.object({
  isDone: v.boolean(),
  processed: v.number(),
  renamed: v.number(),
  merged: v.number(),
  skipped: v.number(),
  noop: v.number(),
});

function ledgerRowQuery(ctx: MutationCtx, migrationId: string) {
  return ctx.db
    .query('migrationLedger')
    .withIndex('by_migrationId', (q) => q.eq('migrationId', migrationId))
    .unique();
}

interface SnapshotPage {
  // oxlint-disable-next-line typescript/no-explicit-any -- Convex paginate page of snapshot docs
  page: any[];
  isDone: boolean;
  continueCursor: string;
  /** True when the rows came from a FORMER id (cursor must not be persisted —
   *  it belongs to a different index stream; restores consume their rows, so
   *  each fallback batch restarts from the head of what remains). */
  fromFormerId: boolean;
}

/**
 * One page of a migration's snapshot rows. A re-homed migration's snapshots
 * may sit under one of its FORMER ids (captured before the rename); when the
 * current id has none, the first former id with rows is drained instead.
 *
 * Exported for the paginate-count contract test only (runner.test.ts): the
 * whole lookup must issue AT MOST ONE `.paginate()` — the real backend
 * rejects a second one per mutation and convex-test cannot prove that.
 */
export async function snapshotPageFor(
  ctx: MutationCtx,
  migrationId: string,
  cursor: string | null,
  numItems: number,
): Promise<SnapshotPage> {
  const page = await ctx.db
    .query('migrationSnapshots')
    .withIndex('by_migration', (q) => q.eq('migrationId', migrationId))
    .paginate({ cursor, numItems });
  if (page.page.length > 0 || !page.isDone) {
    return { ...page, fromFormerId: false };
  }
  for (const formerId of requireMeta(migrationId).formerIds ?? []) {
    // take(), never a second paginate: the real backend allows ONE paginated
    // query per mutation (convex-test does not enforce this, so only the
    // container e2e sees the violation). No cursor is lost — fallback rows
    // are consumed by the restore, so each batch reads the head of what
    // remains anyway.
    const fallback = await ctx.db
      .query('migrationSnapshots')
      .withIndex('by_migration', (q) => q.eq('migrationId', formerId))
      .take(numItems);
    if (fallback.length > 0) {
      return {
        page: fallback,
        isDone: fallback.length < numItems,
        continueCursor: '',
        fromFormerId: true,
      };
    }
  }
  return { ...page, fromFormerId: false };
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
    // Down over a table-MOVE migration walks the target table — the legacy
    // `table` is empty once up completed and would restore nothing.
    const sourceTable =
      args.direction === 'down'
        ? (migration.downTable ?? migration.table)
        : migration.table;
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy/undeclared tables are read untyped
    const page = await (ctx.db.query(sourceTable as any) as any).paginate({
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

/** Apply one batch of a `component` migration over Better Auth user rows. */
export const applyComponentBatch = internalMutation({
  args: {
    migrationId: v.string(),
    direction: v.union(v.literal('up'), v.literal('down')),
  },
  returns: componentBatchResultValidator,
  handler: async (ctx, args) => {
    const migration = COMPONENT_MIGRATIONS[args.migrationId];
    if (!migration) {
      throw new Error(`Unknown component migration: ${args.migrationId}`);
    }
    const row = await ledgerRowQuery(ctx, args.migrationId);
    if (!row) {
      throw new Error(
        `No ledger row for running migration ${args.migrationId}`,
      );
    }

    const batchSize = migration.batchSize ?? 50;
    const result =
      args.direction === 'up'
        ? await migration.up(ctx, row.cursor ?? null, batchSize)
        : await migration.down(ctx, row.cursor ?? null);

    if (result.merged > 0 || result.renamed > 0 || result.skipped > 0) {
      console.log(
        `[migrations] ${args.migrationId} batch: renamed=${result.renamed} merged=${result.merged} skipped=${result.skipped} noop=${result.noop}`,
      );
    }

    await ctx.db.patch(row._id, {
      cursor: result.isDone ? null : result.continueCursor,
    });

    return {
      isDone: result.isDone,
      processed: result.processed,
      renamed: result.renamed,
      merged: result.merged,
      skipped: result.skipped,
      noop: result.noop,
    };
  },
});

/** Restore snapshotted Better Auth rows for a component migration `down`. */
export const restoreComponentSnapshotBatch = internalMutation({
  args: { migrationId: v.string() },
  returns: batchResultValidator,
  handler: async (ctx, args) => {
    const row = await ledgerRowQuery(ctx, args.migrationId);
    if (!row) {
      throw new Error(
        `No ledger row for running migration ${args.migrationId}`,
      );
    }

    const page = await snapshotPageFor(
      ctx,
      args.migrationId,
      row.cursor ?? null,
      50,
    );

    for (const snap of page.page) {
      if (!snap.scope.startsWith('component:betterAuth:')) continue;
      const payload = snap.payload as Record<string, unknown> | undefined;
      const model = snap.scope.split(':')[2];
      if (
        payload &&
        (model === 'user' || model === 'member' || model === 'account')
      ) {
        const { _id, _creationTime, ...data } = payload;
        void _id;
        void _creationTime;
        await ctx.runMutation(components.betterAuth.adapter.create, {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- restored legacy payloads
          input: { model, data: data as never },
        });
      }
      await ctx.db.delete(snap._id);
    }

    await ctx.db.patch(row._id, {
      cursor: page.isDone || page.fromFormerId ? null : page.continueCursor,
    });
    return {
      isDone: page.isDone && !page.fromFormerId,
      processed: page.page.length,
    };
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
    const page = await snapshotPageFor(
      ctx,
      args.migrationId,
      row.cursor ?? null,
      batchSize,
    );

    for (const snap of page.page) {
      const payload = snap.payload as Record<string, unknown> | undefined;
      if (payload) {
        // oxlint-disable-next-line typescript/no-explicit-any -- restoring into a possibly-legacy table
        await ctx.db.insert(migration.table as any, payload);
      }
      await ctx.db.delete(snap._id);
    }

    await ctx.db.patch(row._id, {
      cursor: page.isDone || page.fromFormerId ? null : page.continueCursor,
    });
    return {
      isDone: page.isDone && !page.fromFormerId,
      processed: page.page.length,
    };
  },
});
