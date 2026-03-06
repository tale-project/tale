'use node';

import { v } from 'convex/values';

import { isRecord, getBoolean, getString } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { getRagConfig } from '../lib/helpers/rag_config';
import { checkUserRateLimit } from '../lib/rate_limiter/helpers';
import { ragAction } from '../workflow_engine/action_defs/rag/rag_action';
import { computeStatusUpdates } from './compute_status_updates';

export const retryRagIndexing = action({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      const authUser = await authComponent.getAuthUser(ctx);
      if (!authUser) {
        return { success: false, error: 'Unauthenticated' };
      }

      const document = await ctx.runQuery(
        internal.documents.internal_queries.getDocumentByIdRaw,
        { documentId: args.documentId },
      );

      if (!document) {
        return { success: false, error: 'Document not found' };
      }

      const rawResult = await ragAction.execute(
        ctx,
        { operation: 'upload_document', recordId: args.documentId },
        {},
      );
      const result = isRecord(rawResult) ? rawResult : undefined;
      const success = result ? (getBoolean(result, 'success') ?? false) : false;

      return { success };
    } catch (error) {
      console.error('[retryRagIndexing] Error:', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to retry RAG indexing',
      };
    }
  },
});

const BATCH_SIZE = 200;
const MAX_DOCUMENT_IDS = 500;
const PER_BATCH_TIMEOUT_MS = 10_000;
const TOTAL_TIMEOUT_MS = 30_000;

export const syncRagStatuses = action({
  args: {
    documentIds: v.array(v.id('documents')),
  },
  returns: v.object({
    synced: v.number(),
    failed: v.number(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      const authUser = await authComponent.getAuthUser(ctx);
      if (!authUser) {
        return { synced: 0, failed: 0, error: 'Unauthenticated' };
      }

      await checkUserRateLimit(ctx, 'file:rag-sync', authUser._id);

      const cappedIds = args.documentIds.slice(0, MAX_DOCUMENT_IDS);
      const documents = await ctx.runQuery(
        internal.documents.internal_queries.getDocumentsForRagSync,
        { documentIds: cappedIds },
      );

      if (documents.length === 0) {
        return { synced: 0, failed: 0 };
      }

      const ragUrl = getRagConfig().serviceUrl;
      const now = Date.now();
      const startTime = now;
      let totalUpdates = 0;
      let failedBatches = 0;

      const allStatuses: Record<
        string,
        { status: string; error?: string | null } | null
      > = {};

      for (let i = 0; i < documents.length; i += BATCH_SIZE) {
        if (Date.now() - startTime > TOTAL_TIMEOUT_MS) {
          console.warn(
            '[syncRagStatuses] Total timeout reached, aborting remaining batches',
          );
          failedBatches += Math.ceil((documents.length - i) / BATCH_SIZE);
          break;
        }

        const batch = documents.slice(i, i + BATCH_SIZE);
        const documentIds = batch.map((d) => d._id);

        try {
          const response = await fetch(`${ragUrl}/api/v1/documents/statuses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ document_ids: documentIds }),
            signal: AbortSignal.timeout(PER_BATCH_TIMEOUT_MS),
          });

          if (!response.ok) {
            console.warn(
              `[syncRagStatuses] RAG returned ${response.status}, skipping batch`,
            );
            failedBatches++;
            continue;
          }

          const body: unknown = await response.json();
          if (!isRecord(body) || !isRecord(body.statuses)) {
            console.warn(
              '[syncRagStatuses] Invalid response shape, skipping batch',
            );
            failedBatches++;
            continue;
          }

          for (const [id, info] of Object.entries(body.statuses)) {
            if (info === null) {
              allStatuses[id] = null;
            } else if (isRecord(info)) {
              allStatuses[id] = {
                status: getString(info, 'status') || 'unknown',
                error: getString(info, 'error'),
              };
            }
          }
        } catch (batchError) {
          console.warn('[syncRagStatuses] Batch fetch failed:', batchError);
          failedBatches++;
          continue;
        }
      }

      const updates = computeStatusUpdates(documents, allStatuses, now);

      if (updates.length === 0) {
        return { synced: 0, failed: failedBatches };
      }

      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = updates.slice(i, i + BATCH_SIZE);
        await ctx.runMutation(
          internal.documents.internal_mutations.batchUpdateDocumentsRagInfo,
          { updates: batch },
        );
        totalUpdates += batch.length;
      }

      return { synced: totalUpdates, failed: failedBatches };
    } catch (error) {
      console.error('[syncRagStatuses] Error:', error);
      return {
        synced: 0,
        failed: 0,
        error: error instanceof Error ? error.message : 'Sync failed',
      };
    }
  },
});
