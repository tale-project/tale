/**
 * List all integrations for an organization
 */

import { QueryCtx } from '../../_generated/server';
import { Doc } from '../../_generated/dataModel';

export interface ListIntegrationsArgs {
  organizationId: string;
  name?: string;
}

export async function listIntegrations(
  ctx: QueryCtx,
  args: ListIntegrationsArgs,
): Promise<Doc<'integrations'>[]> {
  // If name is provided, use the name index for efficient lookup
  if (args.name) {
    const integration = await ctx.db
      .query('integrations')
      .withIndex('by_organizationId_and_name', (q) =>
        q.eq('organizationId', args.organizationId).eq('name', args.name!),
      )
      .first();
    return integration ? [integration] : [];
  }

  // Otherwise, list all integrations for the organization
  return await ctx.db
    .query('integrations')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .collect();
}
