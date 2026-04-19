/**
 * Internal action for triggering workflow completion agent response.
 *
 * Delegates filesystem I/O to resolveAgentConfig, then passes the
 * resolved config to the transactional mutation that saves messages
 * and schedules generation.
 */

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { resolveOrgSlug } from '../../organizations/resolve_org_slug';

export const triggerCompletionWithAgent = internalAction({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    agentSlug: v.string(),
    messageContent: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const agentConfig = await ctx.runAction(
      internal.agents.file_actions.resolveAgentConfig,
      {
        orgSlug,
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
      },
    );

    await ctx.runMutation(
      internal.agent_tools.workflows.internal_mutations
        .triggerWorkflowCompletionResponse,
      {
        threadId: args.threadId,
        organizationId: args.organizationId,
        agentSlug: args.agentSlug,
        messageContent: args.messageContent,
        agentConfig,
      },
    );
  },
});
