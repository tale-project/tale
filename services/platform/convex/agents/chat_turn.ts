/**
 * Track B chat entry — a V8 mutation (NOT a `'use node'` action).
 *
 * Running the orchestration in the Convex backend isolate (not the single-
 * threaded Node executor) is the whole point: it cannot CPU-saturate the Node
 * event loop, so the scheduled `runChatTurnGeneration` node action starts on a
 * free loop in ~20ms instead of waiting ~800ms behind a concurrently-running
 * `chatWithAgent` node action (the measured root cause of the pre-stream gap).
 *
 * This mutation does ONLY fast DB work: authenticate, mark the thread
 * generating (so the client spinner + stream subscription light up
 * immediately), and schedule the node action that does the disk-bound
 * resolution + generation. It returns `{ streamId }` right away — the client
 * subscribes to the stream by threadId and ignores the return value.
 *
 * Disk-bound validation (agent-config read, guardrails sanitize) + the
 * agent-config-dependent model-access gate move into the scheduled node action,
 * so those (rare) failures surface asynchronously via thread state; the client
 * `precheckInput` already covers the guardrails-block UX before send.
 */

import { ConvexError, v } from 'convex/values';

import {
  AUTO_AGENT_SLUG,
  DEFAULT_CHAT_AGENT_SLUG,
} from '../../lib/shared/constants/agents';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { mutation, type MutationCtx } from '../_generated/server';
import { isDrainingNow } from '../control/drain';
import { isActiveDocument } from '../documents/_helpers';
import { userContextValidator } from '../lib/agent_response/validators';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { hasTeamAccess } from '../lib/team_access';
import { persistentStreaming } from '../streaming/helpers';
import { cancelGeneration } from '../threads/cancel_generation';
import { normalizeMessageKey } from './auto_route_helpers';

/** Hard cap on `@`-mentioned knowledge-base documents per turn. Mirrored by
 *  the composer (`MAX_KB_MENTIONS` in use-kb-mentions.ts). */
const MAX_KB_REFERENCES = 5;

/** Branded-Id variant of `KbReferencedFile` (kb_reference_block.ts) for the
 *  scheduled-action payload. */
interface ResolvedKbReference {
  documentId: Id<'documents'>;
  fileId: Id<'_storage'>;
  fileName: string;
  fileType: string;
  fileSize: number;
}

/**
 * Resolve + authorize the composer's `@`-mentioned documents synchronously so
 * an invalid reference fails the send with a client-visible ConvexError
 * instead of a mid-generation surprise. Each reference must be: same org,
 * active, team-accessible to the sender, blob-backed, and RAG-indexed —
 * the same gate the picker query applies, re-checked server-side.
 *
 * Bounded work on the Track-B fast path: ≤ MAX_KB_REFERENCES point reads plus
 * one team lookup.
 */
async function resolveReferencedFiles(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    userId: string;
    referencedDocumentIds: Id<'documents'>[];
  },
): Promise<ResolvedKbReference[]> {
  if (args.referencedDocumentIds.length > MAX_KB_REFERENCES) {
    throw new ConvexError({ code: 'KB_REF_INVALID' });
  }
  const userTeamIds = await getUserTeamIds(ctx, args.userId);
  // Org-wide sentinel mirrors get_accessible_document_ids.ts.
  const teamSet = new Set([`org_${args.organizationId}`, ...userTeamIds]);

  const resolved: ResolvedKbReference[] = [];
  const seen = new Set<string>();
  for (const documentId of args.referencedDocumentIds) {
    if (seen.has(documentId)) continue;
    seen.add(documentId);

    const doc = await ctx.db.get(documentId);
    // One opaque code for every failure mode so the error doesn't reveal
    // whether an inaccessible document exists.
    if (
      !doc ||
      doc.organizationId !== args.organizationId ||
      !isActiveDocument(doc) ||
      !hasTeamAccess(doc, teamSet)
    ) {
      throw new ConvexError({ code: 'KB_REF_INVALID' });
    }
    const fileId = doc.fileId;
    if (!fileId) {
      throw new ConvexError({ code: 'KB_REF_INVALID' });
    }
    const fm = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
      .first();
    if (!fm || fm.ragStatus !== 'completed') {
      throw new ConvexError({ code: 'KB_REF_INVALID' });
    }
    resolved.push({
      documentId,
      fileId,
      fileName: doc.title?.trim() || fm.fileName,
      fileType: doc.mimeType ?? fm.contentType,
      fileSize: fm.size,
    });
  }
  return resolved;
}

export const chatWithAgentTurn = mutation({
  args: {
    agentSlug: v.string(),
    threadId: v.string(),
    organizationId: v.string(),
    message: v.string(),
    maxSteps: v.optional(v.number()),
    attachments: v.optional(
      v.array(
        v.object({
          fileId: v.id('_storage'),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
    modelId: v.optional(v.string()),
    capabilityBindings: v.optional(v.array(v.string())),
    additionalContext: v.optional(v.record(v.string(), v.string())),
    userContext: v.optional(userContextValidator),
    projectId: v.optional(v.id('projects')),
    /**
     * Knowledge-base documents the user pinned to this turn via the
     * composer's `@`-mention picker (cap 5). Validated synchronously
     * (org/team access, active, RAG-indexed) — an invalid reference throws
     * `KB_REF_INVALID` before anything is marked generating.
     */
    referencedDocumentIds: v.optional(v.array(v.id('documents'))),
    /**
     * Cache pre-warm. Fired on composer focus/typing: resolves the agent +
     * config exactly as a real turn would and primes the prompt cache with one
     * throwaway generation — NO markGenerating, NO stream, NO saved message, NO
     * title, NO supersede. Routed to the default chat agent for Auto (skip the
     * classifier — the real turn may route elsewhere anyway). Best-effort.
     */
    prewarm: v.optional(v.boolean()),
    // Arena: when this turn is the ROOT side (thread A) of an A/B comparison,
    // the branch-thread id (thread B). The branch link is created from the
    // node action AFTER this thread's user message is saved — creating it
    // eagerly in arenaChat raced the async save and threw on the first turn.
    arenaBranchThreadId: v.optional(v.string()),
  },
  returns: v.object({
    messageAlreadyExists: v.boolean(),
    streamId: v.string(),
  }),
  handler: async (ctx, args) => {
    const requestStartMs = Date.now();

    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    // Cache pre-warm: invisible. Skip markGenerating / stream / supersede /
    // project persist entirely — just schedule the throwaway priming
    // generation. Don't spend a routing classifier on a prewarm (the real turn
    // may route elsewhere); prime the default agent's prefix (the common case).
    if (args.prewarm) {
      await ctx.scheduler.runAfter(
        0,
        internal.agents.chat_turn_generate.runChatTurnGeneration,
        {
          agentSlug:
            args.agentSlug === AUTO_AGENT_SLUG
              ? DEFAULT_CHAT_AGENT_SLUG
              : args.agentSlug,
          organizationId: args.organizationId,
          message: args.message,
          modelId: args.modelId,
          attachments: args.attachments,
          capabilityBindings: args.capabilityBindings,
          additionalContext: args.additionalContext,
          userContext: args.userContext,
          maxSteps: args.maxSteps,
          projectId: args.projectId,
          threadId: args.threadId,
          // No stream for a prewarm — the generation runs in prewarm mode and
          // persists nothing.
          streamId: '',
          userId: authUser.userId,
          userEmail: authUser.email ?? '',
          userName: authUser.name ?? '',
          requestStartMs,
          prewarm: true,
        },
      );
      return { messageAlreadyExists: false, streamId: '' };
    }

    // Deploy drain gate: a `tale deploy` recreates the convex container in
    // place, killing every in-flight (non-durable) chat generation. While the
    // CLI is draining, refuse NEW turns so nothing starts mid-restart — the
    // client retries this coded error onto the restarted backend (mirrors the
    // sandbox spawner's 503 "draining"). Prewarm bypasses (it returned above);
    // in-flight turns keep running and the CLI waits for them.
    if (await isDrainingNow(ctx)) {
      throw new ConvexError({ code: 'BACKEND_DRAINING' });
    }

    // Projects: validate access here (DB query) so a denial throws
    // synchronously and the client shows a PROJECT_* toast (same UX as before
    // Track B). The thread↔project persist + PROJECT_MISMATCH check stay in
    // startChat (reached via the node action).
    if (args.projectId) {
      const projectAccess = await ctx.runQuery(
        internal.projects.internal_queries.assertProjectAccessForChat,
        {
          projectId: args.projectId,
          organizationId: args.organizationId,
          userId: authUser.userId,
        },
      );
      if (!projectAccess.allowed) {
        throw new ConvexError({
          code:
            projectAccess.reason === 'not_found'
              ? 'PROJECT_NOT_FOUND'
              : projectAccess.reason === 'org_mismatch'
                ? 'PROJECT_ORG_MISMATCH'
                : 'PROJECT_FORBIDDEN',
        });
      }
    }

    // Resolve + authorize `@`-mentioned knowledge-base documents BEFORE any
    // state is committed, so a stale/inaccessible reference throws
    // synchronously (client toast) and never leaves the thread generating.
    const referencedFiles =
      args.referencedDocumentIds && args.referencedDocumentIds.length > 0
        ? await resolveReferencedFiles(ctx, {
            organizationId: args.organizationId,
            userId: authUser.userId,
            referencedDocumentIds: args.referencedDocumentIds,
          })
        : undefined;

    // markGenerating inline (mirrors threads/internal_mutations:markGenerating)
    // — commit the spinner state + allocate the stream synchronously so the
    // subscription lights up with minimal delay. For Auto mode the resolved
    // agent isn't known yet (routing happens in the node action), so the slug
    // is patched there.
    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    if (!meta || meta.userId !== authUser.userId) {
      throw new Error('Thread not found');
    }
    if (meta.organizationId && meta.organizationId !== args.organizationId) {
      throw new Error('Thread does not belong to the requested organization');
    }

    // Projects: detect a thread↔project mismatch synchronously so the client
    // gets a PROJECT_MISMATCH toast (the same UX as before Track B), rather
    // than failing silently when startChat's async check throws into the node
    // action's outer catch. `meta` is already read above, so this is ~free.
    // startChat keeps the same check as defense-in-depth for other callers.
    if (args.projectId && meta.projectId && meta.projectId !== args.projectId) {
      throw new ConvexError({ code: 'PROJECT_MISMATCH' });
    }

    // Supersede an in-flight generation: if this thread is already generating,
    // cancel the running turn (aborts its SDK stream → the running action's
    // abort watcher stops it) before starting a new one. Prevents a concurrent
    // / cancel-then-resend send from double-generating and double-billing.
    // Reuses the same helper as the user-facing Stop, so cancel→resend keeps
    // working (no hard reject). Like Stop, the abort is poll-based (~1.5s), so
    // a near-instant prior turn may still finalize — acceptable parity.
    if (meta.generationStatus === 'generating' && meta.streamId) {
      await cancelGeneration(ctx, authUser.userId, args.threadId);
    }

    const streamId = await persistentStreaming.createStream(ctx);
    const isAuto = args.agentSlug === AUTO_AGENT_SLUG;
    await ctx.db.patch(meta._id, {
      generationStatus: 'generating' as const,
      streamId,
      generationStartTime: Date.now(),
      updatedAt: Date.now(),
      cancelledAt: undefined,
      cancelledMessageId: undefined,
      // Clear any prior turn's live route so the UI never flashes a stale
      // "Routed to X" while this turn is still routing (mirrors
      // threads/internal_mutations:markGenerating).
      liveRoute: undefined,
      ...(isAuto ? {} : { agentSlug: args.agentSlug }),
    });

    // Route-quality feedback: the user explicitly pinned an agent. If this is
    // the SAME message a prior Auto turn routed elsewhere, that's a sound
    // misroute correction — fold it into the auto-route cache (off-path,
    // best-effort).
    if (!isAuto) {
      void ctx
        .runMutation(internal.agents.internal_mutations.recordRouteOverride, {
          threadId: args.threadId,
          organizationId: args.organizationId,
          explicitSlug: args.agentSlug,
          messageKey: normalizeMessageKey(args.message),
          nowMs: Date.now(),
        })
        .catch((err: unknown) =>
          console.warn(
            '[chatWithAgentTurn] recordRouteOverride failed:',
            err instanceof Error ? err.message : err,
          ),
        );
    }

    await ctx.scheduler.runAfter(
      0,
      internal.agents.chat_turn_generate.runChatTurnGeneration,
      {
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
        message: args.message,
        modelId: args.modelId,
        attachments: args.attachments,
        capabilityBindings: args.capabilityBindings,
        additionalContext: args.additionalContext,
        userContext: args.userContext,
        maxSteps: args.maxSteps,
        projectId: args.projectId,
        threadId: args.threadId,
        streamId,
        userId: authUser.userId,
        userEmail: authUser.email ?? '',
        userName: authUser.name ?? '',
        requestStartMs,
        arenaBranchThreadId: args.arenaBranchThreadId,
        referencedFiles,
      },
    );

    // The client subscribes to the stream by threadId and ignores this return;
    // dedup is decided in the node action (saveMessage), so report false here.
    return { messageAlreadyExists: false, streamId };
  },
});
