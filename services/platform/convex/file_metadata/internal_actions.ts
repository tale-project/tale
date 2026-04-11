'use node';

import { v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { getRagConfig } from '../lib/helpers/rag_config';
import { ragAction } from '../workflow_engine/action_defs/rag/rag_action';

const INITIAL_POLLING_DELAY_MS = 5_000;
const MAX_ATTEMPTS = 24;

/**
 * Polling interval for chat file RAG status checks.
 * Faster than document polling since chat files need quick feedback.
 * - Attempts 1-12: every 5 seconds (~1 minute)
 * - Attempts 13-24: every 15 seconds (~3 minutes)
 * Total coverage: ~4 minutes
 */
function getFilePollingInterval(attempt: number): number {
  return attempt <= 12 ? 5_000 : 15_000;
}

/**
 * Upload a file to the RAG service for indexing.
 *
 * Triggered by saveFileMetadata on new inserts. Tracks indexing status
 * on the fileMetadata record and schedules polling for completion.
 */
export const uploadFileToRag = internalAction({
  args: {
    storageId: v.id('_storage'),
    fileName: v.string(),
    contentType: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const ragConfig = getRagConfig();
    if (!ragConfig.serviceUrl) {
      return null;
    }

    try {
      await ragAction.execute(
        ctx,
        {
          operation: 'upload_document',
          fileId: args.storageId,
          fileName: args.fileName,
          contentType: args.contentType,
        },
        {},
      );

      await ctx.scheduler.runAfter(
        INITIAL_POLLING_DELAY_MS,
        internal.file_metadata.internal_actions.checkFileRagStatus,
        { storageId: args.storageId, attempt: 1 },
      );
    } catch (error) {
      console.error(
        `[uploadFileToRag] Failed to upload file ${args.storageId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.updateFileRagStatus,
        {
          storageId: args.storageId,
          ragStatus: 'failed',
          ragError: error instanceof Error ? error.message : String(error),
        },
      );
    }

    return null;
  },
});

/**
 * Poll the RAG service for file indexing status.
 *
 * Modeled on documents/internal_actions.ts:checkRagDocumentStatus but with
 * shorter intervals for fast chat UX feedback.
 */
export const checkFileRagStatus = internalAction({
  args: {
    storageId: v.id('_storage'),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const metadata = await ctx.runQuery(
      internal.file_metadata.internal_queries.getByStorageId,
      { storageId: args.storageId },
    );

    if (!metadata) {
      return null;
    }

    if (metadata.ragStatus === 'completed' || metadata.ragStatus === 'failed') {
      return null;
    }

    if (args.attempt > MAX_ATTEMPTS) {
      console.warn(
        `[checkFileRagStatus] Max attempts (${MAX_ATTEMPTS}) reached for file ${args.storageId}`,
      );
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.updateFileRagStatus,
        {
          storageId: args.storageId,
          ragStatus: 'failed',
          ragError: `Status check timed out after ${MAX_ATTEMPTS} attempts`,
        },
      );
      return null;
    }

    const ragUrl = getRagConfig().serviceUrl;
    if (!ragUrl) {
      return null;
    }

    const url = `${ragUrl}/api/v1/documents/statuses`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ids: [args.storageId] }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 429) {
        console.warn(
          `[checkFileRagStatus] Rate limited (attempt ${args.attempt}/${MAX_ATTEMPTS})`,
        );
        await ctx.scheduler.runAfter(
          getFilePollingInterval(args.attempt),
          internal.file_metadata.internal_actions.checkFileRagStatus,
          { storageId: args.storageId, attempt: args.attempt + 1 },
        );
        return null;
      }

      if (response.status >= 400 && response.status < 500) {
        console.error(
          `[checkFileRagStatus] RAG returned ${response.status} for ${args.storageId}, not retrying`,
        );
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          {
            storageId: args.storageId,
            ragStatus: 'failed',
            ragError: `RAG service returned ${response.status}`,
          },
        );
        return null;
      }

      if (!response.ok) {
        console.warn(
          `[checkFileRagStatus] RAG returned ${response.status} (attempt ${args.attempt}/${MAX_ATTEMPTS})`,
        );
        await ctx.scheduler.runAfter(
          getFilePollingInterval(args.attempt),
          internal.file_metadata.internal_actions.checkFileRagStatus,
          { storageId: args.storageId, attempt: args.attempt + 1 },
        );
        return null;
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error('RAG returned non-JSON response');
      }

      if (!isRecord(body)) {
        throw new Error('Invalid response shape from RAG statuses endpoint');
      }

      const statuses = body.statuses;
      if (!isRecord(statuses)) {
        throw new Error('Invalid statuses field in RAG response');
      }

      const docStatus = statuses[args.storageId];
      const status = isRecord(docStatus)
        ? getString(docStatus, 'status')
        : null;
      const error = isRecord(docStatus)
        ? getString(docStatus, 'error')
        : undefined;

      if (status === 'completed') {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          { storageId: args.storageId, ragStatus: 'completed' },
        );
        return null;
      }

      if (status === 'failed') {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          {
            storageId: args.storageId,
            ragStatus: 'failed',
            ragError: error || 'Unknown error',
          },
        );
        return null;
      }

      if (status === 'processing' && metadata.ragStatus !== 'running') {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          { storageId: args.storageId, ragStatus: 'running' },
        );
      }

      await ctx.scheduler.runAfter(
        getFilePollingInterval(args.attempt),
        internal.file_metadata.internal_actions.checkFileRagStatus,
        { storageId: args.storageId, attempt: args.attempt + 1 },
      );
    } catch (error) {
      console.error(
        `[checkFileRagStatus] Error (attempt ${args.attempt}/${MAX_ATTEMPTS}):`,
        error,
      );
      await ctx.scheduler.runAfter(
        getFilePollingInterval(args.attempt),
        internal.file_metadata.internal_actions.checkFileRagStatus,
        { storageId: args.storageId, attempt: args.attempt + 1 },
      );
    }

    return null;
  },
});
