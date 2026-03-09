/**
 * Get all organizations user has access to from Better Auth
 */

import type { MemberRole } from '../../../../lib/shared/schemas/organizations';
import type { QueryCtx } from '../../../_generated/server';
import type { AuthenticatedUser, OrganizationMember } from '../types';

import { components } from '../../../_generated/api';
import { getTrustedAuthData } from '../auth/get_trusted_auth_data';
import { requireAuthenticatedUser } from '../auth/require_authenticated_user';

const VALID_ROLES: ReadonlySet<string> = new Set([
  'disabled',
  'member',
  'editor',
  'developer',
  'admin',
]);

function isValidRole(role: string): role is MemberRole {
  return VALID_ROLES.has(role);
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
    role: MemberRole;
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

  return result.page.map(
    (member: { organizationId: string; role?: string }) => {
      // Get role from trusted headers if available, otherwise from database
      const rawRole = trustedData?.trustedRole || member.role || 'member';
      const normalizedRole = rawRole.toLowerCase();
      const role: MemberRole = isValidRole(normalizedRole)
        ? normalizedRole
        : 'member';

      return {
        organizationId: member.organizationId,
        role,
        member,
      };
    },
  );
}
