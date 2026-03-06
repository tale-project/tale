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

export const backfillFolders = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;
    let skipped = 0;

    for await (const doc of ctx.db.query('documents')) {
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

      // Strip orgId prefix: "org1/docs/reports/report.pdf" → "docs/reports/report.pdf"
      const pathWithoutOrg = storagePath.startsWith(doc.organizationId + '/')
        ? storagePath.slice(doc.organizationId.length + 1)
        : storagePath;

      const parts = pathWithoutOrg.split('/');
      // Remove filename, keep only directory segments
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

    console.log(`[backfillFolders] Updated: ${updated}, Skipped: ${skipped}`);
  },
});
