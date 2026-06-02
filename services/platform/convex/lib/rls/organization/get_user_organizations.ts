/**
 * Get all organizations user has access to from Better Auth
 */

import type { MemberRole } from '../../../../lib/shared/schemas/organizations';
import { components } from '../../../_generated/api';
import type { QueryCtx } from '../../../_generated/server';
import { getTrustedAuthData } from '../auth/get_trusted_auth_data';
import { requireAuthenticatedUser } from '../auth/require_authenticated_user';
import type { AuthenticatedUser, OrganizationMember } from '../types';

const VALID_ROLES: ReadonlySet<string> = new Set([
  'owner',
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

  // Query Better Auth's member table for ALL memberships, paginating until the
  // adapter reports done. The previous single 100-item page silently dropped
  // the tail for users in >100 orgs (and could strand the org switcher); most
  // users fit in one page, so the common case is still a single round-trip.
  const memberRows: OrganizationMember[] = [];
  let cursor: string | null = null;
  for (;;) {
    // Explicit type breaks the otherwise-circular inference (result depends on
    // `cursor`, which is reassigned from `result.continueCursor`).
    const result: {
      page: OrganizationMember[];
      isDone?: boolean;
      continueCursor?: string;
    } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor, numItems: 100 },
      where: [
        {
          field: 'userId',
          value: authUser.userId ?? null,
          operator: 'eq',
        },
      ],
    });
    if (!result || result.page.length === 0) break;
    memberRows.push(...result.page);
    // Stop on done, or if the cursor stops advancing (defensive against a
    // non-terminating adapter response).
    if (result.isDone || result.continueCursor === cursor) break;
    cursor = result.continueCursor ?? null;
  }

  if (memberRows.length === 0) {
    return [];
  }

  return memberRows
    .map((member) => {
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
    })
    .filter(
      (entry: { organizationId: string; role: string; member: unknown }) =>
        entry.role !== 'disabled',
    );
}
