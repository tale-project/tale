import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';

export const removeDeletedWorkflowBindings = internalMutation({
  args: {
    organizationId: v.string(),
    workflowRootId: v.id('wfDefinitions'),
  },
  handler: async (ctx, { organizationId, workflowRootId }) => {
    for await (const agent of ctx.db
      .query('customAgents')
      .withIndex('by_organization', (q) =>
        q.eq('organizationId', organizationId),
      )) {
      if (!agent.workflowBindings?.includes(workflowRootId)) continue;

      const filtered = agent.workflowBindings.filter(
        (id) => id !== workflowRootId,
      );

      await ctx.db.patch(agent._id, {
        workflowBindings: filtered.length ? filtered : undefined,
      });
    }
  },
});
