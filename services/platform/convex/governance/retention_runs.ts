/**
 * Phase 7 — retention-run state management.
 *
 * Three primitives the dispatcher / per-org worker call:
 *   - `claimRetentionRun(orgId)` → create an in-flight row, returns
 *     the new row's id; refuses if a younger-than-23h, uncompleted
 *     row already exists (prevents duplicate-fire when previous day's
 *     run is still draining a backlog).
 *   - `recordRetentionRunCheckpoint(runId, cursor, processed?)` → patch
 *     `lastCursor` + accumulate `processedCount` mid-run so a continuation
 *     can resume from the cursor.
 *   - `completeRetentionRun(runId, error?)` → patch `completedAt`.
 *
 * Plus a query helper used by the editor UI:
 *   - `getRetentionRunStatus(orgId)` → most recent run for the operator
 *     "longest-running cleanup" panel.
 */

import { ConvexError, v } from 'convex/values';

import { internalMutation, internalQuery, query } from '../_generated/server';
import { authComponent } from '../auth';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

const STALE_RUN_AGE_MS = 23 * 60 * 60 * 1000; // 23h absolute ceiling
// A live worker checkpoints between every category and on continuation
// scheduling; a 30-min heartbeat gap means the worker crashed (or the host
// ran out of compute) and we shouldn't keep blocking the next dispatch
// for the remainder of the 23h absolute window.
const STALE_HEARTBEAT_MS = 30 * 60 * 1000;

const cursorValidator = v.object({
  category: v.string(),
  step: v.optional(v.string()),
  lastCreationTime: v.optional(v.number()),
});

export const claimRetentionRun = internalMutation({
  args: { organizationId: v.string() },
  returns: v.union(v.id('retentionRuns'), v.null()),
  handler: async (ctx, args) => {
    const now = Date.now();
    // Look for a recent in-flight run.
    const recent = await ctx.db
      .query('retentionRuns')
      .withIndex('by_organizationId_startedAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')
      .first();

    if (recent && recent.completedAt === undefined) {
      const age = now - recent.startedAt;
      // Backwards-compat: rows persisted before lastHeartbeatAt landed
      // fall back to startedAt — they keep the 23h absolute behavior.
      const heartbeatAge =
        recent.lastHeartbeatAt !== undefined
          ? now - recent.lastHeartbeatAt
          : age;
      if (age < STALE_RUN_AGE_MS && heartbeatAge < STALE_HEARTBEAT_MS) {
        // In-flight + still heartbeating — skip this dispatch.
        return null;
      }
      // Either the absolute 23h deadline passed, or the worker stopped
      // checkpointing for >30 min (process crash / host OOM); mark the
      // row failed so the runs panel shows the gap, then claim a new
      // run.
      await ctx.db.patch(recent._id, {
        completedAt: now,
        lastError:
          recent.lastError ??
          (age >= STALE_RUN_AGE_MS
            ? `Run abandoned (no completion within ${STALE_RUN_AGE_MS / 1000 / 60 / 60}h).`
            : `Run abandoned (no heartbeat within ${STALE_HEARTBEAT_MS / 1000 / 60} min).`),
      });
    }

    return await ctx.db.insert('retentionRuns', {
      organizationId: args.organizationId,
      startedAt: now,
      lastHeartbeatAt: now,
      processedCount: 0,
    });
  },
});

export const recordRetentionRunCheckpoint = internalMutation({
  args: {
    runId: v.id('retentionRuns'),
    cursor: v.optional(cursorValidator),
    processedDelta: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.runId);
    if (!row) return null;
    // Always touch the heartbeat — every checkpoint is a liveness signal
    // even when no cursor or processed delta is supplied.
    const patch: {
      lastCursor?: typeof row.lastCursor;
      processedCount?: number;
      lastHeartbeatAt: number;
    } = { lastHeartbeatAt: Date.now() };
    if (args.cursor !== undefined) {
      patch.lastCursor = args.cursor;
    }
    if (args.processedDelta !== undefined) {
      patch.processedCount = (row.processedCount ?? 0) + args.processedDelta;
    }
    await ctx.db.patch(args.runId, patch);
    return null;
  },
});

export const completeRetentionRun = internalMutation({
  args: {
    runId: v.id('retentionRuns'),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      completedAt: Date.now(),
      lastError: args.error,
    });
    return null;
  },
});

export const getOpenRunForOrg = internalQuery({
  args: { organizationId: v.string() },
  returns: v.union(
    v.object({
      _id: v.id('retentionRuns'),
      startedAt: v.number(),
      lastCursor: v.optional(cursorValidator),
      processedCount: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const recent = await ctx.db
      .query('retentionRuns')
      .withIndex('by_organizationId_startedAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')
      .first();
    if (!recent || recent.completedAt !== undefined) return null;
    return {
      _id: recent._id,
      startedAt: recent.startedAt,
      lastCursor: recent.lastCursor,
      processedCount: recent.processedCount,
    };
  },
});

/**
 * Public — admin operator panel "longest-running cleanup" view.
 * Returns the most recent run for the org (in-flight or completed).
 */
export const getRetentionRunStatus = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    const callerId = String(authUser._id);
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: callerId,
      email: authUser.email ?? '',
    });
    if (!isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Admin role required to view retention run status.',
      });
    }

    const recent = await ctx.db
      .query('retentionRuns')
      .withIndex('by_organizationId_startedAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')
      .take(5);
    return recent.map((r) => ({
      runId: r._id,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      lastCursor: r.lastCursor,
      lastError: r.lastError,
      processedCount: r.processedCount ?? 0,
      durationMs:
        r.completedAt !== undefined ? r.completedAt - r.startedAt : null,
    }));
  },
});
