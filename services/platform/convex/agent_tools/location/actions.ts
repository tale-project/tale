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
      internal.approvals.internal_queries.getApprovalContext,
      { approvalId: args.approvalId },
    );

    // Verify user belongs to the approval's organization
    await ctx.runQuery(
      internal.approvals.internal_queries.verifyOrganizationMembership,
      {
        organizationId: approvalInfo.organizationId,
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      },
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
      } catch (error) {
        console.warn(
          `Agent config resolution failed for ${approvalInfo.agentSlug}, using default`,
          error,
        );
      }
    }

    return ctx.runMutation(
      internal.agent_tools.location.mutations.submitLocationResponseInternal,
      {
        approvalId: args.approvalId,
        location: args.location,
        denied: args.denied,
        respondedBy: authUser.email ?? String(authUser._id),
        approvedBy: String(authUser._id),
        agentConfig: resolvedAgentConfig,
      },
    );
  },
});
