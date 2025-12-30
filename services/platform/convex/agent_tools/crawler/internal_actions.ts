'use node';

/**
 * Internal actions for crawler operations.
 * These wrap helper functions so they can be cached by ActionCache.
 */

import { internalAction } from '../../_generated/server';
import { v } from 'convex/values';
import {
  fetchSearXNGResults,
  type SearchOptions,
} from './helpers/fetch_searxng_results';
import { getCrawlerServiceUrl } from './helpers/get_crawler_service_url';

/**
 * Internal action for fetching SearXNG search results.
 * Wrapped for caching - same query should return cached results.
 */
export const fetchSearXNGResultsUncached = internalAction({
  args: {
    query: v.string(),
    site: v.optional(v.string()),
    pageNo: v.optional(v.number()),
    engines: v.optional(v.array(v.string())),
    categories: v.optional(v.array(v.string())),
    timeRange: v.optional(v.string()),
    safesearch: v.optional(v.number()),
    language: v.optional(v.string()),
    numResults: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(
      v.object({
        title: v.string(),
        link: v.string(),
        snippet: v.string(),
        engines: v.optional(v.array(v.string())),
        publishedDate: v.optional(v.string()),
        category: v.optional(v.string()),
      }),
    ),
    totalResults: v.number(),
    suggestions: v.array(v.string()),
  }),
  handler: async (_ctx, args) => {
    const serviceUrl = getCrawlerServiceUrl();
    const options: SearchOptions = {
      query: args.query,
      site: args.site,
      pageNo: args.pageNo,
      engines: args.engines,
      categories: args.categories,
      timeRange: args.timeRange,
      safesearch: args.safesearch,
      language: args.language,
      numResults: args.numResults,
    };
    return await fetchSearXNGResults(serviceUrl, options);
  },
});
