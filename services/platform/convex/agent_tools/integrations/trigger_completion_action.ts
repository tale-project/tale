/**
 * Internal action for triggering agent response after integration operation completion.
 *
 * Follows the same pattern as workflow completion (trigger_completion_action.ts):
 * loads agent config via filesystem, then delegates to a mutation that saves
 * the system message and schedules agent generation.
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
    try {
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
        internal.agent_tools.integrations.internal_mutations
          .triggerIntegrationCompletionResponse,
        {
          threadId: args.threadId,
          organizationId: args.organizationId,
          agentSlug: args.agentSlug,
          messageContent: args.messageContent,
          agentConfig,
        },
      );
    } catch (error) {
      console.error(
        `[triggerCompletionWithAgent] Failed for agent "${args.agentSlug}":`,
        error instanceof Error ? error.message : error,
      );
      // Save error message to thread so the user knows something went wrong
      await ctx.runMutation(
        internal.agent_tools.integrations.internal_mutations.saveSystemMessage,
        {
          threadId: args.threadId,
          content: `[INTEGRATION_COMPLETION_ERROR] Failed to trigger agent response: ${error instanceof Error ? error.message : 'Unknown error'}. The integration operation may have completed but the agent could not be notified.`,
        },
      );
    }
  },
});
