import { v } from 'convex/values';

import type { BetterAuthFindManyResult, BetterAuthMember } from './types';

import { components } from '../_generated/api';
import { internalQuery } from '../_generated/server';

export const getMemberRole = internalQuery({
  args: {
    userId: v.string(),
    organizationId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const result: BetterAuthFindManyResult<BetterAuthMember> =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          {
            field: 'organizationId',
            value: args.organizationId,
            operator: 'eq',
          },
          { field: 'userId', value: args.userId, operator: 'eq' },
        ],
      });

    return result?.page?.[0]?.role ?? null;
  },
});
