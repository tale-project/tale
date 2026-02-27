import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { CrawlerPagesResponse, CrawlerWebsiteInfo } from './types';

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
): Promise<void> {
  const crawlerUrl = getCrawlerUrl();
  const res = await fetchWithTimeout(`${crawlerUrl}/api/v1/websites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain,
      scan_interval: scanIntervalToSeconds(scanInterval),
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to register website with crawler: ${res.status} ${res.statusText}`,
    );
  }
}

export async function deregisterDomainFromCrawler(
  domain: string,
): Promise<void> {
  const crawlerUrl = getCrawlerUrl();
  const res = await fetchWithTimeout(
    `${crawlerUrl}/api/v1/websites/${domain}`,
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
      `${crawlerUrl}/api/v1/websites/${domain}`,
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
              metadata: { ...website.metadata, lastStatusSyncAt: now },
              status: websiteInfo.status,
              pageCount: websiteInfo.page_count,
              title: websiteInfo.title ?? undefined,
              description: websiteInfo.description ?? undefined,
              lastScannedAt: websiteInfo.last_scanned_at
                ? new Date(websiteInfo.last_scanned_at).getTime()
                : undefined,
            },
          );
        }
        // Only update lastStatusSyncAt on success — skip on failure so retry
        // happens on the next sync cycle instead of waiting the full interval.
      } catch {
        console.warn(`Failed to sync status for ${website.domain}, will retry`);
      }
    }
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
      `${crawlerUrl}/api/v1/pages/${args.domain}?offset=${offset}&limit=${limit}`,
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
