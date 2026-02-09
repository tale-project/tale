/**
 * Get a single integration by ID
 */

import { Doc, Id } from '../_generated/dataModel';
import { QueryCtx } from '../_generated/server';

export async function getIntegration(
  ctx: QueryCtx,
  integrationId: Id<'integrations'>,
): Promise<Doc<'integrations'> | null> {
  return await ctx.db.get(integrationId);
}
