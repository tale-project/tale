/**
 * Check organization membership
 */

import type { QueryCtx } from '../_generated/server';
import type { CheckMembershipArgs, MembershipResult } from './types';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';

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

  const memberRaw = result.page[0];
  const member = isRecord(memberRaw) ? memberRaw : undefined;
  const memberId = member ? getString(member, '_id') : undefined;
  const memberOrgId = member ? getString(member, 'organizationId') : undefined;
  const memberUserId = member ? getString(member, 'userId') : undefined;
  const memberRole = member ? getString(member, 'role') : undefined;

  if (!memberId || !memberOrgId || !memberUserId || !memberRole) {
    return null;
  }

  return {
    _id: memberId,
    organizationId: memberOrgId,
    identityId: memberUserId,
    role: memberRole,
  };
}
