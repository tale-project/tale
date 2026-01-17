/**
 * Get a single website by ID
 */

import type { QueryCtx } from '../_generated/server';
import type { Id, Doc } from '../_generated/dataModel';

/**
 * Get a single website by ID
 */
export async function getWebsite(
  ctx: QueryCtx,
  websiteId: Id<'websites'>,
): Promise<Doc<'websites'> | null> {
  return await ctx.db.get(websiteId);
}

