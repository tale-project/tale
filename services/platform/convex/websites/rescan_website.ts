/**
 * Mark a website as rescanning and normalize its domain.
 * Does NOT call crawler — that's handled by the calling action.
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { toWebsiteDomain } from './create_website';

export interface RescanWebsiteResult {
  domain: string;
  scanInterval: string;
}

export async function rescanWebsite(
  ctx: MutationCtx,
  websiteId: Id<'websites'>,
): Promise<RescanWebsiteResult> {
  const website = await ctx.db.get(websiteId);
  if (!website) {
    throw new Error('Website not found');
  }

  const normalizedDomain = toWebsiteDomain(website.domain);

  // If stored domain includes protocol/path, normalize it when safe (no conflict)
  if (normalizedDomain !== website.domain) {
    const conflict = await ctx.db
      .query('websites')
      .withIndex('by_organizationId_and_domain', (q) =>
        q
          .eq('organizationId', website.organizationId)
          .eq('domain', normalizedDomain),
      )
      .first();
    if (!conflict) {
      await ctx.db.patch(websiteId, { domain: normalizedDomain });
    }
  }

  // Optimistically update the last scanned timestamp/status
  await ctx.db.patch(websiteId, {
    lastScannedAt: Date.now(),
    status: 'active',
  });

  return {
    domain: normalizedDomain,
    scanInterval: website.scanInterval,
  };
}
