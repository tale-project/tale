/**
 * Get a single integration by ID
 */

import { QueryCtx } from '../../_generated/server';
import { Doc, Id } from '../../_generated/dataModel';

export async function getIntegration(
  ctx: QueryCtx,
  integrationId: Id<'integrations'>,
): Promise<Doc<'integrations'> | null> {
  return await ctx.db.get(integrationId);
}

