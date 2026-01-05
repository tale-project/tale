/**
 * Helper: Search and Fetch
 *
 * Combines web search with parallel content fetching for faster results.
 * Searches using SearXNG, then fetches top N results in parallel using batch API.
 */

import { getSearchServiceUrl } from './get_search_service_url';
import { getCrawlerServiceUrl } from './get_crawler_service_url';
import { fetchSearXNGResults } from './fetch_searxng_results';
import {
  type FetchUrlsApiResponse,
  type FetchedPageContent,
  type WebReadSearchAndFetchResult,
} from './types';
import type { ToolCtx } from '@convex-dev/agent';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CRAWLER', '[Crawler]');

// Content size limits
const MAX_CONTENT_CHARS_PER_PAGE = 50_000; // Lower limit per page for batch results
const DEFAULT_FETCH_COUNT = 5;

export interface SearchAndFetchArgs {
  query: string;
  num_results?: number;
  fetch_count?: number;
  time_range?: 'day' | 'week' | 'month' | 'year';
  categories?: string[];
  safesearch?: '0' | '1' | '2';
  site?: string;
  language?: string;
}

export async function searchAndFetch(
  ctx: ToolCtx,
  args: SearchAndFetchArgs,
): Promise<WebReadSearchAndFetchResult> {
  const { variables } = ctx;
  const searchServiceUrl = getSearchServiceUrl(variables);
  const crawlerServiceUrl = getCrawlerServiceUrl(variables);

  const numResults = args.num_results ?? 10;
  const fetchCount = Math.min(args.fetch_count ?? DEFAULT_FETCH_COUNT, numResults);

  debugLog('tool:web_read:search_and_fetch start', {
    query: args.query,
    num_results: numResults,
    fetch_count: fetchCount,
    time_range: args.time_range,
    site: args.site,
  });

  const startTime = Date.now();

  // Step 1: Search
  const searchData = await fetchSearXNGResults(searchServiceUrl, {
    query: args.query,
    numResults,
    pageNo: 1,
    timeRange: args.time_range,
    categories: args.categories,
    safesearch: args.safesearch
      ? (parseInt(args.safesearch) as 0 | 1 | 2)
      : undefined,
    site: args.site,
    language: args.language,
  });

  const searchDuration = Date.now() - startTime;
  debugLog('tool:web_read:search_and_fetch search_complete', {
    query: args.query,
    results_count: searchData.items.length,
    duration_ms: searchDuration,
  });

  if (searchData.items.length === 0) {
    return {
      operation: 'search_and_fetch',
      success: true,
      query: args.query,
      search_results: [],
      total_search_results: 0,
      fetched_pages: [],
      pages_fetched: 0,
      pages_failed: 0,
      suggestions: searchData.suggestions,
    };
  }

  // Step 2: Fetch top N URLs in parallel using batch API
  const urlsToFetch = searchData.items.slice(0, fetchCount).map((item) => item.link);

  debugLog('tool:web_read:search_and_fetch fetching_urls', {
    urls: urlsToFetch,
  });

  const fetchStartTime = Date.now();
  const fetchedPages: FetchedPageContent[] = [];
  let pagesFailed = 0;

  try {
    const apiUrl = `${crawlerServiceUrl}/api/v1/urls/fetch`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000); // 90 second timeout for batch

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: urlsToFetch,
        word_count_threshold: 0,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Crawler service error: ${response.status} ${errorText}`);
    }

    const result = (await response.json()) as FetchUrlsApiResponse;

    // Process fetched pages
    for (const page of result.pages) {
      const rawContent = page.content ?? '';
      const wasTruncated = rawContent.length > MAX_CONTENT_CHARS_PER_PAGE;
      const content = wasTruncated
        ? rawContent.slice(0, MAX_CONTENT_CHARS_PER_PAGE)
        : rawContent;

      fetchedPages.push({
        url: page.url,
        title: page.title,
        content,
        word_count: page.word_count,
        success: true,
      });
    }

    // Track URLs that failed to fetch
    const fetchedUrls = new Set(result.pages.map((p) => p.url));
    for (const url of urlsToFetch) {
      if (!fetchedUrls.has(url)) {
        fetchedPages.push({
          url,
          content: '',
          word_count: 0,
          success: false,
          error: 'Failed to fetch content',
        });
        pagesFailed++;
      }
    }
  } catch (error) {
    // If batch fetch fails completely, mark all as failed
    console.error('[tool:web_read:search_and_fetch] batch_fetch_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    for (const url of urlsToFetch) {
      fetchedPages.push({
        url,
        content: '',
        word_count: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      pagesFailed++;
    }
  }

  const fetchDuration = Date.now() - fetchStartTime;
  const totalDuration = Date.now() - startTime;

  debugLog('tool:web_read:search_and_fetch complete', {
    query: args.query,
    search_results: searchData.items.length,
    pages_fetched: fetchedPages.filter((p) => p.success).length,
    pages_failed: pagesFailed,
    search_duration_ms: searchDuration,
    fetch_duration_ms: fetchDuration,
    total_duration_ms: totalDuration,
  });

  // Note: success=true indicates the operation completed (search worked).
  // Partial page fetch failures are expected and tracked in pages_failed.
  // Callers should check pages_failed and fetched_pages[].success for per-page outcomes.
  return {
    operation: 'search_and_fetch',
    success: true,
    query: args.query,
    search_results: searchData.items,
    total_search_results: searchData.items.length,
    fetched_pages: fetchedPages,
    pages_fetched: fetchedPages.filter((p) => p.success).length,
    pages_failed: pagesFailed,
    suggestions: searchData.suggestions,
  };
}
