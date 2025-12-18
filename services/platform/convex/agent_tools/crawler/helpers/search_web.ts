/**
 * Helper: Search Web
 *
 * Searches the web using SearXNG meta search engine.
 * Returns links with titles and snippets for further processing.
 */

import { getSearchServiceUrl } from './get_search_service_url';
import { fetchSearXNGResults } from './fetch_searxng_results';
import { type WebReadSearchResult } from './types';
import type { ToolCtx } from '@convex-dev/agent';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CRAWLER', '[Crawler]');

// =============================================================================
// SEARCH WEB OPERATION
// =============================================================================

export interface SearchWebArgs {
  query: string;
  num_results?: number;
  page_number?: number;
  time_range?: 'day' | 'week' | 'month' | 'year';
  categories?: string[];
  safesearch?: '0' | '1' | '2';
  site?: string;
  language?: string;
}

export async function searchWeb(
  ctx: ToolCtx,
  args: SearchWebArgs,
): Promise<WebReadSearchResult> {
  const { variables } = ctx;
  const searchServiceUrl = getSearchServiceUrl(variables);
  const numResults = args.num_results ?? 10;
  const pageNumber = args.page_number ?? 1;

  // Standard search mode
  debugLog('tool:web_read:search start', {
    query: args.query,
    num_results: numResults,
    page_number: pageNumber,
    time_range: args.time_range,
    site: args.site,
  });

  try {
    const pageData = await fetchSearXNGResults(searchServiceUrl, {
      query: args.query,
      numResults,
      pageNo: pageNumber,
      timeRange: args.time_range,
      categories: args.categories,
      safesearch: args.safesearch
        ? (parseInt(args.safesearch) as 0 | 1 | 2)
        : undefined,
      site: args.site,
      language: args.language,
    });

    const hasMore = pageData.items.length >= numResults;

    debugLog('tool:web_read:search success', {
      query: args.query,
      results_count: pageData.items.length,
      has_more: hasMore,
    });

    // Build the next action instruction based on results
    const hasResults = pageData.items.length > 0;
    const firstUrl = hasResults ? pageData.items[0].link : null;
    const nextActionRequired = hasResults
      ? `IMPORTANT: These are only search result snippets, NOT the actual page content. To get real data (weather, prices, news, etc.), you MUST now call web_read with { operation: "fetch_url", url: "${firstUrl}" } or another relevant URL from the results above.`
      : 'No results found. Try a different search query.';

    return {
      operation: 'search',
      success: true,
      query: args.query,
      results: pageData.items,
      total_results: pageData.items.length,
      estimated_total: pageData.totalResults,
      has_more: hasMore,
      next_start_index: hasMore ? pageNumber + 1 : null,
      suggestions: pageData.suggestions,
      next_action_required: nextActionRequired,
    };
  } catch (error) {
    console.error('[tool:web_read:search] error', {
      query: args.query,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
