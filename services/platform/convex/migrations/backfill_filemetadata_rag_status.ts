/**
 * Migration: Backfill RAG indexing status onto fileMetadata.
 *
 * RAG status collapsed onto `fileMetadata.ragStatus` as the single source of
 * truth; `documents.ragInfo` is retired. For each file-backed document carrying
 * a TERMINAL legacy `ragInfo.status` (`completed`/`failed`), mirror it onto the
 * canonical fileMetadata row so that history survives the cutover:
 *   documents.ragInfo.{status,error,indexedAt} → fileMetadata.{ragStatus,ragError,ragIndexedAt}
 *
 * Two cases:
 *  - fileMetadata row exists → fill the hole (never overwrite a set ragStatus).
 *  - fileMetadata row missing → CREATE it (mirrors `ensureFileMetadataForDocument`'s
 *    shape, reading size/contentType from the `_storage` system table). Without
 *    this, a legacy completed document whose blob never got a fileMetadata row
 *    would project as `not_indexed` and silently drop out of agent RAG retrieval.
 *
 * NON-terminal legacy statuses (`queued`/`running`) are intentionally NOT copied:
 * nothing advances a backfilled non-terminal canonical status server-side (the
 * poller is only scheduled at fresh-upload time, and `expireStaleRagQueue` only
 * rescues `queued`), so copying one would pin the row forever. Leaving it unset
 * projects as `not_indexed` and stays re-driveable via re-index.
 *
 * Idempotent + non-destructive: only fills holes / creates missing rows — never
 * overwrites a fileMetadata.ragStatus that is already set. A re-run finds the
 * row it created (set ragStatus) and skips it; overlapping self-scheduled chains
 * are serialized by Convex OCC. Safe to re-run on every deploy.
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

// 100 (not 200): each batch may now also do up to BATCH_SIZE system.get + insert
// on top of the paginate + by_storageId reads, so keep transaction read/write
// bytes comfortably under the cap. Free — the walk self-schedules.
const BATCH_SIZE = 100;

export const backfillFilemetadataRagStatus = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('documents')
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE });

    let patched = 0;
    let inserted = 0;
    let skipped = 0;

    for (const doc of result.page) {
      const status = doc.ragInfo?.status;
      const fileId = doc.fileId;
      if (!status || !fileId) {
        skipped++;
        continue;
      }
      // Terminal-only: a non-terminal status has no server-side advancer here
      // and would pin the canonical row. Leave it unset (→ not_indexed).
      if (status !== 'completed' && status !== 'failed') {
        skipped++;
        continue;
      }

      const fm = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
        .first();

      const ragExtras = {
        ...(doc.ragInfo?.error ? { ragError: doc.ragInfo.error } : {}),
        ...(doc.ragInfo?.indexedAt
          ? { ragIndexedAt: doc.ragInfo.indexedAt }
          : {}),
      };

      if (!fm) {
        // No canonical row yet (legacy blob predating fileMetadata). Create it so
        // the document keeps its indexed status + stays in agent RAG scope.
        // On a shared blob the first document the walk reaches claims documentId
        // (same first-writer non-determinism as the documentId backfill's
        // `by_organizationId_and_fileId .first()`).
        const sys = await ctx.db.system.get(fileId);
        await ctx.db.insert('fileMetadata', {
          organizationId: doc.organizationId,
          storageId: fileId,
          documentId: doc._id,
          fileName: doc.title ?? 'document',
          contentType:
            doc.mimeType ?? sys?.contentType ?? 'application/octet-stream',
          size: sys?.size ?? 0,
          ragStatus: status,
          ...ragExtras,
        });
        inserted++;
        continue;
      }

      if (fm.ragStatus) {
        // Canonical already set — never overwrite.
        skipped++;
        continue;
      }

      await ctx.db.patch(fm._id, { ragStatus: status, ...ragExtras });
      patched++;
    }

    console.log(
      `[backfillFilemetadataRagStatus] batch: patched=${patched}, inserted=${inserted}, skipped=${skipped}, done=${result.isDone}`,
    );

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfill_filemetadata_rag_status
          .backfillFilemetadataRagStatus,
        { cursor: result.continueCursor },
      );
    }

    return { patched, inserted, skipped, isDone: result.isDone };
  },
});
