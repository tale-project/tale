import { v } from 'convex/values';

import { internal } from '../../../_generated/api';
import type { ActionCtx } from '../../../_generated/server';
import { createDebugLog } from '../../../lib/debug_log';
import { orgSlugFromId } from '../../../lib/helpers/org_slug';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type {
  CrawlerActionParams,
  DiscoverUrlsResult,
  FetchUrlsResult,
  QueryUrlsResult,
} from './helpers/types';

const debugLog = createDebugLog('DEBUG_CRAWLER', '[Crawler]');

export const crawlerAction: ActionDefinition<CrawlerActionParams> = {
  type: 'crawler',
  title: 'Website Crawler',
  description:
    'Crawl websites and extract content using the crawler service. Supports discover_urls, fetch_urls, and query_urls operations.',

  parametersValidator: v.union(
    // discover_urls: Discover URLs from a domain
    v.object({
      operation: v.literal('discover_urls'),
      url: v.optional(v.string()),
      domain: v.optional(v.string()),
      maxPages: v.optional(v.number()),
      maxUrls: v.optional(v.number()),
      offset: v.optional(v.number()),
      pattern: v.optional(v.string()),
      query: v.optional(v.string()),
      timeout: v.optional(v.number()),
    }),
    // fetch_urls: Fetch content from specific URLs
    v.object({
      operation: v.literal('fetch_urls'),
      urls: v.array(v.string()),
      wordCountThreshold: v.optional(v.number()),
      timeout: v.optional(v.number()),
    }),
    // query_urls: Query crawler's URL registry for a domain
    v.object({
      operation: v.literal('query_urls'),
      domain: v.string(),
      offset: v.optional(v.number()),
      limit: v.optional(v.number()),
      status: v.optional(v.string()),
      timeout: v.optional(v.number()),
    }),
  ),

  async execute(ctx, params, variables) {
    const timeout = params.timeout || 1800000;

    const organizationId =
      typeof variables.organizationId === 'string'
        ? variables.organizationId
        : undefined;
    if (!organizationId) {
      throw new Error(
        'crawler action requires organizationId in workflow _variables.',
      );
    }
    const orgSlug = await orgSlugFromId(ctx, organizationId);

    switch (params.operation) {
      case 'discover_urls':
        return await discoverUrls(
          ctx,
          params,
          orgSlug,
          organizationId,
          timeout,
        );
      case 'fetch_urls':
        return await fetchUrls(ctx, params, orgSlug, organizationId, timeout);
      case 'query_urls':
        return await queryUrls(ctx, params, orgSlug, timeout);
      default:
        throw new Error(
          `Unknown crawler operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};

type DiscoverUrlsParams = Extract<
  CrawlerActionParams,
  { operation: 'discover_urls' }
>;

type FetchUrlsParams = Extract<
  CrawlerActionParams,
  { operation: 'fetch_urls' }
>;

type QueryUrlsParams = Extract<
  CrawlerActionParams,
  { operation: 'query_urls' }
>;

async function discoverUrls(
  ctx: ActionCtx,
  params: DiscoverUrlsParams,
  orgSlug: string,
  organizationId: string,
  timeout: number,
): Promise<DiscoverUrlsResult> {
  let domain = params.domain;
  if (!domain && params.url) {
    const url = new URL(params.url);
    domain = url.hostname;
  }

  if (!domain) {
    throw new Error('Either domain or url parameter is required');
  }

  const maxUrls = params.maxUrls || params.maxPages || 1000;

  debugLog(`Discovering URLs from: ${domain} with timeout: ${timeout}ms`);

  // In-process discovery (sitemap + BFS fallback) + persist. Replaces the
  // external crawler `/api/v1/urls/discover`. `organizationId` enables the
  // sandbox JS-render seam when `CRAWLER_RENDER_VIA_SANDBOX=1`.
  const result = await ctx.runAction(
    internal.crawler.index_pages.discoverUrls,
    {
      orgSlug,
      domain,
      maxUrls,
      pattern: params.pattern ?? null,
      timeout,
      offset: params.offset ?? 0,
      query: params.query ?? null,
      organizationId,
    },
  );

  debugLog(
    `Discovered ${result.discovered} URLs from ${domain} (inserted: ${result.inserted})`,
  );

  // The in-process port discovers the full set in one pass (no server-side
  // pagination cursor), so `is_complete` is always true and `total_urls`
  // equals the discovered count.
  return {
    success: true,
    domain: result.domain,
    urls_discovered: result.discovered,
    total_urls: result.discovered,
    urls: result.urls.map((u) => u.url),
    is_complete: true,
    offset: params.offset ?? 0,
  };
}

async function fetchUrls(
  ctx: ActionCtx,
  params: FetchUrlsParams,
  orgSlug: string,
  organizationId: string,
  timeout: number,
): Promise<FetchUrlsResult> {
  // `domain` is derived from the first URL — the in-process store keys page
  // content by `(domain, url)`. The external endpoint inferred the domain
  // server-side from each URL's registered website; all URLs in a single
  // workflow batch belong to the same crawled domain.
  let domain = '';
  if (params.urls.length > 0) {
    try {
      domain = new URL(params.urls[0]).hostname;
    } catch {
      domain = '';
    }
  }

  debugLog(`Fetching ${params.urls.length} URLs (domain=${domain})`);

  const result = await ctx.runAction(internal.crawler.index_pages.fetchUrls, {
    orgSlug,
    domain,
    urls: params.urls,
    wordCountThreshold: params.wordCountThreshold ?? 100,
    timeout,
    organizationId,
  });

  debugLog(
    `Successfully fetched ${result.urls_fetched} of ${result.urls_requested} URLs`,
  );

  return {
    success: result.success,
    urls_requested: result.urls_requested,
    urls_fetched: result.urls_fetched,
    pages: result.pages,
    failed: result.failed,
  };
}

async function queryUrls(
  ctx: ActionCtx,
  params: QueryUrlsParams,
  orgSlug: string,
  _timeout: number,
): Promise<QueryUrlsResult> {
  debugLog(
    `Querying URLs for ${params.domain} (offset=${params.offset ?? 0}, limit=${params.limit ?? 1000})`,
  );

  // In-process URL-registry listing. `listUrls` requires `orgSlug` so it can
  // enforce the org's website membership (replaces the external service's
  // `x-tale-org` header check).
  const result = await ctx.runAction(internal.crawler.websites.listUrls, {
    orgSlug,
    domain: params.domain,
    offset: params.offset ?? 0,
    limit: params.limit ?? 1000,
    status: params.status ?? null,
  });

  debugLog(
    `Query returned ${result.urls.length} URLs for ${params.domain} (total: ${result.total}, has_more: ${result.has_more})`,
  );

  return {
    domain: params.domain,
    urls: result.urls.map((u) => ({
      url: u.url,
      contentHash: u.content_hash,
      status: u.status,
    })),
    total: result.total,
    offset: result.offset,
    has_more: result.has_more,
  };
}
