/**
 * Fork and Chat — fork a shared thread and send the first message.
 *
 * When a receiver of a shared chat sends their first message, we:
 * 1. Fork the shared thread (snapshot messages only)
 * 2. Resolve agent config
 * 3. Start chat on the forked thread with the user's message
 */

import { v } from 'convex/values';

import { api, internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';

export const forkAndChat = action({
  args: {
    shareToken: v.string(),
    message: v.string(),
    agentSlug: v.string(),
    orgSlug: v.string(),
    organizationId: v.string(),
    modelId: v.optional(v.string()),
    userContext: v.optional(
      v.object({
        timezone: v.string(),
        language: v.string(),
      }),
    ),
  },
  returns: v.object({
    threadId: v.string(),
    streamId: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; streamId: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const userId = String(authUser._id);

    // Fork the shared thread (creates new thread with snapshot messages)
    const newThreadId = await ctx.runMutation(
      api.threads.mutations.forkThread,
      { shareToken: args.shareToken },
    );

    // Resolve agent config (requires Node runtime)
    const agentConfig = await ctx.runAction(
      internal.agents.file_actions.resolveAgentConfig,
      {
        orgSlug: args.orgSlug,
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
        modelId: args.modelId,
      },
    );

    // Start agent generation on the forked thread with the user's first message
    const { streamId } = await ctx.runMutation(
      internal.agents.start_chat.startChat,
      {
        threadId: newThreadId,
        organizationId: args.organizationId,
        userId,
        userEmail: authUser.email,
        userName: authUser.name,
        message: args.message,
        userContext: args.userContext,
        agentConfig,
        agentSlug: args.agentSlug,
      },
    );

    return { threadId: newThreadId, streamId };
  },
});
