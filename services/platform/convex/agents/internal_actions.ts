'use node';

import type { Infer } from 'convex/values';
import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import { getPollingInterval } from '../documents/internal_actions';
import { readJsonFile } from '../lib/file_io';
import { orgSlugFromId } from '../lib/helpers/org_slug';
import { deleteDocumentById } from '../workflow_engine/action_defs/rag/helpers/delete_document';
import { uploadDocument } from '../workflow_engine/action_defs/rag/helpers/upload_document';
import { resolveAgentDisplay } from './config';
import type { AgentJsonConfig, AgentReadResult } from './file_utils';
import {
  MAX_FILE_SIZE_BYTES,
  effectiveAgentSlug,
  parseAgentJson,
  resolveAgentFilePath,
  resolveAgentFilePathFromRelative,
  walkAgentRelativePaths,
} from './file_utils';
import type { knowledgeFileRagStatusValidator } from './schema';
import { agentSlugFromFileName } from './validators';

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
interface AgentIndex {
  /** Projected roster entries (consumed by router / chart / settings). */
  entries: unknown[];
  /** slug → relative file path (`workforce/ceo.json`) for read/write resolution. */
  slugToPath: Map<string, string>;
  expiresAt: number;
}
const agentListCache = new Map<string, AgentIndex>();

/**
 * Write-through cache drop for org-chart writes (`writeAgentDelegates`): a
 * delegation edit must be visible to the next chart read in THIS isolate
 * without waiting out the TTL. Other isolates converge
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

/** Read + parse one agent file at a known relative path (`workforce/ceo.json`). */
async function readAgentByRelPath(
  orgSlug: string,
  relativePath: string,
): Promise<AgentReadResult> {
  const filePath = resolveAgentFilePathFromRelative(orgSlug, relativePath);
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
 * Build (or return cached) the org's agent index: the projected roster entries
 * AND the slug→relativePath map. ONE recursive scan over the folder tree
 * (chat/, workforce/, github/, …); identity is the config's explicit `slug`
 * (basename fallback). Duplicate slugs are dropped (first wins) with a warning —
 * a misauthored catalog should never silently shadow an agent. The 60s TTL +
 * write-through `invalidateAgentListCache` keep this off the disk on warm turns.
 */
async function buildAgentIndex(orgSlug: string): Promise<AgentIndex> {
  const relPaths = await walkAgentRelativePaths(orgSlug);
  const slugToPath = new Map<string, string>();

  const projected = (
    await Promise.all(
      relPaths.map(async (relativePath) => {
        const result = await readAgentByRelPath(orgSlug, relativePath);
        // Unreadable file: identity falls back to the basename (no parsed
        // config to read `slug` from). `agentSlugFromFileName` is the shared
        // basename helper — it never returns undefined (no `!` needed).
        const slug = result.ok
          ? effectiveAgentSlug(result.config, relativePath)
          : agentSlugFromFileName(relativePath);

        if (slugToPath.has(slug)) {
          console.warn(
            `[agents.buildAgentIndex] duplicate agent slug "${slug}" — keeping ${slugToPath.get(
              slug,
            )}, ignoring ${relativePath}`,
          );
          return null;
        }
        slugToPath.set(slug, relativePath);

        if (result.ok) {
          // Resolve display fields from i18n — descriptions/starters live under
          // `i18n.<locale>`, not top-level, so reading them raw yields undefined
          // and the Auto router would see every agent as a blank assistant.
          const display = resolveAgentDisplay(result.config);
          return {
            // `name` IS the canonical slug (router/chart/mention consume it).
            name: slug,
            slug,
            displayName: display.displayName,
            description: display.description,
            visibleInChat: result.config.visibleInChat,
            primaryBehavior: result.config.primaryBehavior,
            supportedModels: result.config.supportedModels,
            toolNames: result.config.toolNames,
            roleRestriction: result.config.roleRestriction,
            conversationStarters: display.conversationStarters,
            isRouter: result.config.isRouter,
            uiConfigurable: result.config.uiConfigurable,
            i18n: result.config.i18n,
            // Workforce projections (org chart + guardrails) shared via this cache.
            delegates: result.config.delegates,
            budget: result.config.budget,
            maxConcurrentTasks: result.config.maxConcurrentTasks,
            // Install/catalog/cascade metadata (autoInstall, group, requires, …).
            metadata: result.config.metadata,
          };
        }
        return {
          name: slug,
          slug,
          status: result.error,
          message: result.message,
        };
      }),
    )
  ).filter(Boolean);

  const index: AgentIndex = {
    entries: projected,
    slugToPath,
    expiresAt: Date.now() + AGENT_LIST_CACHE_TTL_MS,
  };
  agentListCache.set(orgSlug, index);
  return index;
}

/** Ensure the index is warm and return it (cache hit or fresh build). */
async function ensureAgentIndex(orgSlug: string): Promise<AgentIndex> {
  const cached = agentListCache.get(orgSlug);
  if (cached && cached.expiresAt > Date.now()) return cached;
  return buildAgentIndex(orgSlug);
}

/**
 * The agent-list projection, as a plain (non-action) async function so callers
 * already running in the Node runtime can invoke it DIRECTLY instead of paying
 * a cross-action `runAction` dispatch. `resolveAutoRoute` does exactly this on
 * EVERY Auto turn. Shares this module's `agentListCache` (one instance per
 * isolate). The `internalAction` below is the thin cross-runtime wrapper.
 */
export async function listAgentsForOrg(orgSlug: string): Promise<unknown[]> {
  return (await ensureAgentIndex(orgSlug)).entries;
}

/**
 * The roster GATE: the agents that are actually LIVE for an org — installed &&
 * enabled. This is what the router (`resolveAutoRoute`) and other roster
 * consumers see, so a disabled/uninstalled agent is never a routing candidate.
 *
 * No fallback: an agent is in the roster IFF it has an enabled install row. A
 * row-less org has an empty roster (every org is provisioned at create with the
 * default agents). The system router (`isRouter`) is the one exemption — it is
 * read from disk on the classify path and never needs an install row.
 */
export async function listInstalledAgentsForOrg(
  ctx: ActionCtx,
  organizationId: string,
  orgSlug: string,
): Promise<unknown[]> {
  const entries = await listAgentsForOrg(orgSlug);
  const { states } = await ctx.runQuery(
    internal.agents.installations.listInstallStatesInternal,
    { organizationId },
  );
  const bySlug = new Map(states.map((s) => [s.agentSlug, s] as const));
  return entries.filter((e) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- entries come from buildAgentIndex's v.any() projection; we read only slug/name/isRouter for the gate
    const entry = e as { slug?: string; name?: string; isRouter?: boolean };
    if (entry.isRouter === true) return true;
    const slug = entry.slug ?? entry.name;
    if (!slug) return false;
    return bySlug.get(slug)?.enabled === true;
  });
}

/**
 * Resolve a slug → relative file path (`workforce/ceo.json`) via the index, so
 * reads/writes/history locate the backing file wherever it lives in the folder
 * tree. Returns undefined for an unknown slug (caller falls back to the flat
 * `<slug>.json` path for new-file creation).
 */
export async function resolveAgentRelativePath(
  orgSlug: string,
  slug: string,
): Promise<string | undefined> {
  return (await ensureAgentIndex(orgSlug)).slugToPath.get(slug);
}

/**
 * Absolute path of the file backing an EXISTING agent slug — located through
 * the folder-aware index so an edit/delete/history/delegation op writes back to
 * wherever the file lives (chat/, workforce/, github/, …). Falls back to the
 * flat `<slug>.json` path when the slug isn't indexed (a brand-new agent, or a
 * file written in this isolate before the 60s cache refreshed). Shared by every
 * read/write path so file location is resolved in exactly one place.
 */
export async function resolveAgentPath(
  orgSlug: string,
  slug: string,
): Promise<string> {
  const rel = await resolveAgentRelativePath(orgSlug, slug);
  return rel
    ? resolveAgentFilePathFromRelative(orgSlug, rel)
    : resolveAgentFilePath(orgSlug, slug);
}

/**
 * Read one agent's config by slug, locating the file through the index. Falls
 * back to the flat `<slug>.json` path when the slug isn't indexed yet (e.g. a
 * file written in this isolate before the cache refreshed).
 */
export async function readAgentBySlug(
  orgSlug: string,
  slug: string,
): Promise<AgentReadResult> {
  const rel = await resolveAgentRelativePath(orgSlug, slug);
  if (rel) return readAgentByRelPath(orgSlug, rel);
  return readAgentByRelPath(orgSlug, `${slug}.json`);
}

export const listAgentsInternal = internalAction({
  args: {
    orgSlug: v.string(),
    // Optional for back-compat: when provided, the roster is gated to
    // installed && enabled agents; when omitted, the full catalog is returned.
    organizationId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) =>
    args.organizationId
      ? listInstalledAgentsForOrg(ctx, args.organizationId, args.orgSlug)
      : listAgentsForOrg(args.orgSlug),
});

export const readAgentInternal = internalAction({
  args: {
    orgSlug: v.string(),
    agentName: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    return readAgentBySlug(args.orgSlug, args.agentName);
  },
});
