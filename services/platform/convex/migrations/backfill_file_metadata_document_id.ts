/**
 * Migration: Backfill documentId on fileMetadata records.
 *
 * For each fileMetadata without documentId:
 * 1. Find a matching document with the same organizationId and fileId
 * 2. If found, set documentId on the fileMetadata record
 *
 * Idempotent: skips records that already have documentId set.
 *
 * Usage:
 *   bunx convex run migrations/backfill_file_metadata_document_id:backfillFileMetadataDocumentId
 */

import { internalMutation } from '../_generated/server';

const BATCH_SIZE = 200;

export const backfillFileMetadataDocumentId = internalMutation({
  args: {},
  handler: async (ctx) => {
    let totalUpdated = 0;
    let totalSkipped = 0;
    let cursor: string | null = null;
    let isDone = false;

    while (!isDone) {
      let updated = 0;
      let skipped = 0;

      const result = await ctx.db
        .query('fileMetadata')
        .paginate({ cursor, numItems: BATCH_SIZE });

      for (const fm of result.page) {
        if (fm.documentId) {
          skipped++;
          continue;
        }

        try {
          const doc = await ctx.db
            .query('documents')
            .withIndex('by_organizationId_and_fileId', (q) =>
              q
                .eq('organizationId', fm.organizationId)
                .eq('fileId', fm.storageId),
            )
            .first();

          if (!doc) {
            skipped++;
            continue;
          }

          await ctx.db.patch(fm._id, { documentId: doc._id });
          updated++;
        } catch (error) {
          console.error(
            `[backfillFileMetadataDocumentId] Error for ${String(fm._id)}:`,
            error,
          );
          skipped++;
        }
      }

      console.log(
        `[backfillFileMetadataDocumentId] Batch: updated=${updated}, skipped=${skipped}, done=${result.isDone}`,
      );

      totalUpdated += updated;
      totalSkipped += skipped;
      cursor = result.continueCursor;
      isDone = result.isDone;
    }

    return { updated: totalUpdated, skipped: totalSkipped };
  },
});
