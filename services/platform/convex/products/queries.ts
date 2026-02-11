import { v } from 'convex/values';

import { queryWithRLS } from '../lib/rls';
import { productDocValidator } from './validators';

export const listProducts = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(productDocValidator),
  handler: async (ctx, args) => {
    const results = [];
    for await (const product of ctx.db
      .query('products')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      results.push(product);
    }
    return results;
  },
});
