/**
 * Check if any organizations exist in the Better Auth `organization` table.
 *
 * Used by the dashboard to decide whether to auto-create the seeded
 * `default` org (fresh-instance case) or redirect the user to the
 * create-organization form (multi-org instance with an uninvited user).
 *
 * Performance: numItems=1 short-circuits — we only need existence.
 */

import { components } from '../_generated/api';
import { QueryCtx } from '../_generated/server';

export async function hasAnyOrganization(ctx: QueryCtx): Promise<boolean> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'organization',
    paginationOpts: {
      cursor: null,
      numItems: 1,
    },
    where: [],
  });

  return result && result.page.length > 0;
}
