'use node';

import { v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { getRagConfig } from '../lib/helpers/rag_config';

/**
 * Check RAG indexing status for a list of files and update fileMetadata.
 *
 * Called by the frontend on an interval while files are in queued/running
 * state. Stops being called when the user leaves the page — no wasted
 * server-side scheduled actions.
 */
export const checkFileRagStatuses = action({
  args: {
    storageIds: v.array(v.id('_storage')),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (args.storageIds.length === 0) return null;

    const ragUrl = getRagConfig().serviceUrl;
    if (!ragUrl) return null;

    const url = `${ragUrl}/api/v1/documents/statuses`;

    let body: unknown;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ids: args.storageIds }),
        signal: AbortSignal.timeout(10_000),
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

    for (const storageId of args.storageIds) {
      const docStatus = statuses[storageId];
      if (!isRecord(docStatus)) continue;

      const status = getString(docStatus, 'status');
      const error = getString(docStatus, 'error');
      const progressPhase = getString(docStatus, 'progress_phase');
      const progressDetail = getString(docStatus, 'progress_detail');

      const ragProgress =
        progressPhase && progressDetail
          ? `${progressPhase} ${progressDetail}`
          : progressPhase || undefined;

      if (status === 'completed') {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          { storageId, ragStatus: 'completed' },
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
