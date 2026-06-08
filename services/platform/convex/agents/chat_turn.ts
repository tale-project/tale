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

import { composerProfilesValidator } from '../../lib/shared/composer-profiles';
import { AUTO_AGENT_SLUG } from '../../lib/shared/constants/agents';
import { internal } from '../_generated/api';
import { mutation } from '../_generated/server';
import { userContextValidator } from '../lib/agent_response/validators';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { persistentStreaming } from '../streaming/helpers';
import { cancelGeneration } from '../threads/cancel_generation';

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
    composerProfiles: v.optional(composerProfilesValidator),
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
      ...(isAuto ? {} : { agentSlug: args.agentSlug }),
    });

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
        composerProfiles: args.composerProfiles,
        threadId: args.threadId,
        streamId,
        userId: authUser.userId,
        userEmail: authUser.email ?? '',
        userName: authUser.name ?? '',
        requestStartMs,
        arenaBranchThreadId: args.arenaBranchThreadId,
      },
    );

    // The client subscribes to the stream by threadId and ignores this return;
    // dedup is decided in the node action (saveMessage), so report false here.
    return { messageAlreadyExists: false, streamId };
  },
});
