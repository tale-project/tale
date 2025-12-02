/**
 * Convex Tool: Web Read
 *
 * Unified web operations for agents.
 * Supports:
 * - operation = 'fetch_url': fetch and extract content from a web URL
 * - operation = 'search': search the web using SearXNG meta search engine
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';

import type {
  WebReadFetchUrlResult,
  WebReadSearchResult,
} from './helpers/types';
import { fetchPageContent } from './helpers/fetch_page_content';
import { searchWeb } from './helpers/search_web';

// Use a flat object schema instead of discriminatedUnion to ensure OpenAI-compatible JSON Schema
// (discriminatedUnion produces anyOf/oneOf which some providers reject as "type: None")
const webReadArgs = z.object({
  operation: z
    .enum(['fetch_url', 'search'])
    .describe(
      "Operation to perform: 'fetch_url' (fetch content from URL) or 'search' (web search)",
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
      "For 'search': Number of results to return (default: 10, max: 50).",
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

1. fetch_url - Fetch and extract content from a web URL (HTML pages only)
   Use when a user provides a URL and wants to know what's on the page.
   Returns: page title, main content text, word count.
   LIMITATIONS:
   - CANNOT read PDF, Excel, Word, or other binary files
   - For documents in conversation thread, use "context_search" tool
   - For knowledge base documents, use "rag_search" tool

2. search - Search the web using SearXNG meta search engine
	   Aggregates results from multiple search engines (Brave, Google, Bing, DuckDuckGo).
	   Returns URLs with titles and snippets.
	   Recommended workflow: use "search" to find candidate links, then call "fetch_url" on the most relevant URLs before answering.

EXAMPLE USAGE:
• Fetch a URL: { operation: "fetch_url", url: "https://example.com/article" }
• Simple search: { operation: "search", query: "next.js app router" }
• Site-specific: { operation: "search", query: "hooks tutorial", site: "react.dev" }`,
    args: webReadArgs,
    handler: async (
      ctx,
      args,
    ): Promise<WebReadFetchUrlResult | WebReadSearchResult> => {
      if (args.operation === 'fetch_url') {
        if (!args.url) {
          throw new Error("Missing required 'url' for fetch_url operation");
        }
        return fetchPageContent(ctx, {
          url: args.url,
          word_count_threshold: args.word_count_threshold,
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
