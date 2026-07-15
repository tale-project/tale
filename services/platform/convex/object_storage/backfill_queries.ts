import { ConvexError, v } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import { query } from '../_generated/server';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

/**
 * Status/progress surface for the per-org blob backfill
 * (`backfill_actions.ts:migrateOrgBlobsToObjectStorage`). Gated to the same
 * org-settings capability as the object-storage connection actions, so the
 * admins who can start a run are the ones who can watch it.
 */

const backfillStatusValidator = v.object({
  runId: v.string(),
  status: v.union(
    v.literal('running'),
    v.literal('completed'),
    v.literal('failed'),
  ),
  dryRun: v.boolean(),
  phase: v.union(
    v.literal('documents'),
    v.literal('fileMetadata'),
    v.literal('done'),
  ),
  continuation: v.number(),
  rowsScanned: v.number(),
  migrated: v.number(),
  skipped: v.number(),
  failed: v.number(),
  bytesMigrated: v.number(),
  candidates: v.number(),
  candidateBytes: v.number(),
  sample: v.array(
    v.object({
      ref: v.string(),
      table: v.string(),
      name: v.optional(v.string()),
      size: v.optional(v.number()),
    }),
  ),
  startedAt: v.number(),
  updatedAt: v.number(),
  finishedAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
});

/** The org's most recent backfill run (running or terminal), or null if none. */
export const getObjectStorageBackfillStatus = query({
  args: { organizationId: v.string() },
  returns: v.union(backfillStatusValidator, v.null()),
  handler: async (ctx, args) => {
    const member = await getOrganizationMember(ctx, args.organizationId);
    if (defineAbilityFor(member.role).cannot('write', 'orgSettings')) {
      throw new ConvexError({
        code: 'ORG_FORBIDDEN',
        message: `Role "${member.role}" cannot view the object-storage backfill status.`,
      });
    }
    const run = await ctx.db
      .query('objectStorageBackfillRuns')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')
      .first();
    if (!run) return null;
    return {
      runId: String(run._id),
      status: run.status,
      dryRun: run.dryRun,
      phase: run.phase,
      continuation: run.continuation,
      rowsScanned: run.rowsScanned,
      migrated: run.migrated,
      skipped: run.skipped,
      failed: run.failed,
      bytesMigrated: run.bytesMigrated,
      candidates: run.candidates,
      candidateBytes: run.candidateBytes,
      sample: run.sample,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      finishedAt: run.finishedAt,
      lastError: run.lastError,
    };
  },
});
