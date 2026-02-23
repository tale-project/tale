import type { MutationCtx } from '../_generated/server';

import { toId } from '../lib/type_cast_helpers';

export interface RegisterDiscoveredUrlsArgs {
  organizationId: string;
  websiteId: string;
  urls: string[];
}

export interface RegisterDiscoveredUrlsResult {
  registered: number;
  skipped: number;
  total: number;
}

export async function registerDiscoveredUrls(
  ctx: MutationCtx,
  args: RegisterDiscoveredUrlsArgs,
): Promise<RegisterDiscoveredUrlsResult> {
  const now = Date.now();
  const websiteId = toId<'websites'>(args.websiteId);
  let registered = 0;
  let skipped = 0;

  for (const url of args.urls) {
    const existing = await ctx.db
      .query('websitePages')
      .withIndex('by_organizationId_and_url', (q) =>
        q.eq('organizationId', args.organizationId).eq('url', url),
      )
      .unique();

    if (existing) {
      skipped++;
      continue;
    }

    await ctx.db.insert('websitePages', {
      organizationId: args.organizationId,
      websiteId,
      url,
      lastCrawledAt: now,
      syncStatus: 'pending',
    });
    registered++;
  }

  if (registered > 0) {
    const website = await ctx.db.get(websiteId);
    if (website) {
      await ctx.db.patch(websiteId, {
        pageCount: (website.pageCount ?? 0) + registered,
      });
    }
  }

  return { registered, skipped, total: args.urls.length };
}
