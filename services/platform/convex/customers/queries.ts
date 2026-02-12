import { v } from 'convex/values';

import { queryWithRLS } from '../lib/rls';
import { customerValidator } from './validators';

export const listCustomers = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(customerValidator),
  handler: async (ctx, args) => {
    const results = [];
    for await (const customer of ctx.db
      .query('customers')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      results.push(customer);
    }
    return results;
  },
});
