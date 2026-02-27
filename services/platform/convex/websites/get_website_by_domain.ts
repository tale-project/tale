/**
 * Get a website by domain within an organization
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

import { ensureUrl } from './create_website';

export interface GetWebsiteByDomainArgs {
  organizationId: string;
  domain: string;
}

/**
 * Get a website by domain within an organization
 */
export async function getWebsiteByDomain(
  ctx: QueryCtx,
  args: GetWebsiteByDomainArgs,
): Promise<Doc<'websites'> | null> {
  const host = new URL(ensureUrl(args.domain)).hostname;

  // Try normalized hostname first
  let website = await ctx.db
    .query('websites')
    .withIndex('by_organizationId_and_domain', (q) =>
      q.eq('organizationId', args.organizationId).eq('domain', host),
    )
    .first();
  if (website) return website;

  // Fallbacks for legacy data that stored the full URL in the domain field
  const candidates = [
    `https://${host}`,
    `https://${host}/`,
    `http://${host}`,
    `http://${host}/`,
  ];
  for (const cand of candidates) {
    website = await ctx.db
      .query('websites')
      .withIndex('by_organizationId_and_domain', (q) =>
        q.eq('organizationId', args.organizationId).eq('domain', cand),
      )
      .first();
    if (website) return website;
  }

  return null;
}
