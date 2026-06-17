'use node';

import { readdir } from 'node:fs/promises';

import type { Infer } from 'convex/values';
import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import { getPollingInterval } from '../documents/internal_actions';
import { handleDirReadError, readJsonFile } from '../lib/file_io';
import { orgSlugFromId } from '../lib/helpers/org_slug';
import { deleteDocumentById } from '../workflow_engine/action_defs/rag/helpers/delete_document';
import { uploadDocument } from '../workflow_engine/action_defs/rag/helpers/upload_document';
import { resolveAgentDisplay } from './config';
import type { AgentJsonConfig, AgentReadResult } from './file_utils';
import {
  MAX_FILE_SIZE_BYTES,
  agentNameFromFileName,
  parseAgentJson,
  resolveAgentFilePath,
  resolveAgentsDir,
  validateAgentName,
} from './file_utils';
import { knowledgeFileRagStatusValidator } from './schema';

const INITIAL_POLLING_DELAY_MS = 10_000;
const MAX_POLLING_ATTEMPTS = 50;

// In-process cache for the agent-list projection (per orgSlug). `resolveAutoRoute`
// calls `listAgentsInternal` on EVERY Auto turn — including cached/short-circuited
// routes — and the handler readdir's the agents dir then reads + parses +
// i18n-resolves every agent JSON from disk each time. That disk fan-out is the
// dominant cost of an otherwise-instant cached route (~seconds on a self-hosted
// backend). A short TTL keeps warm turns off the disk while bounding staleness: a
// newly created/edited/deleted agent appears in routing within the TTL. Module
// scope persists across warm action invocations (same pattern as the provider
// routing-catalog cache). Only successful reads are cached.
// 60s: the auto-route cache is independently keyed on the candidates hash, so a
// roster change still re-routes correctly within a turn — this TTL only bounds
// how long a newly created/edited agent waits to become a routing *candidate*
// (≤60s), which is an acceptable trade for keeping every warm Auto turn of a
// session off the multi-file agent-JSON disk read. Module cache resets on deploy.
const AGENT_LIST_CACHE_TTL_MS = 60_000;
const agentListCache = new Map<
  string,
  { entries: unknown[]; expiresAt: number }
>();

/**
 * Write-through cache drop for org-chart writes (`writeAgentDelegates` /
 * `writeAgentParents`): a delegation edit must be visible to the next chart
 * read in THIS isolate without waiting out the TTL. Other isolates converge
 * within the 60s TTL, same as every other agent-file edit.
 */
export function invalidateAgentListCache(orgSlug: string): void {
  agentListCache.delete(orgSlug);
}

interface StatusCheckArgs {
  organizationId: string;
  agentSlug: string;
  fileId: Id<'_storage'>;
  attempt: number;
}

/** Persist a knowledge file's RAG indexing state on its agent binding. */
async function updateRagInfo(
  ctx: ActionCtx,
  fields: {
    organizationId: string;
    agentSlug: string;
    fileId: Id<'_storage'>;
    ragStatus: Infer<typeof knowledgeFileRagStatusValidator>;
    ragIndexedAt?: number;
    ragError?: string;
  },
): Promise<void> {
  await ctx.runMutation(
    internal.agents.internal_mutations.updateKnowledgeFileRagInfo,
    fields,
  );
}

/** Re-arm the status poll for the next attempt with a backoff delay. */
async function rescheduleStatusCheck(
  ctx: ActionCtx,
  args: StatusCheckArgs,
): Promise<void> {
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
      await updateRagInfo(ctx, {
        organizationId: args.organizationId,
        agentSlug: args.agentSlug,
        fileId: args.fileId,
        ragStatus: 'failed',
        ragError: error instanceof Error ? error.message : 'Upload failed',
      });
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
      await updateRagInfo(ctx, {
        organizationId: args.organizationId,
        agentSlug: args.agentSlug,
        fileId: args.fileId,
        ragStatus: 'failed',
        ragError: `Status check timed out after ${MAX_POLLING_ATTEMPTS} attempts`,
      });
      return null;
    }

    try {
      const orgSlug = await orgSlugFromId(ctx, args.organizationId);
      // In-process status lookup (replaces the external RAG
      // `/api/v1/documents/statuses`). The action throws on a knowledge-db
      // fault; the catch below reschedules. There is no longer an HTTP status
      // code to branch on, so transient faults always retry via reschedule.
      const result = await ctx.runAction(internal.rag.documents.getStatuses, {
        orgSlug,
        fileIds: [String(args.fileId)],
      });

      const docStatus = result.statuses[String(args.fileId)];
      const status = docStatus ? docStatus.status : null;
      const error = docStatus ? (docStatus.error ?? undefined) : undefined;

      if (status === 'completed') {
        await updateRagInfo(ctx, {
          organizationId: args.organizationId,
          agentSlug: args.agentSlug,
          fileId: args.fileId,
          ragStatus: 'completed',
          ragIndexedAt: Math.floor(Date.now() / 1000),
        });
        return null;
      }

      if (status === 'failed') {
        await updateRagInfo(ctx, {
          organizationId: args.organizationId,
          agentSlug: args.agentSlug,
          fileId: args.fileId,
          ragStatus: 'failed',
          ragError: error || 'Unknown error',
        });
        return null;
      }

      if (status === 'processing') {
        await updateRagInfo(ctx, {
          organizationId: args.organizationId,
          agentSlug: args.agentSlug,
          fileId: args.fileId,
          ragStatus: 'running',
        });
      }

      await rescheduleStatusCheck(ctx, args);
    } catch (error) {
      console.error(
        `[checkKnowledgeFileStatus] Error (attempt ${args.attempt}):`,
        error,
      );
      await rescheduleStatusCheck(ctx, args);
    }

    return null;
  },
});

export const deleteKnowledgeFileFromRag = internalAction({
  args: {
    organizationId: v.string(),
    fileId: v.id('_storage'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    try {
      const orgSlug = await orgSlugFromId(ctx, args.organizationId);
      await deleteDocumentById(ctx, {
        orgSlug,
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

/**
 * The agent-list projection, as a plain (non-action) async function so callers
 * already running in the Node runtime can invoke it DIRECTLY instead of paying
 * a cross-action `runAction` dispatch. `resolveAutoRoute` does exactly this on
 * EVERY Auto turn (including cached/short-circuited routes), so removing that
 * hop — while still sharing this module's `agentListCache` (module scope is one
 * instance per isolate) — cuts the dominant per-route overhead on a self-hosted
 * backend. The `internalAction` below is the thin wrapper for cross-runtime
 * callers (queries/mutations reach it via the scheduler/runAction).
 */
export async function listAgentsForOrg(orgSlug: string): Promise<unknown[]> {
  const cached = agentListCache.get(orgSlug);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.entries;
  }

  const dir = resolveAgentsDir(orgSlug);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    handleDirReadError(err, 'agents.listAgentsInternal');
    return [];
  }

  const jsonFiles = entries.filter(
    (e) => e.endsWith('.json') && !e.startsWith('.'),
  );

  const results = await Promise.all(
    jsonFiles.map(async (fileName) => {
      const agentName = agentNameFromFileName(fileName);
      if (!validateAgentName(agentName)) return null;
      const result = await readAgentFileInternal(orgSlug, agentName);
      if (result.ok) {
        // Resolve display fields from i18n — descriptions/starters live under
        // `i18n.<locale>`, not top-level, so reading them raw yields undefined
        // and the Auto router would see every agent as a blank
        // "General-purpose assistant." and never route to a specialist.
        const display = resolveAgentDisplay(result.config);
        return {
          name: agentName,
          displayName: display.displayName,
          description: display.description,
          visibleInChat: result.config.visibleInChat,
          // Required by `filterRoutingCandidates` to exclude
          // image-generation agents from chat routing — without projecting
          // it here that filter silently never fires (the field is undefined
          // on the route path) and an image agent becomes a live candidate.
          primaryBehavior: result.config.primaryBehavior,
          supportedModels: result.config.supportedModels,
          toolNames: result.config.toolNames,
          roleRestriction: result.config.roleRestriction,
          conversationStarters: display.conversationStarters,
          isRouter: result.config.isRouter,
          uiConfigurable: result.config.uiConfigurable,
          i18n: result.config.i18n,
          // Workforce projections (org chart + guardrail surfaces): shared
          // through this 60s cache so chart readers, delegation merging, and
          // the organigram UI never need a second dir scan.
          delegates: result.config.delegates,
          budget: result.config.budget,
          maxConcurrentTasks: result.config.maxConcurrentTasks,
        };
      }
      return {
        name: agentName,
        status: result.error,
        message: result.message,
      };
    }),
  );

  const projected = results.filter(Boolean);
  agentListCache.set(orgSlug, {
    entries: projected,
    expiresAt: Date.now() + AGENT_LIST_CACHE_TTL_MS,
  });
  return projected;
}

export const listAgentsInternal = internalAction({
  args: {
    orgSlug: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args) => listAgentsForOrg(args.orgSlug),
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
