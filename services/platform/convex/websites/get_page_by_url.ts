/**
 * Get a single website page by URL within an organization
 */

import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';

export interface GetPageByUrlArgs {
  organizationId: string;
  url: string;
}

/**
 * Get a single website page by organizationId and URL.
 *
 * Uses the by_organizationId_and_url index on websitePages.
 */
export async function getPageByUrl(
  ctx: QueryCtx,
  args: GetPageByUrlArgs,
): Promise<Doc<'websitePages'> | null> {
  const page = await ctx.db
    .query('websitePages')
    .withIndex('by_organizationId_and_url', (q) =>
      q.eq('organizationId', args.organizationId).eq('url', args.url),
    )
    .unique();

  return page ?? null;
}
