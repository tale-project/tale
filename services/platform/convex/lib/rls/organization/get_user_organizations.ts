/**
 * Get all organizations user has access to from Better Auth
 */

import type { QueryCtx } from '../../../_generated/server';
import type { AuthenticatedUser, OrganizationMember } from '../types';
import { requireAuthenticatedUser } from '../auth/require_authenticated_user';
import { components } from '../../../_generated/api';

/**
 * Get all organizations user has access to from Better Auth's member table
 */
export async function getUserOrganizations(
  ctx: QueryCtx,
  user?: AuthenticatedUser,
): Promise<
  Array<{
    organizationId: string;
    role: 'disabled' | 'member' | 'editor' | 'developer' | 'admin';
    member: OrganizationMember;
  }>
> {
  const authUser = user || (await requireAuthenticatedUser(ctx));

  // Query Better Auth's member table for all memberships
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: {
      cursor: null,
      numItems: 100, // Reasonable limit for user's organizations
    },
    where: [
      {
        field: 'userId',
        value: authUser.userId ?? null,
        operator: 'eq',
      },
    ],
  });

  if (!result || result.page.length === 0) {
    return [];
  }

  return result.page.map((member: any) => ({
    organizationId: member.organizationId,
    role: (member.role || 'member').toLowerCase(),
    member,
  }));
}
