/**
 * Get organization member for authenticated user from Better Auth
 */

import type { QueryCtx, MutationCtx } from '../../../_generated/server';
import type { AuthenticatedUser, OrganizationMember } from '../types';
import { UnauthorizedError } from '../errors';
import { requireAuthenticatedUser } from '../auth/require_authenticated_user';
import { components } from '../../../_generated/api';

/**
 * Get organization member for authenticated user from Better Auth's member table
 */
export async function getOrganizationMember(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  user?: AuthenticatedUser,
): Promise<OrganizationMember> {
  const authUser = user || (await requireAuthenticatedUser(ctx));

  // Query Better Auth's member table
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: {
      cursor: null,
      numItems: 1,
    },
    where: [
      {
        field: 'organizationId',
        value: organizationId,
        operator: 'eq',
      },
      {
        field: 'userId',
        value: authUser.userId,
        operator: 'eq',
      },
    ],
  });

  if (!result || result.page.length === 0) {
    throw new UnauthorizedError(
      `Not a member of organization ${organizationId}`,
    );
  }

  return result.page[0];
}
