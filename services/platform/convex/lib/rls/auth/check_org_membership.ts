import { components } from '../../../_generated/api';
import type { QueryCtx, MutationCtx } from '../../../_generated/server';

/**
 * Check whether a user is a member of a given organization.
 * Uses Better Auth's member table via the adapter query.
 * Returns true if a membership row exists and is not disabled, false otherwise.
 */
export async function isOrgMember(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  organizationId: string,
): Promise<boolean> {
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
        value: userId,
        operator: 'eq',
      },
    ],
  });

  const member = result?.page?.[0];
  return member != null && member.role !== 'disabled';
}
