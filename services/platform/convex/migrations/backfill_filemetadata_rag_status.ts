/**
 * Migration: Backfill RAG indexing status onto fileMetadata.
 *
 * RAG status collapsed onto `fileMetadata.ragStatus` as the single source of
 * truth; `documents.ragInfo` is retired. For each document whose legacy
 * `ragInfo.status` predates a fileMetadata status, copy it across so completed/
 * failed history survives the cutover:
 *   documents.ragInfo.{status,error,indexedAt} → fileMetadata.{ragStatus,ragError,ragIndexedAt}
 *
 * Idempotent + non-destructive: only fills holes — never overwrites a
 * fileMetadata.ragStatus that is already set (fileMetadata is canonical).
 *
 * Convex allows only ONE paginated query per function call, so this processes a
 * single batch and self-schedules the next — a single invocation walks the
 * whole `documents` table.
 *
 * Usage:
 *   bunx convex run migrations/backfill_filemetadata_rag_status:backfillFilemetadataRagStatus
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';

const BATCH_SIZE = 200;

export const backfillFilemetadataRagStatus = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('documents')
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE });

    let updated = 0;
    let skipped = 0;

    for (const doc of result.page) {
      const status = doc.ragInfo?.status;
      const fileId = doc.fileId;
      if (!status || !fileId) {
        skipped++;
        continue;
      }

      const fm = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
        .first();
      if (!fm) {
        // No canonical owner (legacy coverage gap; new REST creates are fixed).
        skipped++;
        continue;
      }
      if (fm.ragStatus) {
        // Canonical already set — never overwrite.
        skipped++;
        continue;
      }

      await ctx.db.patch(fm._id, {
        ragStatus: status,
        ...(doc.ragInfo?.error ? { ragError: doc.ragInfo.error } : {}),
        ...(doc.ragInfo?.indexedAt
          ? { ragIndexedAt: doc.ragInfo.indexedAt }
          : {}),
      });
      updated++;
    }

    console.log(
      `[backfillFilemetadataRagStatus] batch: updated=${updated}, skipped=${skipped}, done=${result.isDone}`,
    );

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfill_filemetadata_rag_status
          .backfillFilemetadataRagStatus,
        { cursor: result.continueCursor },
      );
    }

    return { updated, skipped, isDone: result.isDone };
  },
});
