/**
 * Arena Chat Action
 *
 * Sends the same message to two different models in parallel for A/B comparison.
 * Each model gets its own thread to avoid contamination.
 */

import { v } from 'convex/values';

import { api, internal } from '../_generated/api';
import { action } from '../_generated/server';
import { userContextValidator } from '../lib/agent_response/validators';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

export const arenaChat = action({
  args: {
    agentSlug: v.string(),
    organizationId: v.string(),
    threadIdA: v.string(),
    threadIdB: v.string(),
    message: v.string(),
    modelIdA: v.string(),
    modelIdB: v.string(),
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
    userContext: v.optional(userContextValidator),
    copyHistoryToB: v.optional(v.boolean()),
  },
  returns: v.object({
    streamIdA: v.string(),
    streamIdB: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ streamIdA: string; streamIdB: string }> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    // Copy message history from Thread A to Thread B if requested
    // (when arena is enabled on an existing thread with conversation history)
    if (args.copyHistoryToB) {
      await ctx.runMutation(internal.threads.mutations.copyThreadMessages, {
        sourceThreadId: args.threadIdA,
        targetThreadId: args.threadIdB,
        userId: authUser.userId,
      });
    }

    const sharedArgs = {
      agentSlug: args.agentSlug,
      organizationId: args.organizationId,
      message: args.message,
      attachments: args.attachments,
      userContext: args.userContext,
    };

    console.log(
      `[arenaChat] START threadIdA=${args.threadIdA} threadIdB=${args.threadIdB} modelA=${args.modelIdA} modelB=${args.modelIdB}`,
    );
    const [resultA, resultB] = await Promise.all([
      // Thread A is the arena root: pass threadIdB so the A↔B branch link is
      // created from A's node action AFTER its user message is saved. Creating
      // it here (eagerly) raced the now-async save and threw on the first turn.
      ctx.runMutation(api.agents.chat_turn.chatWithAgentTurn, {
        ...sharedArgs,
        threadId: args.threadIdA,
        modelId: args.modelIdA,
        arenaBranchThreadId: args.threadIdB,
      }),
      ctx.runMutation(api.agents.chat_turn.chatWithAgentTurn, {
        ...sharedArgs,
        threadId: args.threadIdB,
        modelId: args.modelIdB,
      }),
    ]);
    console.log(
      `[arenaChat] DONE streamIdA=${resultA.streamId} streamIdB=${resultB.streamId}`,
    );

    return {
      streamIdA: resultA.streamId,
      streamIdB: resultB.streamId,
    };
  },
});
