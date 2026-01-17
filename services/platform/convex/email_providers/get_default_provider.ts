/**
 * Get the default email provider for an organization
 */

import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';

export async function getDefaultProvider(
  ctx: QueryCtx,
  args: { organizationId: string },
): Promise<Doc<'emailProviders'> | null> {
  const defaultProvider = await ctx.db
    .query('emailProviders')
    .withIndex('by_organizationId_and_isDefault', (q) =>
      q.eq('organizationId', args.organizationId).eq('isDefault', true),
    )
    .first();

  return defaultProvider;
}
