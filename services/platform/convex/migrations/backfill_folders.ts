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

import { v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { internalMutation } from '../_generated/server';
import { getOrCreateFolderPath } from '../folders/get_or_create_path';

const BATCH_SIZE = 200;

export const backfillFolders = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let updated = 0;
    let skipped = 0;

    const result = await ctx.db
      .query('documents')
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE });

    for (const doc of result.page) {
      if (doc.folderId) {
        skipped++;
        continue;
      }

      const metadata = isRecord(doc.metadata) ? doc.metadata : undefined;
      const storagePath = metadata
        ? getString(metadata, 'storagePath')
        : undefined;

      if (!storagePath) {
        skipped++;
        continue;
      }

      const pathWithoutOrg = storagePath.startsWith(doc.organizationId + '/')
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
      );

      if (folderId) {
        await ctx.db.patch(doc._id, { folderId });
        updated++;
      } else {
        skipped++;
      }
    }

    console.log(
      `[backfillFolders] Batch: updated=${updated}, skipped=${skipped}, done=${result.isDone}`,
    );

    return {
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      updated,
      skipped,
    };
  },
});
