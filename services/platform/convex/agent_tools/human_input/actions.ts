'use node';

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { action } from '../../_generated/server';
import type { SerializableAgentConfig } from '../../lib/agent_chat/types';
import { getAuthUserIdentity } from '../../lib/rls/auth/get_auth_user_identity';

interface SubmitHumanInputResult {
  success: boolean;
  threadId?: string;
  streamId?: string;
}

/**
 * Shared auth + agent-config resolution for the submit and edit variants.
 * Returns the args for the internal mutation call.
 */
async function authorizeAndResolveConfig(
  ctx: ActionCtx,
  args: { approvalId: Id<'approvals'>; modelId?: string },
): Promise<{
  respondedBy: string;
  approvedBy: string;
  agentConfig?: SerializableAgentConfig;
}> {
  const authUser = await getAuthUserIdentity(ctx);
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
      userId: authUser.userId,
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

  return {
    respondedBy: authUser.email ?? authUser.userId,
    approvedBy: authUser.userId,
    agentConfig: resolvedAgentConfig,
  };
}

export const submitHumanInputResponse = action({
  args: {
    approvalId: v.id('approvals'),
    response: v.union(v.string(), v.array(v.string())),
    modelId: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    threadId: v.optional(v.string()),
    streamId: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<SubmitHumanInputResult> => {
    const resolved = await authorizeAndResolveConfig(ctx, args);
    return ctx.runMutation(
      internal.agent_tools.human_input.mutations
        .submitHumanInputResponseInternal,
      {
        approvalId: args.approvalId,
        response: args.response,
        ...resolved,
      },
    );
  },
});

/**
 * Edit an already-completed human-input response (chat context only): stores
 * the corrected answer and re-triggers generation so the agent reconsiders.
 */
export const editHumanInputResponse = action({
  args: {
    approvalId: v.id('approvals'),
    response: v.union(v.string(), v.array(v.string())),
    modelId: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    threadId: v.optional(v.string()),
    streamId: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<SubmitHumanInputResult> => {
    const resolved = await authorizeAndResolveConfig(ctx, args);
    return ctx.runMutation(
      internal.agent_tools.human_input.mutations.editHumanInputResponseInternal,
      {
        approvalId: args.approvalId,
        response: args.response,
        ...resolved,
      },
    );
  },
});
