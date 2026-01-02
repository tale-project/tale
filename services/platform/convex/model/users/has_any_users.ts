/**
 * Check if any users exist in the system
 */

import { QueryCtx } from '../../_generated/server';
import { components } from '../../_generated/api';

/**
 * Check if any users exist in the Better Auth user table.
 * Used to determine if this is a fresh installation that should redirect to sign-up.
 *
 * Performance: Uses numItems=1 for fast existence check.
 * This query should be cached on the client side to avoid repeated calls.
 */
export async function hasAnyUsers(ctx: QueryCtx): Promise<boolean> {
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

