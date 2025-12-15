import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type {
  CrawlerActionParams,
  DiscoverUrlsData,
  DiscoverUrlsResult,
  FetchUrlsData,
  FetchUrlsResult,
} from './helpers/types';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CRAWLER', '[Crawler]');

export const crawlerAction: ActionDefinition<CrawlerActionParams> = {
  type: 'crawler',
  title: 'Website Crawler',
  description:
    'Crawl websites and extract content using the crawler service. Supports discover_urls and fetch_urls operations.',

  parametersValidator: v.union(
    // discover_urls: Discover URLs from a domain
    v.object({
      operation: v.literal('discover_urls'),
      url: v.optional(v.string()),
      domain: v.optional(v.string()),
      maxPages: v.optional(v.number()),
      maxUrls: v.optional(v.number()),
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
  ),

  async execute(_ctx, params) {
    // Get crawler service URL from environment or default
    // Priority: CRAWLER_URL environment variable > default (http://localhost:8002)
    const serviceUrl = process.env.CRAWLER_URL || 'http://localhost:8002';

    const timeout = params.timeout || 1800000; // 1800 seconds (30 minutes) default

    // Handle different operations
    switch (params.operation) {
      case 'discover_urls':
        return await discoverUrls(params, serviceUrl, timeout);
      case 'fetch_urls':
        return await fetchUrls(params, serviceUrl, timeout);
      default:
        throw new Error(
          `Unknown crawler operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};

// Type for discover_urls operation
type DiscoverUrlsParams = Extract<
  CrawlerActionParams,
  { operation: 'discover_urls' }
>;

// Type for fetch_urls operation
type FetchUrlsParams = Extract<CrawlerActionParams, { operation: 'fetch_urls' }>;

async function discoverUrls(
  params: DiscoverUrlsParams,
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

  const result: DiscoverUrlsData = await response.json();

  if (!result.success) {
    const errorMessage =
      (result as { error?: string }).error || 'Unknown error';
    throw new Error(`URL discovery failed: ${errorMessage}`);
  }

  debugLog(`Discovered ${result.urls_discovered} URLs from ${domain}`);

  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  return result;
}

async function fetchUrls(
  params: FetchUrlsParams,
  serviceUrl: string,
  timeout: number,
): Promise<FetchUrlsResult> {
  // urls is required by validator
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
      (result as { error?: string }).error || 'Unknown error';
    throw new Error(`URL fetch failed: ${errorMessage}`);
  }

  debugLog(
    `Successfully fetched ${result.urls_fetched} of ${result.urls_requested} URLs`,
  );

  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  return result;
}
