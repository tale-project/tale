/**
 * Migration: Backfill folderPath on existing documents.
 *
 * For each document with a folderId, compute the folder path from the
 * folders table hierarchy and write it to the new top-level folderPath field.
 *
 * Idempotent: skips documents that already have folderPath set.
 *
 * Usage:
 *   bunx convex run migrations/backfill_folder_path:backfillFolderPath
 */

import { internalMutation } from '../_generated/server';
import { buildFolderPath } from '../folders/queries';

const BATCH_SIZE = 200;

export const backfillFolderPath = internalMutation({
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
        .query('documents')
        .paginate({ cursor, numItems: BATCH_SIZE });

      for (const doc of result.page) {
        if (doc.folderPath) {
          skipped++;
          continue;
        }

        if (!doc.folderId) {
          skipped++;
          continue;
        }

        try {
          const folderPath = await buildFolderPath(ctx, doc.folderId);

          if (folderPath) {
            await ctx.db.patch(doc._id, { folderPath });
            updated++;
          } else {
            skipped++;
          }
        } catch (err) {
          console.error(
            `[backfillFolderPath] Error processing doc ${String(doc._id)} (folderId: ${doc.folderId}):`,
            err,
          );
          skipped++;
          continue;
        }
      }

      console.log(
        `[backfillFolderPath] Batch: updated=${updated}, skipped=${skipped}, done=${result.isDone}`,
      );

      totalUpdated += updated;
      totalSkipped += skipped;
      cursor = result.continueCursor;
      isDone = result.isDone;
    }

    return { updated: totalUpdated, skipped: totalSkipped };
  },
});
