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

  // Query Better Auth's member table by userId
  let result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
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

  let member = result?.page?.[0];

  // Fallback to email lookup if no direct match
  // This handles cases where the JWT userId doesn't match the stored userId
  if (!member && authUser.email) {
    const userRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: 'email', value: authUser.email, operator: 'eq' }],
    });
    const userByEmail = userRes?.page?.[0];
    if (userByEmail?._id) {
      result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          {
            field: 'organizationId',
            value: organizationId,
            operator: 'eq',
          },
          { field: 'userId', value: userByEmail._id, operator: 'eq' },
        ],
      });
      member = result?.page?.[0];
    }
  }

  if (!member) {
    throw new UnauthorizedError(
      `Not a member of organization ${organizationId}`,
    );
  }

  return member;
}
