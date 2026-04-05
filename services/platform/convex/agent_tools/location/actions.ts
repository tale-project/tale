'use node';

import { v } from 'convex/values';

import type { SerializableAgentConfig } from '../../lib/agent_chat/types';

import { internal } from '../../_generated/api';
import { action } from '../../_generated/server';
import { authComponent } from '../../auth';

export const submitLocationResponse = action({
  args: {
    approvalId: v.id('approvals'),
    location: v.optional(v.string()),
    denied: v.optional(v.boolean()),
    modelId: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    threadId: v.optional(v.string()),
    streamId: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    threadId?: string;
    streamId?: string;
  }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    // Read approval to get threadId and organizationId
    const approvalInfo: {
      threadId: string;
      organizationId: string;
      agentSlug?: string;
    } = await ctx.runQuery(
      internal.agent_tools.location.queries.getApprovalContext,
      { approvalId: args.approvalId },
    );

    // Resolve the agent config from the thread's agent slug
    let resolvedAgentConfig: SerializableAgentConfig | undefined;
    if (approvalInfo.agentSlug) {
      try {
        resolvedAgentConfig = await ctx.runAction(
          internal.agents.file_actions.resolveAgentConfig,
          {
            orgSlug: 'default',
            agentSlug: approvalInfo.agentSlug,
            organizationId: approvalInfo.organizationId,
            modelId: args.modelId,
          },
        );
      } catch {
        // Agent may have been deleted — fall back to default config in the mutation
      }
    }

    return ctx.runMutation(
      internal.agent_tools.location.mutations.submitLocationResponseInternal,
      {
        approvalId: args.approvalId,
        location: args.location,
        denied: args.denied,
        userId: String(authUser._id),
        agentConfig: resolvedAgentConfig,
      },
    );
  },
});
