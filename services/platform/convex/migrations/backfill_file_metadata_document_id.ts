/**
 * Migration: Backfill documentId on fileMetadata records.
 *
 * For each fileMetadata without documentId:
 * 1. Find a matching document with the same organizationId and fileId
 * 2. If found, set documentId on the fileMetadata record
 *
 * Idempotent: skips records that already have documentId set.
 *
 * Convex allows only ONE paginated query per function call, so this processes a
 * single batch and self-schedules the next — a single `convex run` walks the
 * whole table.
 *
 * Usage:
 *   bunx convex run migrations/backfill_file_metadata_document_id:backfillFileMetadataDocumentId
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';

const BATCH_SIZE = 200;

export const backfillFileMetadataDocumentId = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('fileMetadata')
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE });

    let updated = 0;
    let skipped = 0;

    for (const fm of result.page) {
      if (fm.documentId) {
        skipped++;
        continue;
      }

      const doc = await ctx.db
        .query('documents')
        .withIndex('by_organizationId_and_fileId', (q) =>
          q.eq('organizationId', fm.organizationId).eq('fileId', fm.storageId),
        )
        .first();

      if (!doc) {
        skipped++;
        continue;
      }

      await ctx.db.patch(fm._id, { documentId: doc._id });
      updated++;
    }

    console.log(
      `[backfillFileMetadataDocumentId] batch: updated=${updated}, skipped=${skipped}, done=${result.isDone}`,
    );

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfill_file_metadata_document_id
          .backfillFileMetadataDocumentId,
        { cursor: result.continueCursor },
      );
    }

    return { updated, skipped, isDone: result.isDone };
  },
});
