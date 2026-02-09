/**
 * Bulk upsert website pages (create or update)
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
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
  const now = Date.now();

  // Batch query all existing pages in parallel
  const existingPages = await Promise.all(
    args.pages.map((page) =>
      ctx.db
        .query('websitePages')
        .withIndex('by_organizationId_and_url', (q) =>
          q.eq('organizationId', args.organizationId).eq('url', page.url),
        )
        .unique(),
    ),
  );

  // Build a map of URL -> existing page ID
  const existingPageMap = new Map<string, Id<'websitePages'>>();
  for (let i = 0; i < args.pages.length; i++) {
    const existing = existingPages[i];
    if (existing) {
      existingPageMap.set(args.pages[i].url, existing._id);
    }
  }

  // Separate pages into updates and inserts
  const updates: Array<{
    id: Id<'websitePages'>;
    page: (typeof args.pages)[0];
  }> = [];
  const inserts: Array<(typeof args.pages)[0]> = [];

  for (const page of args.pages) {
    const existingId = existingPageMap.get(page.url);
    if (existingId) {
      updates.push({ id: existingId, page });
    } else {
      inserts.push(page);
    }
  }

  // Execute updates and inserts in parallel
  await Promise.all([
    // Batch updates
    ...updates.map(({ id, page }) =>
      ctx.db.patch(id, {
        title: page.title,
        content: page.content,
        wordCount: page.wordCount,
        lastCrawledAt: now,
        metadata: page.metadata,
        structuredData: page.structuredData,
      }),
    ),
    // Batch inserts
    ...inserts.map((page) =>
      ctx.db.insert('websitePages', {
        organizationId: args.organizationId,
        websiteId: args.websiteId as Id<'websites'>,
        url: page.url,
        title: page.title,
        content: page.content,
        wordCount: page.wordCount,
        lastCrawledAt: now,
        metadata: page.metadata,
        structuredData: page.structuredData,
      }),
    ),
  ]);

  return {
    created: inserts.length,
    updated: updates.length,
    total: args.pages.length,
  };
}
