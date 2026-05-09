'use node';

import { readdir } from 'node:fs/promises';

import { v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { getPollingInterval } from '../documents/internal_actions';
import { readJsonFile } from '../lib/file_io';
import { ragFetch } from '../lib/helpers/rag_config';
import { deleteDocumentById } from '../workflow_engine/action_defs/rag/helpers/delete_document';
import { uploadDocument } from '../workflow_engine/action_defs/rag/helpers/upload_document';
import type { AgentJsonConfig, AgentReadResult } from './file_utils';
import {
  MAX_FILE_SIZE_BYTES,
  agentNameFromFileName,
  parseAgentJson,
  resolveAgentFilePath,
  resolveAgentsDir,
  validateAgentName,
} from './file_utils';

const INITIAL_POLLING_DELAY_MS = 10_000;
const MAX_POLLING_ATTEMPTS = 50;

export const indexKnowledgeFile = internalAction({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    fileId: v.id('_storage'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    try {
      await uploadDocument(ctx, String(args.fileId));

      await ctx.scheduler.runAfter(
        INITIAL_POLLING_DELAY_MS,
        internal.agents.internal_actions.checkKnowledgeFileStatus,
        {
          organizationId: args.organizationId,
          agentSlug: args.agentSlug,
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
        internal.agents.internal_mutations.updateKnowledgeFileRagInfo,
        {
          organizationId: args.organizationId,
          agentSlug: args.agentSlug,
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
    organizationId: v.string(),
    agentSlug: v.string(),
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
        internal.agents.internal_mutations.updateKnowledgeFileRagInfo,
        {
          organizationId: args.organizationId,
          agentSlug: args.agentSlug,
          fileId: args.fileId,
          ragStatus: 'failed',
          ragError: `Status check timed out after ${MAX_POLLING_ATTEMPTS} attempts`,
        },
      );
      return null;
    }

    try {
      const response = await ragFetch('/api/v1/documents/statuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ids: [String(args.fileId)] }),
        timeoutMs: 10_000,
      });

      if (response.status === 429 || !response.ok) {
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
        ) {
          await ctx.runMutation(
            internal.agents.internal_mutations.updateKnowledgeFileRagInfo,
            {
              organizationId: args.organizationId,
              agentSlug: args.agentSlug,
              fileId: args.fileId,
              ragStatus: 'failed',
              ragError: `RAG service returned ${response.status}`,
            },
          );
          return null;
        }

        await ctx.scheduler.runAfter(
          getPollingInterval(args.attempt),
          internal.agents.internal_actions.checkKnowledgeFileStatus,
          {
            organizationId: args.organizationId,
            agentSlug: args.agentSlug,
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
          internal.agents.internal_mutations.updateKnowledgeFileRagInfo,
          {
            organizationId: args.organizationId,
            agentSlug: args.agentSlug,
            fileId: args.fileId,
            ragStatus: 'completed',
            ragIndexedAt: Math.floor(Date.now() / 1000),
          },
        );
        return null;
      }

      if (status === 'failed') {
        await ctx.runMutation(
          internal.agents.internal_mutations.updateKnowledgeFileRagInfo,
          {
            organizationId: args.organizationId,
            agentSlug: args.agentSlug,
            fileId: args.fileId,
            ragStatus: 'failed',
            ragError: error || 'Unknown error',
          },
        );
        return null;
      }

      if (status === 'processing') {
        await ctx.runMutation(
          internal.agents.internal_mutations.updateKnowledgeFileRagInfo,
          {
            organizationId: args.organizationId,
            agentSlug: args.agentSlug,
            fileId: args.fileId,
            ragStatus: 'running',
          },
        );
      }

      await ctx.scheduler.runAfter(
        getPollingInterval(args.attempt),
        internal.agents.internal_actions.checkKnowledgeFileStatus,
        {
          organizationId: args.organizationId,
          agentSlug: args.agentSlug,
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
        internal.agents.internal_actions.checkKnowledgeFileStatus,
        {
          organizationId: args.organizationId,
          agentSlug: args.agentSlug,
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
    try {
      await deleteDocumentById({
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

// ---------------------------------------------------------------------------
// REST API helpers — internal actions for listing/reading agent configs
// ---------------------------------------------------------------------------

async function readAgentFileInternal(
  orgSlug: string,
  agentName: string,
): Promise<AgentReadResult> {
  const filePath = resolveAgentFilePath(orgSlug, agentName);
  const result = await readJsonFile<AgentJsonConfig>(
    filePath,
    MAX_FILE_SIZE_BYTES,
    parseAgentJson,
  );
  if (result.ok) {
    return { ok: true, config: result.data, hash: result.hash };
  }
  return result;
}

export const listAgentsInternal = internalAction({
  args: {
    orgSlug: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const dir = resolveAgentsDir(args.orgSlug);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }

    const jsonFiles = entries.filter(
      (e) => e.endsWith('.json') && !e.startsWith('.'),
    );

    const results = await Promise.all(
      jsonFiles.map(async (fileName) => {
        const agentName = agentNameFromFileName(fileName);
        if (!validateAgentName(agentName)) return null;
        const result = await readAgentFileInternal(args.orgSlug, agentName);
        if (result.ok) {
          return {
            name: agentName,
            displayName: result.config.displayName,
            description: result.config.description,
            visibleInChat: result.config.visibleInChat,
            supportedModels: result.config.supportedModels,
            toolNames: result.config.toolNames,
            roleRestriction: result.config.roleRestriction,
            conversationStarters: result.config.conversationStarters,
            i18n: result.config.i18n,
          };
        }
        return {
          name: agentName,
          status: result.error,
          message: result.message,
        };
      }),
    );

    return results.filter(Boolean);
  },
});

export const readAgentInternal = internalAction({
  args: {
    orgSlug: v.string(),
    agentName: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    return readAgentFileInternal(args.orgSlug, args.agentName);
  },
});
