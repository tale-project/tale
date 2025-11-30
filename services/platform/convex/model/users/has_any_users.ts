/**
 * Check if any users exist in the system
 */

import { QueryCtx } from '../../_generated/server';
import { components } from '../../_generated/api';

/**
 * Check if any users exist in the Better Auth user table.
 * Used to determine if this is a fresh installation that should redirect to sign-up.
 */
export async function hasAnyUsers(ctx: QueryCtx): Promise<boolean> {
  // Query Better Auth's user table to check if any users exist
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'user',
    paginationOpts: {
      cursor: null,
      numItems: 1,
    },
    where: [],
  });

  return result && result.page.length > 0;
}

