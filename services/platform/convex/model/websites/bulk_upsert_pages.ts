/**
 * Bulk upsert website pages (create or update)
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { BulkUpsertPagesArgs, BulkUpsertPagesResult } from './types';

export type { BulkUpsertPagesArgs, BulkUpsertPagesResult };

/**
 * Bulk upsert website pages
 * - Creates new pages if they don't exist
 * - Updates existing pages if they do exist (based on URL)
 */
export async function bulkUpsertPages(
  ctx: MutationCtx,
  args: BulkUpsertPagesArgs,
): Promise<BulkUpsertPagesResult> {
  const result: BulkUpsertPagesResult = {
    created: 0,
    updated: 0,
    total: args.pages.length,
  };

  const now = Date.now();

  for (const page of args.pages) {
    // Check if page already exists
    const existingPage = await ctx.db
      .query('websitePages')
      .withIndex('by_organizationId_and_url', (q) =>
        q.eq('organizationId', args.organizationId).eq('url', page.url),
      )
      .first();

    if (existingPage) {
      // Update existing page
      await ctx.db.patch(existingPage._id, {
        title: page.title,
        content: page.content,
        wordCount: page.wordCount,
        lastCrawledAt: now,
        metadata: page.metadata,
        structuredData: page.structuredData,
      });
      result.updated++;
    } else {
      // Create new page
      await ctx.db.insert('websitePages', {
        organizationId: args.organizationId,
        websiteId: args.websiteId as Id<'websites'>,
        url: page.url,
        title: page.title,
        content: page.content,
        wordCount: page.wordCount,
        lastCrawledAt: now,
        metadata: page.metadata,
        structuredData: page.structuredData,
      });
      result.created++;
    }
  }

  return result;
}

