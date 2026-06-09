import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import {
  recordOutcome,
  type ReasoningOutcome,
} from '../lib/agent_response/reasoning/controller';
import { getAuthUserIdentity } from '../lib/rls';
import { assertThreadAccess } from '../lib/rls/auth/can_access_thread';
import { persistentStreaming } from '../streaming/helpers';
import { autoRouteReasonValidator } from '../streaming/validators';
import {
  archiveChatThread as archiveHelper,
  unarchiveChatThread as unarchiveHelper,
} from './archive_chat_thread';
import { BULK_THREAD_BATCH_SIZE } from './bulk_thread_actions';
import { cleanupOrphanedSubThreads as cleanupOrphanedSubThreadsHandler } from './cleanup_orphaned_sub_threads';
import { createChatThread as createHelper } from './create_chat_thread';
import { deleteChatThread as deleteHelper } from './delete_chat_thread';
import { getOrCreateSubThread } from './get_or_create_sub_thread';
import { updateChatThread as updateHelper } from './update_chat_thread';

/**
 * Caller-identity gate for the REST-facing thread internal mutations.
 *
 * REST handlers (`threads/rest_api.ts`) resolve the caller's userId + org
 * via `withRestAuth` and forward both to the internal mutation. The
 * mutation then runs `assertThreadAccess` so that an org-A API key can't
 * mutate an org-B thread by guessing the threadId — same gate the public
 * mutations enforce (round-2 v14 B8).
 *
 * System-internal callers (e.g. `generate_thread_title.ts`) write on
 * behalf of no user and pass neither arg; the gate is skipped. Any NEW
 * REST surface added to this file MUST pass both args.
 */
async function gateThreadAccess(
  ctx: MutationCtx,
  threadId: string,
  callerUserId: string | undefined,
  callerOrgId: string | undefined,
): Promise<void> {
  if (callerUserId === undefined && callerOrgId === undefined) return;
  if (callerUserId === undefined || callerOrgId === undefined) {
    // Half-specified caller is a programming error, not an auth bypass.
    throw new Error(
      'Both callerUserId and callerOrgId must be provided together',
    );
  }
  await assertThreadAccess(
    ctx,
    threadId,
    { userId: callerUserId },
    callerOrgId,
  );
}

/** Look up a thread's metadata row by its public `threadId`. */
function getThreadMetadataRow(
  ctx: MutationCtx,
  threadId: string,
): Promise<Doc<'threadMetadata'> | null> {
  return ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .first();
}

/**
 * Shared validator args for a completed turn's reasoning outcome. Mirrors the
 * non-routing fields of `ReasoningOutcome`; folded into both the per-thread
 * state and the cross-thread profile.
 */
const reasoningOutcomeArgs = {
  difficultyClass: v.union(
    v.literal('easy'),
    v.literal('medium'),
    v.literal('hard'),
  ),
  budgetTokens: v.number(),
  selfTruncates: v.boolean(),
  reasoningTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  intensity: v.optional(v.number()),
  finishReason: v.optional(v.string()),
  retried: v.optional(v.boolean()),
  qualityScore: v.optional(v.number()),
} as const;

function toReasoningOutcome(args: {
  difficultyClass: ReasoningOutcome['difficultyClass'];
  budgetTokens: number;
  selfTruncates: boolean;
  reasoningTokens?: number;
  outputTokens?: number;
  intensity?: number;
  finishReason?: string;
  retried?: boolean;
  qualityScore?: number;
}): ReasoningOutcome {
  return {
    difficultyClass: args.difficultyClass,
    reasoningTokens: args.reasoningTokens,
    outputTokens: args.outputTokens,
    intensity: args.intensity,
    budgetTokens: args.budgetTokens,
    selfTruncates: args.selfTruncates,
    finishReason: args.finishReason,
    retried: args.retried,
    qualityScore: args.qualityScore,
  };
}

/**
 * Fold a completed turn's outcome into the thread's Adaptive Reasoning Governor
 * state (Layer C). Called fire-and-forget from `generateAgentResponse` after a
 * successful turn; the controller math is pure and runs read-modify-write here
 * so concurrent turns can't clobber each other's statistics. A no-op when the
 * thread row is gone.
 */
export const updateThreadReasoningState = internalMutation({
  args: {
    threadId: v.string(),
    ...reasoningOutcomeArgs,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await getThreadMetadataRow(ctx, args.threadId);
    if (!row) return null;
    const next = recordOutcome(row.reasoningState, toReasoningOutcome(args));
    await ctx.db.patch(row._id, { reasoningState: next });
    return null;
  },
});

/**
 * Persist (or advance) the auto-compaction rolling summary for a thread. Guards
 * against a stale/regressing write under Convex OCC: only applies when the new
 * summary covers strictly MORE history than the stored one, so two concurrent
 * compactions (or a retried scheduler run) can't clobber a newer summary with an
 * older one. Returns whether the write was applied.
 */
export const updateThreadContextSummary = internalMutation({
  args: {
    threadId: v.string(),
    text: v.string(),
    coversThroughOrder: v.number(),
    tokens: v.number(),
    sourceMessageCount: v.number(),
    nowMs: v.number(),
    version: v.number(),
  },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await getThreadMetadataRow(ctx, args.threadId);
    if (!row) return { applied: false };
    const prev = row.contextSummary;
    if (prev && prev.coversThroughOrder >= args.coversThroughOrder) {
      // A summary covering at least this far already exists — newer wins.
      return { applied: false };
    }
    await ctx.db.patch(row._id, {
      contextSummary: {
        text: args.text,
        coversThroughOrder: args.coversThroughOrder,
        tokens: args.tokens,
        sourceMessageCount: args.sourceMessageCount,
        updatedAt: args.nowMs,
        version: args.version,
      },
    });
    return { applied: true };
  },
});

/**
 * Fold a completed turn's outcome into the cross-thread reasoning profile (per
 * org + scope = model id). Uses the same pure `recordOutcome` as the per-thread
 * state, so the profile is just a higher-level `ReasoningState`. Fire-and-forget
 * read-modify-write under Convex's OCC; upserts on first write. Future threads
 * (and the stateless API path) warm-start from it.
 */
export const updateReasoningProfile = internalMutation({
  args: {
    organizationId: v.string(),
    scopeKey: v.string(),
    ...reasoningOutcomeArgs,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('reasoningProfiles')
      .withIndex('by_org_scope', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('scopeKey', args.scopeKey),
      )
      .first();
    const next = recordOutcome(row?.state, toReasoningOutcome(args));
    const updatedAt = Date.now();
    if (row) {
      await ctx.db.patch(row._id, { state: next, updatedAt });
    } else {
      await ctx.db.insert('reasoningProfiles', {
        organizationId: args.organizationId,
        scopeKey: args.scopeKey,
        state: next,
        updatedAt,
      });
    }
    return null;
  },
});

export const getOrCreateSubThreadAtomic = internalMutation({
  args: {
    parentThreadId: v.string(),
    subAgentType: v.string(),
    userId: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    isNew: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await getOrCreateSubThread(
      ctx,
      args.parentThreadId,
      args.subAgentType,
      args.userId,
    );
  },
});

/**
 * Record the latest "Auto" routing decision on a thread so a subsequent
 * same-message manual override can be detected (route-quality feedback).
 * Best-effort; a no-op if the thread row is gone.
 */
export const setLastAutoRoute = internalMutation({
  args: {
    threadId: v.string(),
    messageKey: v.string(),
    candidatesHash: v.string(),
    agentSlug: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await getThreadMetadataRow(ctx, args.threadId);
    if (!row) return null;
    await ctx.db.patch(row._id, {
      lastAutoRoute: {
        messageKey: args.messageKey,
        candidatesHash: args.candidatesHash,
        agentSlug: args.agentSlug,
      },
    });
    return null;
  },
});

/**
 * Broadcast the FINAL resolved Auto-route for the in-flight turn so the client's
 * thinking timeline can show "Routed to X" mid-turn (it rides the existing
 * `getThreadMeta` subscription). Transient + UI-only: written best-effort right
 * after the routing decision settles (post-orchestration in `unified_chat`), and
 * cleared at turn start/end. A no-op if the metadata row is gone.
 */
export const setLiveRoute = internalMutation({
  args: {
    threadId: v.string(),
    agentSlug: v.string(),
    reason: autoRouteReasonValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await getThreadMetadataRow(ctx, args.threadId);
    if (!row) return null;
    await ctx.db.patch(row._id, {
      liveRoute: {
        agentSlug: args.agentSlug,
        reason: args.reason,
        at: Date.now(),
      },
    });
    return null;
  },
});

export const setLastOrchestration = internalMutation({
  args: {
    threadId: v.string(),
    primaryAgentSlug: v.string(),
    deadlineHit: v.boolean(),
    steps: v.array(
      v.object({
        id: v.string(),
        agentSlug: v.string(),
        status: v.union(
          v.literal('ok'),
          v.literal('error'),
          v.literal('skipped'),
        ),
      }),
    ),
    createdAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await getThreadMetadataRow(ctx, args.threadId);
    if (!row) return null;
    await ctx.db.patch(row._id, {
      lastOrchestration: {
        primaryAgentSlug: args.primaryAgentSlug,
        deadlineHit: args.deadlineHit,
        steps: args.steps,
        createdAt: args.createdAt,
      },
    });
    return null;
  },
});

/**
 * Mark a thread as generating ASAP. Called at the very start of the chat
 * action (before PII/config/budget checks) so the Convex subscription
 * delivers isGenerating=true to the client with minimal delay.
 *
 * Includes auth + thread ownership check so the calling action can skip
 * its own auth step — one fewer round trip.
 *
 * Returns a streamId (forwarded to startAgentChat to reuse) and the
 * authenticated user identity (so the action doesn't need to re-auth).
 */
export const markGenerating = internalMutation({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    agentSlug: v.optional(v.string()),
    /** Prewarm: run the auth + ownership checks only; do NOT create a stream or
     * flip the thread to "generating" (no spinner, no visible state change). */
    prewarm: v.optional(v.boolean()),
  },
  returns: v.object({
    streamId: v.string(),
    userId: v.string(),
    userEmail: v.string(),
    userName: v.string(),
  }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const meta = await getThreadMetadataRow(ctx, args.threadId);
    if (!meta || meta.userId !== authUser.userId) {
      console.error(
        `[markGenerating] Thread not found or ownership mismatch: threadId=${args.threadId} metaExists=${!!meta} metaUserId=${meta?.userId} authUserId=${authUser.userId}`,
      );
      throw new Error('Thread not found');
    }
    if (meta.organizationId && meta.organizationId !== args.organizationId) {
      console.error(
        `[markGenerating] Thread/org mismatch: threadId=${args.threadId} metaOrg=${meta.organizationId} argOrg=${args.organizationId} userId=${authUser.userId}`,
      );
      throw new Error('Thread does not belong to the requested organization');
    }

    if (args.prewarm) {
      // Authorized — but a prewarm must not touch visible thread state.
      return {
        streamId: '',
        userId: authUser.userId,
        userEmail: authUser.email ?? '',
        userName: authUser.name ?? '',
      };
    }

    const streamId = await persistentStreaming.createStream(ctx);
    await ctx.db.patch(meta._id, {
      generationStatus: 'generating' as const,
      streamId,
      generationStartTime: Date.now(),
      updatedAt: Date.now(),
      cancelledAt: undefined,
      cancelledMessageId: undefined,
      // Clear any prior turn's live route so the UI never flashes a stale
      // "Routed to X" at the start of this turn (re-broadcast once routing
      // re-resolves).
      liveRoute: undefined,
      ...(args.agentSlug ? { agentSlug: args.agentSlug } : {}),
    });

    return {
      streamId,
      userId: authUser.userId,
      userEmail: authUser.email ?? '',
      userName: authUser.name ?? '',
    };
  },
});

export const clearGenerationStatus = internalMutation({
  args: { threadId: v.string(), streamId: v.string() },
  handler: async (ctx, args) => {
    const meta = await getThreadMetadataRow(ctx, args.threadId);
    // Only clear if the streamId matches — prevents a stale action from
    // clearing a newer generation's 'generating' status.
    if (meta && meta.streamId === args.streamId) {
      await ctx.db.patch(meta._id, {
        generationStatus: 'idle',
        streamId: undefined,
        // Generation ended → mark "new activity" for the unread badge. The
        // sidebar compares this against the per-user `lastReadAt`.
        lastReplyAt: Date.now(),
        // Drop the transient live route — finished history reads the agent from
        // the message's own metadata.autoRouteReason instead.
        liveRoute: undefined,
      });
    }
  },
});

/**
 * Apply a bulk archive/delete to a slice of pre-collected thread ids, then
 * chain the next slice via the scheduler until the list is exhausted. Kicked
 * off by `deleteAllChatThreads` / `archiveAllChatThreads`.
 *
 * The id list is captured once by the public mutation and threaded through
 * unchanged, so processing is stable even though each action mutates the rows
 * (no risk of re-fetching the same status-keyed page forever). A single thread
 * throwing — e.g. a legal hold placed mid-sweep, or a race with another
 * mutation — is logged and skipped so it can't abort the rest of the sweep.
 *
 * Explicit `Promise<null>` return type: the handler reschedules itself via
 * `internal.*`, which would otherwise produce a circular inferred type.
 */
export const processBulkThreadAction = internalMutation({
  args: {
    threadIds: v.array(v.string()),
    offset: v.number(),
    action: v.union(v.literal('delete'), v.literal('archive')),
    userId: v.string(),
    organizationId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const slice = args.threadIds.slice(
      args.offset,
      args.offset + BULK_THREAD_BATCH_SIZE,
    );

    for (const threadId of slice) {
      try {
        if (args.action === 'delete') {
          await deleteHelper(ctx, threadId);
        } else {
          await archiveHelper(ctx, threadId);
        }
      } catch (err) {
        console.error(
          `[processBulkThreadAction] failed to ${args.action} thread ${threadId} for user ${args.userId}`,
          err,
        );
      }
    }

    const nextOffset = args.offset + BULK_THREAD_BATCH_SIZE;
    if (nextOffset < args.threadIds.length) {
      await ctx.scheduler.runAfter(
        0,
        internal.threads.internal_mutations.processBulkThreadAction,
        { ...args, offset: nextOffset },
      );
    }

    return null;
  },
});

export const cleanupOrphanedSubThreads = internalMutation({
  args: {
    parentThreadId: v.string(),
    subThreadIds: v.array(v.string()),
  },
  returns: v.object({ archivedCount: v.number() }),
  handler: async (ctx, args) => {
    return await cleanupOrphanedSubThreadsHandler(
      ctx,
      args.parentThreadId,
      args.subThreadIds,
    );
  },
});

// ---------------------------------------------------------------------------
// REST API helpers
// ---------------------------------------------------------------------------

export const createChatThreadInternal = internalMutation({
  args: {
    userId: v.string(),
    title: v.optional(v.string()),
    /**
     * Required for REST callers so the inserted threadMetadata row
     * carries `organizationId`. Without it, `getThreadMetadata` rejects
     * the row on every subsequent read because `callerOrgId !== undefined
     * && row.organizationId !== callerOrgId` always fires when row.org
     * is undefined — the POST→GET round-trip silently 404s. Optional for
     * legacy callers; REST handlers MUST pass `rc.org.organizationId`.
     */
    organizationId: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await createHelper(
      ctx,
      args.userId,
      args.title,
      'general',
      undefined,
      undefined,
      args.organizationId,
    );
  },
});

export const updateChatThreadInternal = internalMutation({
  args: {
    threadId: v.string(),
    title: v.string(),
    callerUserId: v.optional(v.string()),
    callerOrgId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await gateThreadAccess(
      ctx,
      args.threadId,
      args.callerUserId,
      args.callerOrgId,
    );
    await updateHelper(ctx, args.threadId, args.title);
    return null;
  },
});

export const deleteChatThreadInternal = internalMutation({
  args: {
    threadId: v.string(),
    callerUserId: v.optional(v.string()),
    callerOrgId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await gateThreadAccess(
      ctx,
      args.threadId,
      args.callerUserId,
      args.callerOrgId,
    );
    await deleteHelper(ctx, args.threadId);
    return null;
  },
});

export const archiveChatThreadInternal = internalMutation({
  args: {
    threadId: v.string(),
    callerUserId: v.optional(v.string()),
    callerOrgId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await gateThreadAccess(
      ctx,
      args.threadId,
      args.callerUserId,
      args.callerOrgId,
    );
    await archiveHelper(ctx, args.threadId);
    return null;
  },
});

export const unarchiveChatThreadInternal = internalMutation({
  args: {
    threadId: v.string(),
    callerUserId: v.optional(v.string()),
    callerOrgId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await gateThreadAccess(
      ctx,
      args.threadId,
      args.callerUserId,
      args.callerOrgId,
    );
    await unarchiveHelper(ctx, args.threadId);
    return null;
  },
});
