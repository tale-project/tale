/**
 * Get integration by organization and name
 */

import { QueryCtx } from '../../_generated/server';
import { Doc } from '../../_generated/dataModel';

export interface GetIntegrationByNameArgs {
  organizationId: string;
  name: string;
}

export async function getIntegrationByName(
  ctx: QueryCtx,
  args: GetIntegrationByNameArgs,
): Promise<Doc<'integrations'> | null> {
  const integration = await ctx.db
    .query('integrations')
    .withIndex('by_organizationId_and_name', (q) =>
      q.eq('organizationId', args.organizationId).eq('name', args.name),
    )
    .first();

  return integration || null;
}
