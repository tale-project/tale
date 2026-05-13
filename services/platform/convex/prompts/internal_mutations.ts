import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';

/**
 * Hard-deletes any promptTemplate row that still carries a legacy
 * `lifecycleStatus` value. Used once per org after the soft-delete → hard-
 * delete migration ships; idempotent (subsequent runs are a no-op).
 *
 * After this has been run in every environment, the deprecated
 * `lifecycleStatus` / `statusChangedAt` schema fields can be dropped from
 * `promptTemplates`. Bounded per call by `batchSize` to keep individual
 * mutation runtime predictable.
 *
 * Returns the number of rows deleted, so an admin or follow-up scheduler
 * can iterate until `0` to drain the entire org.
 */
export const purgeLegacyExpiredPrompts = internalMutation({
  args: {
    organizationId: v.string(),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({ deleted: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const limit = args.batchSize ?? 200;
    let deleted = 0;
    for await (const row of ctx.db
      .query('promptTemplates')
      .withIndex('by_organizationId_and_scope', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (row.lifecycleStatus === undefined) continue;
      await ctx.db.delete(row._id);
      deleted += 1;
      if (deleted >= limit) {
        return { deleted, done: false };
      }
    }
    return { deleted, done: true };
  },
});
