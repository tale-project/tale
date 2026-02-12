import { v } from 'convex/values';

import { queryWithRLS } from '../lib/rls';

export const listVendors = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const results = [];
    for await (const vendor of ctx.db
      .query('vendors')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      results.push(vendor);
    }
    return results;
  },
});
