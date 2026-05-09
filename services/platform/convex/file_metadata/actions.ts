'use node';

import { v } from 'convex/values';

import { isRecord, getBoolean, getString } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { ragFetch } from '../lib/helpers/rag_config';

/**
 * Check RAG indexing status for a list of files and update fileMetadata.
 *
 * Called by the frontend on an interval while files are in queued/running
 * state. Stops being called when the user leaves the page — no wasted
 * server-side scheduled actions.
 *
 * Auth: caller must be authenticated AND the supplied storageIds must
 * belong to fileMetadata rows whose organizationId is one of the caller's
 * org memberships. Without this gate, an anonymous attacker can flip any
 * org's `ragStatus` to `failed` via `expireStaleRagQueue` (DoS), and a
 * member of org A can poke org B's RAG status. (Pre-existing on `main`
 * but in scope for this branch's RAG-auth surface.)
 */
export const checkFileRagStatuses = action({
  args: {
    storageIds: v.array(v.id('_storage')),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (args.storageIds.length === 0) return null;

    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      console.warn('[checkFileRagStatuses] unauthenticated caller — refused');
      return null;
    }
    const callerId = String(authUser._id);

    // Filter storageIds down to ones the caller is authorized to see.
    // Per-row org membership check (stored on fileMetadata).
    const allowedStorageIds = await ctx.runQuery(
      internal.file_metadata.internal_queries.filterStorageIdsByCallerOrg,
      { storageIds: args.storageIds, userId: callerId },
    );
    if (allowedStorageIds.length === 0) {
      console.warn(
        '[checkFileRagStatuses] no authorized storage ids for caller — refused',
      );
      return null;
    }
    args = { ...args, storageIds: allowedStorageIds };

    let body: unknown;
    try {
      const response = await ragFetch('/api/v1/documents/statuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ids: args.storageIds }),
        timeoutMs: 10_000,
      });

      if (!response.ok) {
        console.warn(`[checkFileRagStatuses] RAG returned ${response.status}`);
        return null;
      }

      body = await response.json();
    } catch (error) {
      console.warn('[checkFileRagStatuses] Failed to fetch statuses:', error);
      return null;
    }

    if (!isRecord(body) || !isRecord(body.statuses)) {
      return null;
    }

    const statuses = body.statuses;

    // Give RAG 90s to have ingested a newly-queued upload. If we're still
    // getting null after that window, the upload never reached RAG (likely
    // the scheduled action was dropped before it ran) — mark failed so the
    // client stops polling. Threshold is measured against `ragQueuedAt` on
    // the fileMetadata row, so re-queues reset the clock.
    const STALE_QUEUE_MS = 90_000;

    for (const storageId of args.storageIds) {
      const docStatus = statuses[storageId];
      if (!isRecord(docStatus)) {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.expireStaleRagQueue,
          { storageId, staleAfterMs: STALE_QUEUE_MS },
        );
        continue;
      }

      const status = getString(docStatus, 'status');
      const error = getString(docStatus, 'error');
      const progressPhase = getString(docStatus, 'progress_phase');
      const progressDetail = getString(docStatus, 'progress_detail');

      const ragProgress =
        progressPhase && progressDetail
          ? `${progressPhase} ${progressDetail}`
          : progressPhase || undefined;

      if (status === 'completed') {
        const ocrApplied = getBoolean(docStatus, 'ocr_applied');
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          {
            storageId,
            ragStatus: 'completed',
            ...(ocrApplied != null && { ocrApplied }),
          },
        );
      } else if (status === 'failed') {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          {
            storageId,
            ragStatus: 'failed',
            ragError: error || 'Unknown error',
          },
        );
      } else if (status === 'processing') {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          { storageId, ragStatus: 'running', ragProgress },
        );
      }
    }

    return null;
  },
});
