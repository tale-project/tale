/**
 * Internal ledger accessors for the migration runner. All reads/writes of
 * `migrationLedger` go through here so the runner never open-codes the
 * upsert/resume/complete state machine.
 *
 * State machine per migration (one row, keyed by `migrationId`):
 *   (absent) --beginRun(up)--> running --completeRun--> applied
 *   applied  --beginRun(down)--> running --completeRun--> rolledBack
 *   running  --failRun--> failed --beginRun--> running   (resume)
 */

import { v } from 'convex/values';

import type { Doc } from '../../_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from '../../_generated/server';

/** Resume state handed back to the runner when (re)starting a migration. */
const resumeStateValidator = v.object({
  cursor: v.union(v.string(), v.null()),
  orgCursor: v.union(v.string(), v.null()),
  processedOrgs: v.array(v.string()),
  snapshotRef: v.union(v.string(), v.null()),
});

/** All ledger rows. Bounded by the migration count (dozens) — safe to collect. */
export const getLedgerState = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<'migrationLedger'>[]> => {
    return await ctx.db.query('migrationLedger').collect();
  },
});

/**
 * Upsert a `running` row for a migration about to run. If a row for this
 * migration already exists in the SAME direction (an interrupted run), its
 * cursor/processedOrgs are preserved so the runner resumes; otherwise the
 * resume fields are reset.
 */
export const beginRun = internalMutation({
  args: {
    migrationId: v.string(),
    semver: v.string(),
    numericId: v.number(),
    orderKey: v.string(),
    direction: v.union(v.literal('up'), v.literal('down')),
  },
  returns: resumeStateValidator,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('migrationLedger')
      .withIndex('by_migrationId', (q) => q.eq('migrationId', args.migrationId))
      .unique();

    const resuming = existing !== null && existing.direction === args.direction;

    if (existing) {
      await ctx.db.patch(existing._id, {
        semver: args.semver,
        numericId: args.numericId,
        orderKey: args.orderKey,
        direction: args.direction,
        status: 'running',
        error: undefined,
        ...(resuming
          ? {}
          : {
              cursor: null,
              orgCursor: null,
              processedOrgs: [],
              snapshotRef: undefined,
            }),
      });
      return {
        cursor: resuming ? (existing.cursor ?? null) : null,
        orgCursor: resuming ? (existing.orgCursor ?? null) : null,
        processedOrgs: resuming ? (existing.processedOrgs ?? []) : [],
        snapshotRef: resuming ? (existing.snapshotRef ?? null) : null,
      };
    }

    await ctx.db.insert('migrationLedger', {
      migrationId: args.migrationId,
      semver: args.semver,
      numericId: args.numericId,
      orderKey: args.orderKey,
      direction: args.direction,
      status: 'running',
      cursor: null,
      orgCursor: null,
      processedOrgs: [],
    });
    return {
      cursor: null,
      orgCursor: null,
      processedOrgs: [],
      snapshotRef: null,
    };
  },
});

/** Advance the db-pagination cursor for a running migration (per committed batch). */
export const setCursor = internalMutation({
  args: { migrationId: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await rowFor(ctx, args.migrationId);
    if (row) await ctx.db.patch(row._id, { cursor: args.cursor });
    return null;
  },
});

/** Record that an org finished (node migrations) and advance the org cursor. */
export const recordOrgProgress = internalMutation({
  args: {
    migrationId: v.string(),
    orgId: v.string(),
    orgCursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await rowFor(ctx, args.migrationId);
    if (!row) return null;
    const processed = new Set(row.processedOrgs ?? []);
    processed.add(args.orgId);
    await ctx.db.patch(row._id, {
      processedOrgs: [...processed],
      orgCursor: args.orgCursor,
    });
    return null;
  },
});

/** Stamp the snapshot reference once a pre-`up` backup has been captured. */
export const setSnapshotRef = internalMutation({
  args: { migrationId: v.string(), snapshotRef: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await rowFor(ctx, args.migrationId);
    if (row) await ctx.db.patch(row._id, { snapshotRef: args.snapshotRef });
    return null;
  },
});

/** Mark a migration terminal: applied (up) or rolledBack (down). */
export const completeRun = internalMutation({
  args: {
    migrationId: v.string(),
    direction: v.union(v.literal('up'), v.literal('down')),
    durationMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await rowFor(ctx, args.migrationId);
    if (!row) return null;
    await ctx.db.patch(row._id, {
      status: args.direction === 'up' ? 'applied' : 'rolledBack',
      appliedAt: args.direction === 'up' ? Date.now() : undefined,
      durationMs: args.durationMs,
      error: undefined,
    });
    return null;
  },
});

/** Mark a migration `failed` with the error message for operator triage. */
export const failRun = internalMutation({
  args: { migrationId: v.string(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await rowFor(ctx, args.migrationId);
    if (row)
      await ctx.db.patch(row._id, { status: 'failed', error: args.error });
    return null;
  },
});

async function rowFor(
  ctx: MutationCtx,
  migrationId: string,
): Promise<Doc<'migrationLedger'> | null> {
  return await ctx.db
    .query('migrationLedger')
    .withIndex('by_migrationId', (q) => q.eq('migrationId', migrationId))
    .unique();
}
