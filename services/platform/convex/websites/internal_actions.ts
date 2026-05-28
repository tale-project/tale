import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction } from '../_generated/server';
import { getCrawlerUrl } from '../documents/generate_document_helpers';
import { orgSlugFromId } from '../lib/helpers/org_slug';
import type {
  CrawlerChunksResponse,
  CrawlerPagesResponse,
  CrawlerSearchResponse,
  CrawlerWebsiteInfo,
} from './types';

const CRAWLER_TIMEOUT_MS = 15_000;
const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Wrap `fetch` with a timeout and inject the required `x-tale-org`
 * header so every call to the crawler service routes to the correct
 * org's provider catalog. Crawler enforces this header at the router
 * level (`require_org_slug`); missing it returns HTTP 400.
 */
function fetchWithTimeout(
  url: string,
  orgSlug: string,
  init?: RequestInit,
  timeoutMs = CRAWLER_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const mergedHeaders = new Headers(init?.headers);
  mergedHeaders.set('x-tale-org', orgSlug);
  return fetch(url, {
    ...init,
    headers: mergedHeaders,
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

export function scanIntervalToSeconds(interval: string): number {
  switch (interval) {
    case '60m':
      return 3600;
    case '6h':
      return 21600;
    case '12h':
      return 43200;
    case '1d':
      return 86400;
    case '5d':
      return 432000;
    case '7d':
      return 604800;
    case '30d':
      return 2592000;
    default:
      return 21600;
  }
}

export async function registerDomainWithCrawler(
  orgSlug: string,
  domain: string,
  scanInterval: string,
): Promise<CrawlerWebsiteInfo> {
  const crawlerUrl = getCrawlerUrl();
  const res = await fetchWithTimeout(
    `${crawlerUrl}/api/v1/websites`,
    orgSlug,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain,
        scan_interval: scanIntervalToSeconds(scanInterval),
      }),
    },
    60_000,
  );
  if (!res.ok) {
    throw new Error(
      `Failed to register website with crawler: ${res.status} ${res.statusText}`,
    );
  }
  return await res.json();
}

export async function updateCrawlerScanInterval(
  orgSlug: string,
  domain: string,
  scanInterval: string,
): Promise<void> {
  const crawlerUrl = getCrawlerUrl();
  const res = await fetchWithTimeout(
    `${crawlerUrl}/api/v1/websites/${encodeURIComponent(domain)}`,
    orgSlug,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scan_interval: scanIntervalToSeconds(scanInterval),
      }),
    },
  );
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('CRAWLER_WEBSITE_NOT_FOUND');
    }
    throw new Error(
      `Failed to update website scan interval: ${res.status} ${res.statusText}`,
    );
  }
}

export async function deregisterDomainFromCrawler(
  orgSlug: string,
  domain: string,
): Promise<void> {
  const crawlerUrl = getCrawlerUrl();
  const res = await fetchWithTimeout(
    `${crawlerUrl}/api/v1/websites/${encodeURIComponent(domain)}`,
    orgSlug,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `Failed to deregister website from crawler: ${res.status} ${res.statusText}`,
    );
  }
}

export async function fetchWebsiteInfo(
  orgSlug: string,
  domain: string,
): Promise<CrawlerWebsiteInfo | null> {
  const crawlerUrl = getCrawlerUrl();
  const res = await fetchWithTimeout(
    `${crawlerUrl}/api/v1/websites/${encodeURIComponent(domain)}`,
    orgSlug,
  );
  if (res.ok) {
    return await res.json();
  }
  if (res.status === 404) {
    return null;
  }
  throw new Error(`Crawler API returned ${res.status} ${res.statusText}`);
}

interface WebsiteForSync {
  _id: Id<'websites'>;
  domain: string;
  pageCount?: number;
  metadata?: Record<string, unknown>;
}

async function fetchHomepageMetadata(
  orgSlug: string,
  domain: string,
): Promise<{ title?: string; description?: string } | null> {
  const crawlerUrl = getCrawlerUrl();
  const res = await fetchWithTimeout(
    `${crawlerUrl}/api/v1/urls/fetch`,
    orgSlug,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: [`https://${domain}/`],
        word_count_threshold: 0,
      }),
    },
    30_000,
  );

  if (!res.ok) return null;

  const data = await res.json();
  const page = data.pages?.[0];
  if (!page) return null;

  const title = page.title || undefined;
  const sd = page.structured_data;
  const description =
    sd?.meta?.description || sd?.opengraph?.['og:description'] || undefined;

  return { title, description };
}

export const fetchAndPatchHomepage = internalAction({
  args: {
    websiteId: v.id('websites'),
    domain: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const info = await fetchHomepageMetadata(orgSlug, args.domain);
    if (!info) return;

    await ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
      websiteId: args.websiteId,
      title: info.title,
      description: info.description,
    });
  },
});

export const syncWebsiteStatuses = internalAction({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const websites: WebsiteForSync[] = await ctx.runQuery(
      internal.websites.internal_queries.listWebsitesForSync,
      { organizationId: args.organizationId },
    );

    const now = Date.now();

    for (const website of websites) {
      const lastSync = website.metadata?.lastStatusSyncAt;
      if (typeof lastSync === 'number' && now - lastSync < SYNC_INTERVAL_MS) {
        continue;
      }

      try {
        const websiteInfo = await fetchWebsiteInfo(orgSlug, website.domain);

        if (websiteInfo) {
          await ctx.runMutation(
            internal.websites.internal_mutations.patchWebsite,
            {
              websiteId: website._id,
              metadata: {
                ...website.metadata,
                lastStatusSyncAt: now,
                lastSyncError: undefined,
              },
              status: websiteInfo.status,
              pageCount: websiteInfo.page_count,
              crawledPageCount: websiteInfo.crawled_count,
              title: websiteInfo.title ?? undefined,
              description: websiteInfo.description ?? undefined,
              lastScannedAt: websiteInfo.last_scanned_at
                ? new Date(websiteInfo.last_scanned_at).getTime()
                : undefined,
            },
          );
        } else {
          // Crawler doesn't know about this website — mark as error
          await ctx.runMutation(
            internal.websites.internal_mutations.patchWebsite,
            {
              websiteId: website._id,
              status: 'error',
              metadata: {
                ...website.metadata,
                lastStatusSyncAt: now,
                lastSyncError:
                  'Website not found in crawler. Please delete and re-add it.',
              },
            },
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to sync status for ${website.domain}: ${message}`);
        await ctx.runMutation(
          internal.websites.internal_mutations.patchWebsite,
          {
            websiteId: website._id,
            metadata: {
              ...website.metadata,
              lastStatusSyncAt: now,
              lastSyncError: message,
            },
          },
        );
      }
    }
  },
});

export const registerAndSync = internalAction({
  args: {
    websiteId: v.id('websites'),
    domain: v.string(),
    scanInterval: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    try {
      await registerDomainWithCrawler(orgSlug, args.domain, args.scanInterval);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[registerAndSync] Failed to register domain ${args.domain}:`,
        error,
      );
      await ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
        websiteId: args.websiteId,
        status: 'error',
        metadata: { lastSyncError: message },
      });
      return;
    }

    // Async: fetch homepage title & description (non-blocking, independent of scan)
    await ctx.scheduler.runAfter(
      0,
      internal.websites.internal_actions.fetchAndPatchHomepage,
      {
        websiteId: args.websiteId,
        domain: args.domain,
        organizationId: args.organizationId,
      },
    );

    // Schedule a delayed sync to pick up scan results
    await ctx.scheduler.runAfter(
      600_000,
      internal.websites.internal_actions.syncSingleWebsite,
      {
        websiteId: args.websiteId,
        domain: args.domain,
        organizationId: args.organizationId,
      },
    );
  },
});

export const syncSingleWebsite = internalAction({
  args: {
    websiteId: v.id('websites'),
    domain: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const website = await ctx.runQuery(
      internal.websites.internal_queries.getWebsite,
      { websiteId: args.websiteId },
    );
    if (!website) return;

    try {
      const info = await fetchWebsiteInfo(orgSlug, args.domain);

      if (info) {
        await ctx.runMutation(
          internal.websites.internal_mutations.patchWebsite,
          {
            websiteId: args.websiteId,
            status: info.status,
            pageCount: info.page_count,
            crawledPageCount: info.crawled_count,
            title: info.title ?? undefined,
            description: info.description ?? undefined,
            lastScannedAt: info.last_scanned_at
              ? new Date(info.last_scanned_at).getTime()
              : undefined,
            metadata: {
              ...website.metadata,
              lastSyncError: undefined,
            },
          },
        );
      } else {
        await ctx.runMutation(
          internal.websites.internal_mutations.patchWebsite,
          {
            websiteId: args.websiteId,
            status: 'error',
            metadata: {
              ...website.metadata,
              lastSyncError:
                'Website not found in crawler. Please delete and re-add it.',
            },
          },
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[syncSingleWebsite] Failed to sync ${args.domain}: ${message}`,
      );
      await ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
        websiteId: args.websiteId,
        status: 'error',
        metadata: {
          ...website.metadata,
          lastSyncError: message,
        },
      });
    }
  },
});

export const fetchWebsitePages = internalAction({
  args: {
    domain: v.string(),
    organizationId: v.string(),
    offset: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const crawlerUrl = getCrawlerUrl();
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 100;

    const res = await fetchWithTimeout(
      `${crawlerUrl}/api/v1/pages/${encodeURIComponent(args.domain)}?offset=${offset}&limit=${limit}`,
      orgSlug,
    );

    if (!res.ok) {
      throw new Error(`Crawler pages API returned ${res.status}`);
    }

    const data: CrawlerPagesResponse = await res.json();
    return {
      pages: data.pages,
      total: data.total,
      offset: data.offset,
      hasMore: data.has_more,
    };
  },
});

export const fetchPageChunks = internalAction({
  args: {
    domain: v.string(),
    url: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const crawlerUrl = getCrawlerUrl();

    const res = await fetchWithTimeout(
      `${crawlerUrl}/api/v1/pages/${encodeURIComponent(args.domain)}/chunks?url=${encodeURIComponent(args.url)}`,
      orgSlug,
    );

    if (!res.ok) {
      throw new Error(`Crawler chunks API returned ${res.status}`);
    }

    const data: CrawlerChunksResponse = await res.json();
    return {
      url: data.url,
      chunks: data.chunks,
      total: data.total,
    };
  },
});

export const searchWebsiteContent = internalAction({
  args: {
    domain: v.string(),
    query: v.string(),
    organizationId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const crawlerUrl = getCrawlerUrl();
    const limit = args.limit ?? 10;

    const res = await fetchWithTimeout(
      `${crawlerUrl}/api/v1/search/${encodeURIComponent(args.domain)}`,
      orgSlug,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: args.query, limit }),
      },
    );

    if (!res.ok) {
      throw new Error(`Crawler search API returned ${res.status}`);
    }

    const data: CrawlerSearchResponse = await res.json();
    return {
      query: data.query,
      results: data.results,
      total: data.total,
    };
  },
});
