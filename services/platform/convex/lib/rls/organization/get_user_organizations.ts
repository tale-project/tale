/**
 * Get all organizations user has access to from Better Auth
 */

import type { QueryCtx } from '../../../_generated/server';
import type { AuthenticatedUser, OrganizationMember } from '../types';
import { requireAuthenticatedUser } from '../auth/require_authenticated_user';
import { getTrustedAuthData } from '../auth/get_trusted_auth_data';
import { components } from '../../../_generated/api';

/**
 * Get all organizations user has access to from Better Auth's member table.
 *
 * In trusted headers mode, the role comes from the JWT claims (trustedRole)
 * instead of the member.role field in the database.
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

  // Check if we're in trusted headers mode (role from JWT)
  const trustedData = await getTrustedAuthData(ctx);

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
    // Use JWT trustedRole if available (trusted headers mode),
    // otherwise fall back to member.role from database (normal auth mode)
    role: trustedData?.trustedRole || (member.role || 'member').toLowerCase(),
    member,
  }));
}
