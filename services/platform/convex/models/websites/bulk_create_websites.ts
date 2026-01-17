/**
 * Bulk create websites
 */

import type { MutationCtx } from '../../_generated/server';
import type { BulkCreateWebsitesResult, BulkWebsiteData } from './types';

export interface BulkCreateWebsitesArgs {
  organizationId: string;
  websites: BulkWebsiteData[];
}

/**
 * Bulk create websites
 */
export async function bulkCreateWebsites(
  ctx: MutationCtx,
  args: BulkCreateWebsitesArgs,
): Promise<BulkCreateWebsitesResult> {
  const results: BulkCreateWebsitesResult = {
    success: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < args.websites.length; i++) {
    const websiteData = args.websites[i];

    try {
      const ensureUrl = (s: string) =>
        s.startsWith('http://') || s.startsWith('https://')
          ? s
          : `https://${s}`;
      const normalized = new URL(ensureUrl(websiteData.domain)).hostname;

      // Check for duplicates (normalized)
      const existing = await ctx.db
        .query('websites')
        .withIndex('by_organizationId_and_domain', (q) =>
          q.eq('organizationId', args.organizationId).eq('domain', normalized),
        )
        .first();

      if (existing) {
        throw new Error(`Website with domain ${normalized} already exists`);
      }

      await ctx.db.insert('websites', {
        organizationId: args.organizationId,
        ...websiteData,
        domain: normalized,
      });

      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        index: i,
        error: error instanceof Error ? error.message : 'Unknown error',
        website: websiteData,
      });
    }
  }

  return results;
}
