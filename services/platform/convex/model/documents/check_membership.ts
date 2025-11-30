/**
 * Check organization membership
 */

import type { QueryCtx } from '../../_generated/server';
import type { CheckMembershipArgs, MembershipResult } from './types';

import { components } from '../../_generated/api';

export async function checkMembership(
  ctx: QueryCtx,
  args: CheckMembershipArgs,
): Promise<MembershipResult | null> {
  // Query Better Auth's member table for membership
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [
      { field: 'organizationId', value: args.organizationId, operator: 'eq' },
      { field: 'userId', value: args.userId, operator: 'eq' },
    ],
  });

  if (!result || result.page.length === 0) {
    return null;
  }

  const member = result.page[0] as {
    _id: string;
    organizationId: string;
    userId: string;
    role: string;
  };

  return {
    _id: member._id,
    organizationId: member.organizationId,
    identityId: member.userId,
    role: member.role,
  };
}
