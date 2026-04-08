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

const DEFAULT_ORG_SLUG = 'default';

export const triggerCompletionWithAgent = internalAction({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    agentSlug: v.string(),
    messageContent: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const agentConfig = await ctx.runAction(
      internal.agents.file_actions.resolveAgentConfig,
      {
        orgSlug: DEFAULT_ORG_SLUG,
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
  },
});
