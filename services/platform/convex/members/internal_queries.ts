import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalQuery } from '../_generated/server';
import type { BetterAuthFindManyResult, BetterAuthMember } from './types';

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

/**
 * A member's role read from the local `memberMirror` (the hot-path membership
 * cache), on a raw ctx. Exists so an RLS-wrapped mutation — whose `ctx.db`
 * cannot read `memberMirror` (it's filtered) — can still resolve the caller's
 * role via `ctx.runQuery`. Returns null on a mirror miss.
 */
export const getMirrorMemberRole = internalQuery({
  args: {
    userId: v.string(),
    organizationId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('memberMirror')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', args.organizationId).eq('userId', args.userId),
      )
      .first();
    return row?.role ?? null;
  },
});
