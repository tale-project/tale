/**
 * Public query to check if organization has automations
 */

import { v } from 'convex/values';
import { queryWithRLS } from '../../lib/rls';

export const hasAutomations = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const first = await ctx.db
      .query('wfDefinitions')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();

    return first !== null;
  },
});
