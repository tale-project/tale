/**
 * Migration: Backfill folders table from existing document metadata.storagePath.
 *
 * For each document with metadata.storagePath:
 * 1. Parse path segments (strip orgId prefix and filename)
 * 2. Create folder hierarchy via getOrCreateFolderPath
 * 3. Set folderId on the document
 *
 * Idempotent: skips documents that already have folderId set.
 *
 * Usage:
 *   bunx convex run migrations/backfill_folders:backfillFolders
 */

import { isRecord, getString } from '../../lib/utils/type-guards';
import { internalMutation } from '../_generated/server';
import { getOrCreateFolderPath } from '../folders/get_or_create_path';

const BATCH_SIZE = 200;

export const backfillFolders = internalMutation({
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
        if (doc.folderId) {
          skipped++;
          continue;
        }

        try {
          const metadata = isRecord(doc.metadata) ? doc.metadata : undefined;
          const storagePath = metadata
            ? getString(metadata, 'storagePath')
            : undefined;

          if (!storagePath) {
            skipped++;
            continue;
          }

          const pathWithoutOrg = storagePath.startsWith(
            doc.organizationId + '/',
          )
            ? storagePath.slice(doc.organizationId.length + 1)
            : storagePath;

          const parts = pathWithoutOrg.split('/');
          parts.pop();

          if (parts.length === 0) {
            skipped++;
            continue;
          }

          const folderId = await getOrCreateFolderPath(
            ctx,
            doc.organizationId,
            parts,
            doc.createdBy,
            doc.teamId,
          );

          if (folderId) {
            await ctx.db.patch(doc._id, { folderId });
            updated++;
          } else {
            skipped++;
          }
        } catch (err) {
          const metadata = isRecord(doc.metadata) ? doc.metadata : undefined;
          const storagePath = metadata
            ? getString(metadata, 'storagePath')
            : 'unknown';
          console.error(
            `[backfillFolders] Error processing doc ${String(doc._id)} (path: ${storagePath}):`,
            err,
          );
          skipped++;
          continue;
        }
      }

      console.log(
        `[backfillFolders] Batch: updated=${updated}, skipped=${skipped}, done=${result.isDone}`,
      );

      totalUpdated += updated;
      totalSkipped += skipped;
      cursor = result.continueCursor;
      isDone = result.isDone;
    }

    return { updated: totalUpdated, skipped: totalSkipped };
  },
});
