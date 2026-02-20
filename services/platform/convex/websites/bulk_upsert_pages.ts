/**
 * Bulk upsert website pages (create or update)
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { BulkUpsertPagesArgs, BulkUpsertPagesResult } from './types';

import { internal } from '../_generated/api';
import { toId } from '../lib/type_cast_helpers';

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

  // Build a map of URL -> existing page (ID + content for change detection)
  const existingPageMap = new Map<
    string,
    { id: Id<'websitePages'>; content?: string }
  >();
  for (let i = 0; i < args.pages.length; i++) {
    const existing = existingPages[i];
    if (existing) {
      existingPageMap.set(args.pages[i].url, {
        id: existing._id,
        content: existing.content,
      });
    }
  }

  // Separate pages into updates and inserts
  const updates: Array<{
    id: Id<'websitePages'>;
    page: (typeof args.pages)[0];
    contentChanged: boolean;
  }> = [];
  const inserts: Array<(typeof args.pages)[0]> = [];

  for (const page of args.pages) {
    const existing = existingPageMap.get(page.url);
    if (existing) {
      updates.push({
        id: existing.id,
        page,
        contentChanged: page.content !== existing.content,
      });
    } else {
      inserts.push(page);
    }
  }

  const websiteId = toId<'websites'>(args.websiteId);

  // Execute updates in parallel
  await Promise.all(
    updates.map(({ id, page }) =>
      ctx.db.patch(id, {
        title: page.title,
        content: page.content,
        wordCount: page.wordCount,
        lastCrawledAt: now,
        metadata: page.metadata,
        structuredData: page.structuredData,
      }),
    ),
  );

  // Execute inserts in parallel and collect new IDs
  const insertedIds = await Promise.all(
    inserts.map((page) =>
      ctx.db.insert('websitePages', {
        organizationId: args.organizationId,
        websiteId,
        url: page.url,
        title: page.title,
        content: page.content,
        wordCount: page.wordCount,
        lastCrawledAt: now,
        metadata: page.metadata,
        structuredData: page.structuredData,
      }),
    ),
  );

  // Update page count on the website when new pages are inserted
  if (inserts.length > 0) {
    const website = await ctx.db.get(websiteId);
    if (website) {
      await ctx.db.patch(websiteId, {
        pageCount: (website.pageCount ?? 0) + inserts.length,
      });
    }
  }

  // Schedule embedding generation for pages with content
  const embeddingsEnabled = !!process.env.EMBEDDING_DIMENSIONS;
  if (embeddingsEnabled) {
    const pageIdsToEmbed: Id<'websitePages'>[] = [];

    // Updated pages with changed content only
    for (const { id, page, contentChanged } of updates) {
      if (page.content && contentChanged) pageIdsToEmbed.push(id);
    }

    // Newly inserted pages with content
    for (let i = 0; i < inserts.length; i++) {
      if (inserts[i].content && insertedIds[i]) {
        pageIdsToEmbed.push(insertedIds[i]);
      }
    }

    for (const pageId of pageIdsToEmbed) {
      await ctx.scheduler.runAfter(
        0,
        internal.website_page_embeddings.internal_actions.generateForPage,
        {
          organizationId: args.organizationId,
          websiteId,
          pageId,
        },
      );
    }
  }

  return {
    created: inserts.length,
    updated: updates.length,
    total: args.pages.length,
  };
}
