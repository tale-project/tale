import { v } from 'convex/values';

import { internalMutation, type MutationCtx } from '../_generated/server';
import { recordOutcome } from '../lib/agent_response/reasoning/controller';
import { getAuthUserIdentity } from '../lib/rls';
import { assertThreadAccess } from '../lib/rls/auth/can_access_thread';
import { persistentStreaming } from '../streaming/helpers';
import {
  archiveChatThread as archiveHelper,
  unarchiveChatThread as unarchiveHelper,
} from './archive_chat_thread';
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
    difficultyClass: v.union(
      v.literal('easy'),
      v.literal('medium'),
      v.literal('hard'),
    ),
    budgetTokens: v.number(),
    selfTruncates: v.boolean(),
    reasoningTokens: v.optional(v.number()),
    finishReason: v.optional(v.string()),
    retried: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    if (!row) return null;
    const next = recordOutcome(row.reasoningState, {
      difficultyClass: args.difficultyClass,
      reasoningTokens: args.reasoningTokens,
      budgetTokens: args.budgetTokens,
      selfTruncates: args.selfTruncates,
      finishReason: args.finishReason,
      retried: args.retried,
    });
    await ctx.db.patch(row._id, { reasoningState: next });
    return null;
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
    difficultyClass: v.union(
      v.literal('easy'),
      v.literal('medium'),
      v.literal('hard'),
    ),
    budgetTokens: v.number(),
    selfTruncates: v.boolean(),
    reasoningTokens: v.optional(v.number()),
    finishReason: v.optional(v.string()),
    retried: v.optional(v.boolean()),
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
    const next = recordOutcome(row?.state, {
      difficultyClass: args.difficultyClass,
      reasoningTokens: args.reasoningTokens,
      budgetTokens: args.budgetTokens,
      selfTruncates: args.selfTruncates,
      finishReason: args.finishReason,
      retried: args.retried,
    });
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

    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
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

    const streamId = await persistentStreaming.createStream(ctx);
    await ctx.db.patch(meta._id, {
      generationStatus: 'generating' as const,
      streamId,
      generationStartTime: Date.now(),
      updatedAt: Date.now(),
      cancelledAt: undefined,
      cancelledMessageId: undefined,
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
    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    // Only clear if the streamId matches — prevents a stale action from
    // clearing a newer generation's 'generating' status.
    if (meta && meta.streamId === args.streamId) {
      await ctx.db.patch(meta._id, {
        generationStatus: 'idle',
        streamId: undefined,
      });
    }
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
