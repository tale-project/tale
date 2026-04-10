/**
 * Arena Chat Action
 *
 * Sends the same message to two different models in parallel for A/B comparison.
 * Each model gets its own thread to avoid contamination.
 */

import { v } from 'convex/values';

import { api, internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';

export const arenaChat = action({
  args: {
    agentSlug: v.string(),
    organizationId: v.string(),
    orgSlug: v.string(),
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
    userContext: v.optional(
      v.object({
        timezone: v.string(),
        language: v.string(),
      }),
    ),
  },
  returns: v.object({
    streamIdA: v.string(),
    streamIdB: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ streamIdA: string; streamIdB: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const sharedArgs = {
      agentSlug: args.agentSlug,
      organizationId: args.organizationId,
      orgSlug: args.orgSlug,
      message: args.message,
      attachments: args.attachments,
      userContext: args.userContext,
    };

    const [resultA, resultB] = await Promise.all([
      ctx.runAction(api.agents.unified_chat.chatWithAgent, {
        ...sharedArgs,
        threadId: args.threadIdA,
        modelId: args.modelIdA,
      }),
      ctx.runAction(api.agents.unified_chat.chatWithAgent, {
        ...sharedArgs,
        threadId: args.threadIdB,
        modelId: args.modelIdB,
      }),
    ]);

    // Create branch link so thread B appears as a branch of thread A
    await ctx.runMutation(internal.threads.mutations.createArenaBranchLink, {
      rootThreadId: args.threadIdA,
      branchThreadId: args.threadIdB,
    });

    return {
      streamIdA: resultA.streamId,
      streamIdB: resultB.streamId,
    };
  },
});
