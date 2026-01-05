/**
 * Convex Tool: Web Read
 *
 * Unified web operations for agents.
 * Supports:
 * - operation = 'fetch_url': fetch and extract content from a web URL
 * - operation = 'search': search the web using SearXNG meta search engine
 */

import { z } from 'zod';
import { createTool, type ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';

import type {
  WebReadFetchUrlResult,
  WebReadSearchResult,
  WebReadSearchAndFetchResult,
} from './helpers/types';
import { fetchPageContent } from './helpers/fetch_page_content';
import { searchWeb } from './helpers/search_web';
import { searchAndFetch } from './helpers/search_and_fetch';

// Use a flat object schema instead of discriminatedUnion to ensure OpenAI-compatible JSON Schema
// (discriminatedUnion produces anyOf/oneOf which some providers reject as "type: None")
const webReadArgs = z.object({
  operation: z
    .enum(['fetch_url', 'search', 'search_and_fetch'])
    .describe(
      "Operation to perform: 'fetch_url' (fetch content from URL), 'search' (web search only), or 'search_and_fetch' (search + auto-fetch top results, RECOMMENDED)",
    ),
  // For fetch_url operation
  url: z
    .string()
    .optional()
    .describe(
      "Required for 'fetch_url': The URL to fetch content from (must be a valid http/https URL)",
    ),
  word_count_threshold: z
    .number()
    .optional()
    .describe(
      "For 'fetch_url': Minimum word count for content extraction (default: 50). Lower values capture more content.",
    ),
  // For search operation
  query: z
    .string()
    .optional()
    .describe("Required for 'search': The search query text"),
  num_results: z
    .number()
    .optional()
    .describe(
      "For 'search'/'search_and_fetch': Number of search results to return (default: 10, max: 50).",
    ),
  fetch_count: z
    .number()
    .optional()
    .describe(
      "For 'search_and_fetch': Number of top results to fetch content from (default: 5, max: num_results).",
    ),
  page_number: z
    .number()
    .optional()
    .describe("For 'search': Page number for pagination (default: 1)."),
  time_range: z
    .enum(['day', 'week', 'month', 'year'])
    .optional()
    .describe("For 'search': Filter by time: day, week, month, or year."),
  categories: z
    .array(z.string())
    .optional()
    .describe(
      "For 'search': Categories: general, news, science, it, images, videos.",
    ),
  safesearch: z
    .enum(['0', '1', '2'])
    .optional()
    .describe("For 'search': Safe search: 0=off, 1=moderate, 2=strict."),
  site: z
    .string()
    .optional()
    .describe(
      'For \'search\': Limit to domain (e.g., "github.com", "arxiv.org").',
    ),
  language: z
    .string()
    .optional()
    .describe(
      'For \'search\': Language code (default: "all"). Examples: "en", "de", "fr", "zh".',
    ),
});

export const webReadTool: ToolDefinition = {
  name: 'web_read',
  tool: createTool({
    description: `Web content tool for fetching URLs and searching the web.

OPERATIONS:

1. search_and_fetch (RECOMMENDED) - Search + auto-fetch top results in ONE call
   Searches the web AND fetches content from top results in parallel.
   Returns: search results metadata + actual page content from top 5 URLs.
   USE THIS for any research task - it's faster than search + manual fetch!
   Example: { operation: "search_and_fetch", query: "weather in Zurich today" }

2. fetch_url - Fetch and extract content from a specific URL
   Use when a user provides a URL and wants to know what's on the page.
   Returns: page title, main content text, word count, structured_data.
   LIMITATIONS:
   - CANNOT read PDF, Excel, Word, or other binary files
   - For documents in conversation thread, use "context_search" tool
   - For knowledge base documents, use "rag_search" tool

3. search - Search the web (returns snippets only, no content)
   Use ONLY when you need many results without fetching content.
   Returns URLs with titles and SHORT SNIPPETS ONLY - NOT the actual page content!

EXAMPLES:
• Research query: { operation: "search_and_fetch", query: "React 19 new features" }
• Fetch specific URL: { operation: "fetch_url", url: "https://example.com/article" }
• Site-specific research: { operation: "search_and_fetch", query: "hooks", site: "react.dev" }
• Browse many results: { operation: "search", query: "next.js tutorials", num_results: 20 }`,
    args: webReadArgs,
    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<WebReadFetchUrlResult | WebReadSearchResult | WebReadSearchAndFetchResult> => {
      if (args.operation === 'fetch_url') {
        if (!args.url) {
          throw new Error("Missing required 'url' for fetch_url operation");
        }
        return fetchPageContent(ctx, {
          url: args.url,
          word_count_threshold: args.word_count_threshold,
        });
      }

      if (args.operation === 'search_and_fetch') {
        if (!args.query) {
          throw new Error("Missing required 'query' for search_and_fetch operation");
        }
        return searchAndFetch(ctx, {
          query: args.query,
          num_results: args.num_results,
          fetch_count: args.fetch_count,
          time_range: args.time_range,
          categories: args.categories,
          safesearch: args.safesearch,
          site: args.site,
          language: args.language,
        });
      }

      // operation === 'search'
      if (!args.query) {
        throw new Error("Missing required 'query' for search operation");
      }
      return searchWeb(ctx, {
        query: args.query,
        num_results: args.num_results,
        page_number: args.page_number,
        time_range: args.time_range,
        categories: args.categories,
        safesearch: args.safesearch,
        site: args.site,
        language: args.language,
      });
    },
  }),
};
