import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type {
  CrawlerChunksResponse,
  CrawlerPagesResponse,
  CrawlerSearchResponse,
  CrawlerWebsiteInfo,
} from './types';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';

const CRAWLER_TIMEOUT_MS = 15_000;
const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function getCrawlerUrl() {
  return process.env.CRAWLER_URL || 'http://localhost:8002';
}

function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = CRAWLER_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
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
  domain: string,
  scanInterval: string,
): Promise<CrawlerWebsiteInfo> {
  const crawlerUrl = getCrawlerUrl();
  const res = await fetchWithTimeout(
    `${crawlerUrl}/api/v1/websites`,
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

export async function deregisterDomainFromCrawler(
  domain: string,
): Promise<void> {
  const crawlerUrl = getCrawlerUrl();
  const res = await fetchWithTimeout(
    `${crawlerUrl}/api/v1/websites/${encodeURIComponent(domain)}`,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `Failed to deregister website from crawler: ${res.status} ${res.statusText}`,
    );
  }
}

export async function fetchWebsiteInfo(
  domain: string,
): Promise<CrawlerWebsiteInfo | null> {
  const crawlerUrl = getCrawlerUrl();
  try {
    const res = await fetchWithTimeout(
      `${crawlerUrl}/api/v1/websites/${encodeURIComponent(domain)}`,
    );
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Non-fatal: website info will be synced on next operation
  }
  return null;
}

interface WebsiteForSync {
  _id: Id<'websites'>;
  domain: string;
  pageCount?: number;
  metadata?: Record<string, unknown>;
}

export const syncWebsiteStatuses = internalAction({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
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
        const websiteInfo = await fetchWebsiteInfo(website.domain);

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
  },
  handler: async (ctx, args): Promise<void> => {
    try {
      await registerDomainWithCrawler(args.domain, args.scanInterval);
    } catch {
      await ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
        websiteId: args.websiteId,
        status: 'error',
      });
      return;
    }

    // Schedule a delayed sync to pick up scan results
    await ctx.scheduler.runAfter(
      600_000,
      internal.websites.internal_actions.syncSingleWebsite,
      { websiteId: args.websiteId, domain: args.domain },
    );
  },
});

export const syncSingleWebsite = internalAction({
  args: {
    websiteId: v.id('websites'),
    domain: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const info = await fetchWebsiteInfo(args.domain);
    if (!info) return;

    await ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
      websiteId: args.websiteId,
      status: info.status,
      pageCount: info.page_count,
      crawledPageCount: info.crawled_count,
      title: info.title ?? undefined,
      description: info.description ?? undefined,
      lastScannedAt: info.last_scanned_at
        ? new Date(info.last_scanned_at).getTime()
        : undefined,
    });
  },
});

export const fetchWebsitePages = internalAction({
  args: {
    domain: v.string(),
    offset: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const crawlerUrl = getCrawlerUrl();
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 100;

    const res = await fetchWithTimeout(
      `${crawlerUrl}/api/v1/pages/${encodeURIComponent(args.domain)}?offset=${offset}&limit=${limit}`,
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
  },
  handler: async (_ctx, args) => {
    const crawlerUrl = getCrawlerUrl();

    const res = await fetchWithTimeout(
      `${crawlerUrl}/api/v1/pages/${encodeURIComponent(args.domain)}/chunks?url=${encodeURIComponent(args.url)}`,
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
    limit: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const crawlerUrl = getCrawlerUrl();
    const limit = args.limit ?? 10;

    const res = await fetchWithTimeout(
      `${crawlerUrl}/api/v1/search/${encodeURIComponent(args.domain)}`,
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
