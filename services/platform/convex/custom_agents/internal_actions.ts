'use node';

import { v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { getPollingInterval } from '../documents/internal_actions';
import { getRagConfig } from '../lib/helpers/rag_config';
import { deleteDocumentById } from '../workflow_engine/action_defs/rag/helpers/delete_document';
import { uploadDocument } from '../workflow_engine/action_defs/rag/helpers/upload_document';

const INITIAL_POLLING_DELAY_MS = 10_000;
const MAX_POLLING_ATTEMPTS = 50;

export const indexKnowledgeFile = internalAction({
  args: {
    customAgentId: v.id('customAgents'),
    fileId: v.id('_storage'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const ragServiceUrl = getRagConfig().serviceUrl;

    try {
      await uploadDocument(ctx, ragServiceUrl, String(args.fileId));

      await ctx.scheduler.runAfter(
        INITIAL_POLLING_DELAY_MS,
        internal.custom_agents.internal_actions.checkKnowledgeFileStatus,
        {
          customAgentId: args.customAgentId,
          fileId: args.fileId,
          attempt: 1,
        },
      );
    } catch (error) {
      console.error(
        `[indexKnowledgeFile] Failed to upload file ${args.fileId}:`,
        error,
      );
      await ctx.runMutation(
        internal.custom_agents.internal_mutations.updateKnowledgeFileRagInfo,
        {
          customAgentId: args.customAgentId,
          fileId: args.fileId,
          ragStatus: 'failed',
          ragError: error instanceof Error ? error.message : 'Upload failed',
        },
      );
    }

    return null;
  },
});

export const checkKnowledgeFileStatus = internalAction({
  args: {
    customAgentId: v.id('customAgents'),
    fileId: v.id('_storage'),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (args.attempt > MAX_POLLING_ATTEMPTS) {
      console.warn(
        `[checkKnowledgeFileStatus] Max attempts reached for file ${args.fileId}`,
      );
      await ctx.runMutation(
        internal.custom_agents.internal_mutations.updateKnowledgeFileRagInfo,
        {
          customAgentId: args.customAgentId,
          fileId: args.fileId,
          ragStatus: 'failed',
          ragError: `Status check timed out after ${MAX_POLLING_ATTEMPTS} attempts`,
        },
      );
      return null;
    }

    const ragUrl = getRagConfig().serviceUrl;
    const url = `${ragUrl}/api/v1/documents/statuses`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_ids: [String(args.fileId)] }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 429 || !response.ok) {
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
        ) {
          await ctx.runMutation(
            internal.custom_agents.internal_mutations
              .updateKnowledgeFileRagInfo,
            {
              customAgentId: args.customAgentId,
              fileId: args.fileId,
              ragStatus: 'failed',
              ragError: `RAG service returned ${response.status}`,
            },
          );
          return null;
        }

        await ctx.scheduler.runAfter(
          getPollingInterval(args.attempt),
          internal.custom_agents.internal_actions.checkKnowledgeFileStatus,
          {
            customAgentId: args.customAgentId,
            fileId: args.fileId,
            attempt: args.attempt + 1,
          },
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

      const docStatus = statuses[String(args.fileId)];
      const status = isRecord(docStatus)
        ? getString(docStatus, 'status')
        : null;
      const error = isRecord(docStatus)
        ? getString(docStatus, 'error')
        : undefined;

      if (status === 'completed') {
        await ctx.runMutation(
          internal.custom_agents.internal_mutations.updateKnowledgeFileRagInfo,
          {
            customAgentId: args.customAgentId,
            fileId: args.fileId,
            ragStatus: 'completed',
            ragIndexedAt: Math.floor(Date.now() / 1000),
          },
        );
        return null;
      }

      if (status === 'failed') {
        await ctx.runMutation(
          internal.custom_agents.internal_mutations.updateKnowledgeFileRagInfo,
          {
            customAgentId: args.customAgentId,
            fileId: args.fileId,
            ragStatus: 'failed',
            ragError: error || 'Unknown error',
          },
        );
        return null;
      }

      if (status === 'processing') {
        await ctx.runMutation(
          internal.custom_agents.internal_mutations.updateKnowledgeFileRagInfo,
          {
            customAgentId: args.customAgentId,
            fileId: args.fileId,
            ragStatus: 'running',
          },
        );
      }

      await ctx.scheduler.runAfter(
        getPollingInterval(args.attempt),
        internal.custom_agents.internal_actions.checkKnowledgeFileStatus,
        {
          customAgentId: args.customAgentId,
          fileId: args.fileId,
          attempt: args.attempt + 1,
        },
      );
    } catch (error) {
      console.error(
        `[checkKnowledgeFileStatus] Error (attempt ${args.attempt}):`,
        error,
      );
      await ctx.scheduler.runAfter(
        getPollingInterval(args.attempt),
        internal.custom_agents.internal_actions.checkKnowledgeFileStatus,
        {
          customAgentId: args.customAgentId,
          fileId: args.fileId,
          attempt: args.attempt + 1,
        },
      );
    }

    return null;
  },
});

export const deleteKnowledgeFileFromRag = internalAction({
  args: {
    fileId: v.id('_storage'),
  },
  returns: v.null(),
  handler: async (_ctx, args): Promise<null> => {
    const ragServiceUrl = getRagConfig().serviceUrl;

    try {
      await deleteDocumentById({
        ragServiceUrl,
        fileId: String(args.fileId),
      });
    } catch (error) {
      console.error(
        `[deleteKnowledgeFileFromRag] Failed to delete file ${args.fileId}:`,
        error,
      );
    }

    return null;
  },
});
