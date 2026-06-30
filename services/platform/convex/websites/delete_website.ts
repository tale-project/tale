/**
 * Delete a website record from the database.
 * Does NOT deregister from crawler — that's handled by the calling action.
 */

import { ConvexError } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export async function deleteWebsite(
  ctx: MutationCtx,
  websiteId: Id<'websites'>,
): Promise<string> {
  const website = await ctx.db.get(websiteId);
  if (!website) {
    throw new ConvexError({
      code: 'WEBSITE_NOT_FOUND',
      message: 'Website not found',
    });
  }

  const { domain } = website;
  await ctx.db.delete(websiteId);
  return domain;
}
