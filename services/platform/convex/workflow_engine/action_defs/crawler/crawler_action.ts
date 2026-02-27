import { v } from 'convex/values';

import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type {
  CrawlerActionParams,
  DiscoverUrlsRawData,
  DiscoverUrlsResult,
  FetchUrlsData,
  FetchUrlsResult,
  QueryUrlsRawData,
  QueryUrlsResult,
} from './helpers/types';

import { createDebugLog } from '../../../lib/debug_log';

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
    // query_urls: Query crawler's URL registry for a registered base URL
    v.object({
      operation: v.literal('query_urls'),
      domain: v.string(),
      offset: v.optional(v.number()),
      limit: v.optional(v.number()),
      status: v.optional(v.string()),
      timeout: v.optional(v.number()),
    }),
  ),

  async execute(_ctx, params) {
    const serviceUrl = process.env.CRAWLER_URL || 'http://localhost:8002';
    const timeout = params.timeout || 1800000;

    switch (params.operation) {
      case 'discover_urls':
        return await discoverUrls(params, serviceUrl, timeout);
      case 'fetch_urls':
        return await fetchUrls(params, serviceUrl, timeout);
      case 'query_urls':
        return await queryUrls(params, serviceUrl, timeout);
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
  params: DiscoverUrlsParams,
  serviceUrl: string,
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

  const payload = {
    domain,
    max_urls: params.maxUrls || params.maxPages || 1000,
    offset: params.offset || 0,
    ...(params.pattern && { pattern: params.pattern }),
    ...(params.query && { query: params.query }),
    timeout: timeout / 1000,
  };

  debugLog(`Discovering URLs from: ${domain} with timeout: ${timeout}ms`);
  debugLog({ payload });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(`${serviceUrl}/api/v1/urls/discover`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Crawler service error (${response.status}): ${errorText}`);
  }

  const result: DiscoverUrlsRawData = await response.json();

  if (!result.success) {
    const errorMessage =
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
      (result as { error?: string }).error || 'Unknown error';
    throw new Error(`URL discovery failed: ${errorMessage}`);
  }

  debugLog(
    `Discovered ${result.urls_discovered} URLs from ${domain} (total: ${result.total_urls}, offset: ${result.offset}, is_complete: ${result.is_complete})`,
  );

  return {
    success: result.success,
    domain: result.domain,
    urls_discovered: result.urls_discovered,
    total_urls: result.total_urls,
    urls: result.urls.map((u) => u.url),
    is_complete: result.is_complete,
    offset: result.offset,
  };
}

async function fetchUrls(
  params: FetchUrlsParams,
  serviceUrl: string,
  timeout: number,
): Promise<FetchUrlsResult> {
  const payload = {
    urls: params.urls,
    word_count_threshold: params.wordCountThreshold || 100,
  };

  debugLog(`Fetching ${params.urls.length} URLs`);
  debugLog({ payload });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(`${serviceUrl}/api/v1/urls/fetch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Crawler service error (${response.status}): ${errorText}`);
  }

  const result: FetchUrlsData = await response.json();

  if (!result.success) {
    const errorMessage =
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
      (result as { error?: string }).error || 'Unknown error';
    throw new Error(`URL fetch failed: ${errorMessage}`);
  }

  debugLog(
    `Successfully fetched ${result.urls_fetched} of ${result.urls_requested} URLs`,
  );

  return result;
}

async function queryUrls(
  params: QueryUrlsParams,
  serviceUrl: string,
  timeout: number,
): Promise<QueryUrlsResult> {
  const searchParams = new URLSearchParams();
  searchParams.set('offset', String(params.offset ?? 0));
  searchParams.set('limit', String(params.limit ?? 1000));
  if (params.status) {
    searchParams.set('status', params.status);
  }

  debugLog(
    `Querying URLs for ${params.domain} (offset=${params.offset ?? 0}, limit=${params.limit ?? 1000})`,
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  searchParams.set('url', params.domain);

  const response = await fetch(
    `${serviceUrl}/api/v1/websites/urls?${searchParams}`,
    { signal: controller.signal },
  );

  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Crawler service error (${response.status}): ${errorText}`);
  }

  const result: QueryUrlsRawData = await response.json();

  debugLog(
    `Query returned ${result.urls.length} URLs for ${params.domain} (total: ${result.total}, has_more: ${result.has_more})`,
  );

  return {
    url: result.url,
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
