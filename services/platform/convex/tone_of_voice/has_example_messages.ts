/**
 * Check if any example messages exist for an organization
 */

import { QueryCtx } from '../_generated/server';

export async function hasExampleMessages(
  ctx: QueryCtx,
  args: {
    organizationId: string;
  },
): Promise<boolean> {
  const example = await ctx.db
    .query('exampleMessages')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .first();
  return example !== null;
}
