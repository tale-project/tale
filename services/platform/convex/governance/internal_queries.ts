import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';

export const getPiiConfigInternal = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query('governancePolicies')
      .withIndex('by_org_and_type', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('policyType', 'pii_config'),
      )
      .first();
  },
});
