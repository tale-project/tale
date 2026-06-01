/**
 * Migration: backfill fileMetadata.source from the linked document's provenance.
 *
 * Historically the integration sandbox stamped connector-stored blobs
 * (Confluence, Google Drive, any rest_api file op) as source 'agent', OneDrive/
 * SharePoint imports as 'user', and WebDAV imports as undefined. We now record
 * the specific provenance (the connector slug) via linkDocumentToFile; this
 * repairs pre-existing rows so they match.
 *
 * For each fileMetadata with a linked document (by org + fileId == storageId),
 * derive the source from the document's sourceProvider exactly as
 * linkDocumentToFile does:
 *   'upload'  -> 'user'
 *   'agent' / undefined -> leave unchanged
 *   else -> the connector slug verbatim ('confluence', 'onedrive', 'webdav', …)
 * Only rows whose derived source DIFFERS from the current value are patched.
 *
 * (The companion documentId back-fill already removed synced rows from the
 * retention GC selector, so this is provenance hardening, not a data-loss fix.)
 *
 * Idempotent. ONE paginated query per invocation (Convex forbids multiple);
 * self-schedules the next batch.
 *
 * Usage:
 *   bunx convex run migrations/relabel_synced_file_metadata_source:relabelSyncedFileMetadataSource
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { sourceFromProvider } from '../file_metadata/source_from_provider';

const BATCH_SIZE = 200;

export const relabelSyncedFileMetadataSource = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('fileMetadata')
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE });

    let updated = 0;
    let skipped = 0;

    for (const fm of result.page) {
      const doc = await ctx.db
        .query('documents')
        .withIndex('by_organizationId_and_fileId', (q) =>
          q.eq('organizationId', fm.organizationId).eq('fileId', fm.storageId),
        )
        .first();

      const desired = sourceFromProvider(doc?.sourceProvider);
      if (!desired || desired === fm.source) {
        skipped++;
        continue;
      }

      await ctx.db.patch(fm._id, { source: desired });
      updated++;
    }

    console.log(
      `[relabelSyncedFileMetadataSource] batch: updated=${updated}, skipped=${skipped}, done=${result.isDone}`,
    );

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.relabel_synced_file_metadata_source
          .relabelSyncedFileMetadataSource,
        { cursor: result.continueCursor },
      );
    }

    return { updated, skipped, isDone: result.isDone };
  },
});
