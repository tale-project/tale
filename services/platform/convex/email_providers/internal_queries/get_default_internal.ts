/**
 * Internal query to get default email provider for an organization
 */

import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';

export const getDefaultInternal = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('emailProviders')
      .withIndex('by_organizationId_and_isDefault', (q) =>
        q.eq('organizationId', args.organizationId).eq('isDefault', true),
      )
      .first();
  },
});
