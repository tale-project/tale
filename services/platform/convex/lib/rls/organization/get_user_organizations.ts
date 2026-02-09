/**
 * Get all organizations user has access to from Better Auth
 */

import type { QueryCtx } from '../../../_generated/server';
import type { AuthenticatedUser, OrganizationMember } from '../types';

import { components } from '../../../_generated/api';
import { getTrustedAuthData } from '../auth/get_trusted_auth_data';
import { requireAuthenticatedUser } from '../auth/require_authenticated_user';

const VALID_ROLES = [
  'disabled',
  'member',
  'editor',
  'developer',
  'admin',
] as const;
type ValidRole = (typeof VALID_ROLES)[number];

function isValidRole(role: string): role is ValidRole {
  return VALID_ROLES.includes(role as ValidRole);
}

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

  return result.page.map((member: any) => {
    // Get role from trusted headers if available, otherwise from database
    const rawRole = trustedData?.trustedRole || member.role || 'member';
    const normalizedRole = rawRole.toLowerCase();
    const role: ValidRole = isValidRole(normalizedRole)
      ? normalizedRole
      : 'member';

    return {
      organizationId: member.organizationId,
      role,
      member,
    };
  });
}
