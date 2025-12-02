import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type {
  CrawlerActionParams,
  CrawlerResult,
  DiscoverUrlsResult,
  FetchUrlsResult,
} from './types';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CRAWLER', '[Crawler]');

export const crawlerAction: ActionDefinition<CrawlerActionParams> = {
  type: 'crawler',
  title: 'Website Crawler',
  description:
    'Crawl websites and extract content using the crawler service. Supports discover_urls, fetch_urls, and crawl_website operations.',

  parametersValidator: v.object({
    operation: v.union(
      v.literal('crawl_website'),
      v.literal('discover_urls'),
      v.literal('fetch_urls'),
    ),
    url: v.optional(v.string()),
    domain: v.optional(v.string()),
    maxPages: v.optional(v.number()),
    maxUrls: v.optional(v.number()),
    pattern: v.optional(v.string()),
    query: v.optional(v.string()),
    urls: v.optional(v.array(v.string())),
    wordCountThreshold: v.optional(v.number()),
    timeout: v.optional(v.number()),
  }),

  async execute(_ctx, params) {
    const processedParams = params as CrawlerActionParams;

    // Get crawler service URL from environment or default
    // Priority: CRAWLER_URL environment variable > default (http://localhost:8002)
    const serviceUrl = process.env.CRAWLER_URL || 'http://localhost:8002';

    const timeout = processedParams.timeout || 1800000; // 1800 seconds (30 minutes) default

    // Handle different operations
    switch (processedParams.operation) {
      case 'discover_urls':
        return await discoverUrls(processedParams, serviceUrl, timeout);
      case 'fetch_urls':
        return await fetchUrls(processedParams, serviceUrl, timeout);
      case 'crawl_website':
        return await crawlWebsite(processedParams, serviceUrl, timeout);
      default:
        throw new Error(
          `Unknown crawler operation: ${processedParams.operation}`,
        );
    }
  },
};

async function discoverUrls(
  params: CrawlerActionParams,
  serviceUrl: string,
  timeout: number,
): Promise<DiscoverUrlsResult> {
  // Extract domain from URL or use domain directly
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
    max_urls: params.maxUrls || params.maxPages || 100,
    ...(params.pattern && { pattern: params.pattern }),
    ...(params.query && { query: params.query }),
    timeout: timeout / 1000, // Convert milliseconds to seconds
  };

  debugLog(`Discovering URLs from: ${domain} with timeout: ${timeout}ms`);
  debugLog({ payload });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(`${serviceUrl}/api/v1/discover`, {
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

  const result: DiscoverUrlsResult = await response.json();

  if (!result.success) {
    const errorMessage =
      (result as { error?: string }).error || 'Unknown error';
    throw new Error(`URL discovery failed: ${errorMessage}`);
  }

  debugLog(`Discovered ${result.urls_discovered} URLs from ${domain}`);

  return result;
}

async function fetchUrls(
  params: CrawlerActionParams,
  serviceUrl: string,
  timeout: number,
): Promise<FetchUrlsResult> {
  if (!params.urls || params.urls.length === 0) {
    throw new Error('urls parameter is required for fetch_urls operation');
  }

  const payload = {
    urls: params.urls,
    word_count_threshold: params.wordCountThreshold || 100,
  };

  debugLog(`Fetching ${params.urls.length} URLs`);
  debugLog({ payload });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(`${serviceUrl}/api/v1/fetch-urls`, {
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

  const result: FetchUrlsResult = await response.json();

  if (!result.success) {
    const errorMessage =
      (result as { error?: string }).error || 'Unknown error';
    throw new Error(`URL fetch failed: ${errorMessage}`);
  }

  debugLog(
    `Successfully fetched ${result.urls_fetched} of ${result.urls_requested} URLs`,
  );

  return result;
}

async function crawlWebsite(
  params: CrawlerActionParams,
  serviceUrl: string,
  timeout: number,
): Promise<CrawlerResult> {
  if (!params.url) {
    throw new Error('url parameter is required for crawl_website operation');
  }

  const payload = {
    url: params.url,
    max_pages: params.maxPages || 100,
    word_count_threshold: params.wordCountThreshold || 100,
    ...(params.pattern && { pattern: params.pattern }),
    ...(params.query && { query: params.query }),
  };

  debugLog(`Crawling website: ${params.url} timeout: ${timeout}`);
  debugLog({ payload });
  debugLog(`Service URL: ${serviceUrl}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(`${serviceUrl}/api/v1/crawl`, {
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

  const result: CrawlerResult = await response.json();

  if (!result.success) {
    const errorMessage =
      (result as { error?: string }).error || 'Unknown error';
    throw new Error(`Crawler failed: ${errorMessage}`);
  }

  debugLog(`Successfully crawled ${result.pages_crawled} pages`);

  return result;
}
