/**
 * List all email providers for an organization
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';

export async function listProviders(
  ctx: QueryCtx,
  args: { organizationId: string },
): Promise<Array<Doc<'emailProviders'>>> {
  const providers = await ctx.db
    .query('emailProviders')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .collect();

  return providers;
}
