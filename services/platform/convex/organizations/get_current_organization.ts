/**
 * Get the current user's organization
 */

import type { QueryCtx } from '../_generated/server';
import { authComponent } from '../../auth';
import { components } from '../_generated/api';

/**
 * Resolve the current user's organization.
 *
 * Preference order:
 * 1. Active organization from the Better Auth session (activeOrganizationId)
 * 2. Fallback to the first organization membership from the member table
 */
export async function getCurrentOrganization(
  ctx: QueryCtx,
): Promise<string | null> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    return null;
  }

  // Try to use the active organization from the current session if available
  const sessionResult = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'session',
      paginationOpts: {
        cursor: null,
        numItems: 1,
      },
      where: [
        {
          field: 'userId',
          value: String(authUser._id),
          operator: 'eq',
        },
      ],
    },
  );

  if (sessionResult && sessionResult.page.length > 0) {
    const activeOrgId = sessionResult.page[0].activeOrganizationId;
    if (activeOrgId) {
      return activeOrgId;
    }
  }

  // Fallback: If no active organization is set in the session,
  // return the user's first organization membership
  const memberResult = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        {
          field: 'userId',
          value: String(authUser._id),
          operator: 'eq',
        },
      ],
    },
  );

  if (!memberResult || memberResult.page.length === 0) {
    return null;
  }

  return memberResult.page[0].organizationId as string;
}
