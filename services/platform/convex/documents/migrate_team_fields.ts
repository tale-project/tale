/**
 * Migration: Populate teamId + sharedWithTeamIds from teamTags.
 *
 * Run this migration after deploying the schema changes.
 * It populates the new unified team fields from existing teamTags data.
 *
 * Safe to run multiple times (idempotent).
 * Call repeatedly with the returned cursor until isDone is true.
 */

import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { teamIdToFields } from './team_fields';

export const migrateTeamFields = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    migrated: v.number(),
    isDone: v.boolean(),
    cursor: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ migrated: number; isDone: boolean; cursor?: string }> => {
    const batchSize = args.batchSize ?? 100;
    let migrated = 0;
    let lastId: string | undefined;

    const query = ctx.db.query('documents').order('asc');

    let count = 0;
    for await (const doc of query) {
      // Skip already-processed documents (cursor-based resume)
      if (args.cursor && String(doc._id) <= args.cursor) {
        continue;
      }

      lastId = doc._id;

      // Migrate documents: set teamId based on teamTags
      // For org-wide docs (no teamTags), set teamId to null explicitly
      if (doc.teamId === undefined) {
        const tags = doc.teamTags ?? [];
        const primaryTeamId = tags.length > 0 ? tags[0] : undefined;
        const teamFields = teamIdToFields(primaryTeamId);

        await ctx.db.patch(doc._id, teamFields);
        migrated++;
      }

      count++;
      if (count >= batchSize) {
        return {
          migrated,
          isDone: false,
          cursor: lastId,
        };
      }
    }

    return {
      migrated,
      isDone: true,
      cursor: undefined,
    };
  },
});
