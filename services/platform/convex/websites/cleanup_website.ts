/**
 * Batch cleanup of website pages and their embeddings.
 *
 * Queries pages by websiteId, deletes their embeddings from all 7 dimension
 * tables, then deletes the page records. Returns { hasMore } so the caller
 * can self-reschedule for the next batch.
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

const PAGE_BATCH_SIZE = 20;

const EMBEDDING_TABLES = [
  'websitePageEmbeddings256',
  'websitePageEmbeddings512',
  'websitePageEmbeddings1024',
  'websitePageEmbeddings1536',
  'websitePageEmbeddings2048',
  'websitePageEmbeddings2560',
  'websitePageEmbeddings4096',
] as const;

export async function cleanupWebsitePagesBatch(
  ctx: MutationCtx,
  websiteId: Id<'websites'>,
): Promise<{ hasMore: boolean }> {
  let processedCount = 0;

  for await (const page of ctx.db
    .query('websitePages')
    .withIndex('by_websiteId', (q) => q.eq('websiteId', websiteId))) {
    for (const table of EMBEDDING_TABLES) {
      for await (const embedding of ctx.db
        .query(table)
        .withIndex('by_pageId', (q) => q.eq('pageId', page._id))) {
        await ctx.db.delete(embedding._id);
      }
    }

    await ctx.db.delete(page._id);
    processedCount++;

    if (processedCount >= PAGE_BATCH_SIZE) {
      return { hasMore: true };
    }
  }

  return { hasMore: false };
}
