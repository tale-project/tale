import type { MutationCtx } from '../_generated/server';

import { toId } from '../lib/type_cast_helpers';

const EMBEDDING_TABLES = [
  'websitePageEmbeddings256',
  'websitePageEmbeddings512',
  'websitePageEmbeddings1024',
  'websitePageEmbeddings1536',
  'websitePageEmbeddings2048',
  'websitePageEmbeddings2560',
  'websitePageEmbeddings4096',
] as const;

export interface DiscoveredUrlEntry {
  url: string;
  contentHash?: string;
  status?: string;
}

export interface RegisterDiscoveredUrlsArgs {
  organizationId: string;
  websiteId: string;
  urls: DiscoveredUrlEntry[];
}

export interface RegisterDiscoveredUrlsResult {
  registered: number;
  updated: number;
  deleted: number;
  skipped: number;
  total: number;
  urlsToSync: string[];
}

export async function registerDiscoveredUrls(
  ctx: MutationCtx,
  args: RegisterDiscoveredUrlsArgs,
): Promise<RegisterDiscoveredUrlsResult> {
  const now = Date.now();
  const websiteId = toId<'websites'>(args.websiteId);
  let registered = 0;
  let updated = 0;
  let deleted = 0;
  let skipped = 0;
  const urlsToSync: string[] = [];

  for (const entry of args.urls) {
    const existing = await ctx.db
      .query('websitePages')
      .withIndex('by_organizationId_and_url', (q) =>
        q.eq('organizationId', args.organizationId).eq('url', entry.url),
      )
      .first();

    // Handle deleted URLs — remove page + embeddings
    if (entry.status === 'deleted') {
      if (existing) {
        for (const table of EMBEDDING_TABLES) {
          for await (const embedding of ctx.db
            .query(table)
            .withIndex('by_pageId', (q) => q.eq('pageId', existing._id))) {
            await ctx.db.delete(embedding._id);
          }
        }
        await ctx.db.delete(existing._id);
        deleted++;
      }
      continue;
    }

    if (existing) {
      // Existing URL — check if hash changed
      if (entry.contentHash && entry.contentHash !== existing.contentHash) {
        await ctx.db.patch(existing._id, {
          contentHash: entry.contentHash,
          syncStatus: 'pending',
        });
        updated++;
        urlsToSync.push(entry.url);
      } else {
        skipped++;
      }
      continue;
    }

    // New URL — insert as pending
    await ctx.db.insert('websitePages', {
      organizationId: args.organizationId,
      websiteId,
      url: entry.url,
      contentHash: entry.contentHash,
      lastCrawledAt: now,
      syncStatus: 'pending',
    });
    registered++;
    urlsToSync.push(entry.url);
  }

  // Update page count: new pages added minus pages deleted
  const netChange = registered - deleted;
  if (netChange !== 0) {
    const website = await ctx.db.get(websiteId);
    if (website) {
      await ctx.db.patch(websiteId, {
        pageCount: Math.max(0, (website.pageCount ?? 0) + netChange),
      });
    }
  }

  return {
    registered,
    updated,
    deleted,
    skipped,
    total: args.urls.length,
    urlsToSync,
  };
}
