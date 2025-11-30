/**
 * Convex Tool: Web Search
 *
 * Search the web for information using SearXNG (self-hosted meta search engine).
 * SearXNG aggregates results from multiple search engines (Google, Bing, DuckDuckGo, etc.)
 * with no query limits - completely free and unlimited.
 *
 * Supports two modes:
 * - Standard: Single query search with filtering options
 * - Deep Research: Multi-query exploration with content fetching and synthesis
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  engines?: string[];
  publishedDate?: string;
  category?: string;
  content?: string;
  wordCount?: number;
}

interface SourceInfo {
  url: string;
  title: string;
  snippet: string;
  content?: string;
  wordCount?: number;
}

interface ResearchFinding {
  query: string;
  sources: SourceInfo[];
  keyPoints: string[];
}

export interface WebSearchResponse {
  success: boolean;
  query: string;
  results: SearchResult[];
  total_results: number;
  estimated_total: number;
  has_more: boolean;
  next_start_index: number | null;
  suggestions?: string[];
  // Deep research fields (only present when deep_research=true)
  deep_research?: {
    queriesExecuted: string[];
    totalSourcesFound: number;
    totalSourcesFetched: number;
    findings: ResearchFinding[];
    researchSummary: string;
  };
}

/**
 * SearXNG API response types
 */
interface SearXNGResult {
  url: string;
  title: string;
  content?: string;
  engine?: string;
  engines?: string[];
  publishedDate?: string;
  category?: string;
}

interface SearXNGResponse {
  query: string;
  results: SearXNGResult[];
  number_of_results?: number;
  suggestions?: string[];
}

/**
 * Search options for SearXNG
 */
export interface SearchOptions {
  query: string;
  numResults?: number;
  pageNo?: number;
  timeRange?: 'day' | 'week' | 'month' | 'year';
  categories?: string[];
  engines?: string[];
  safesearch?: 0 | 1 | 2;
  language?: string;
  site?: string;
}

/**
 * Get SearXNG service URL from environment or use default
 */
export function getSearchServiceUrl(
  variables?: Record<string, unknown>,
): string {
  // Check variables first (injected by agent), then environment
  const fromVariables = variables?.SEARCH_SERVICE_URL;
  if (typeof fromVariables === 'string' && fromVariables) {
    return fromVariables;
  }
  return process.env.SEARCH_SERVICE_URL || 'http://localhost:8003';
}

/**
 * Fetch search results from SearXNG with full options support
 */
export async function fetchSearXNGResults(
  serviceUrl: string,
  options: SearchOptions,
): Promise<{
  items: SearchResult[];
  totalResults: number;
  suggestions: string[];
}> {
  const url = new URL(`${serviceUrl}/search`);

  // Build query - prepend site: filter if specified
  let finalQuery = options.query;
  if (options.site) {
    finalQuery = `site:${options.site} ${options.query}`;
  }
  url.searchParams.set('q', finalQuery);
  url.searchParams.set('format', 'json');
  url.searchParams.set('pageno', String(options.pageNo ?? 1));

  // Set engines - if not specified, don't set the parameter to use all enabled engines
  if (options.engines && options.engines.length > 0) {
    url.searchParams.set('engines', options.engines.join(','));
  }
  // If no engines specified, SearXNG will use all enabled engines by default

  // Set categories if specified
  if (options.categories && options.categories.length > 0) {
    url.searchParams.set('categories', options.categories.join(','));
  }

  // Set time range if specified
  if (options.timeRange) {
    url.searchParams.set('time_range', options.timeRange);
  }

  // Set safesearch if specified
  if (options.safesearch !== undefined) {
    url.searchParams.set('safesearch', String(options.safesearch));
  }

  // Set language - if specified, otherwise use SearXNG default (all)
  if (options.language) {
    url.searchParams.set('language', options.language);
  }
  // If no language specified, SearXNG will use the default (all)

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `SearXNG Search API error: ${response.status} ${errorText}`,
    );
  }

  const data = (await response.json()) as SearXNGResponse;
  const numResults = options.numResults ?? 10;

  // Map SearXNG results to our format and limit to requested number
  const items: SearchResult[] = (data.results || [])
    .slice(0, numResults)
    .map((item) => ({
      title: item.title || '',
      link: item.url || '',
      snippet: item.content || '',
      engines: item.engines,
      publishedDate: item.publishedDate,
      category: item.category,
    }));

  return {
    items,
    totalResults: data.number_of_results || items.length,
    suggestions: data.suggestions || [],
  };
}

// =============================================================================
// DEEP RESEARCH HELPERS
// =============================================================================

interface FetchUrlsApiResponse {
  success: boolean;
  urls_requested: number;
  urls_fetched: number;
  pages: Array<{
    url: string;
    title?: string;
    content: string;
    word_count: number;
    metadata?: Record<string, unknown>;
  }>;
}

/**
 * Get crawler service URL from environment or variables
 */
function getCrawlerServiceUrl(variables?: Record<string, unknown>): string {
  return (
    (variables?.crawlerServiceUrl as string) ||
    process.env.CRAWLER_URL ||
    'http://localhost:8002'
  );
}

/**
 * Fetch content from multiple URLs for deep research
 */
async function fetchUrlContents(
  urls: string[],
  crawlerServiceUrl: string,
): Promise<Map<string, { content: string; wordCount: number }>> {
  const results = new Map<string, { content: string; wordCount: number }>();
  if (urls.length === 0) return results;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    const response = await fetch(`${crawlerServiceUrl}/api/v1/fetch-urls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: urls.slice(0, 15),
        word_count_threshold: 50,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = (await response.json()) as FetchUrlsApiResponse;
      for (const page of data.pages) {
        results.set(page.url, {
          content: page.content,
          wordCount: page.word_count,
        });
      }
    }
  } catch (error) {
    console.error('[web_search:deep] Error fetching URLs:', error);
  }

  return results;
}

/**
 * Generate related search queries for deep research
 */
function generateRelatedQueries(
  topic: string,
  depth: 'shallow' | 'medium' | 'deep',
): string[] {
  const queries: string[] = [topic];
  const questionPrefixes = ['what is', 'how does', 'why', 'examples of'];
  const suffixes = ['explained', 'guide', 'tutorial', 'best practices'];

  if (depth === 'medium' || depth === 'deep') {
    questionPrefixes.forEach((prefix) => queries.push(`${prefix} ${topic}`));
  }

  if (depth === 'deep') {
    suffixes.forEach((suffix) => queries.push(`${topic} ${suffix}`));
    queries.push(`${topic} research papers`);
    queries.push(`${topic} comparison`);
    queries.push(`${topic} alternatives`);
  }

  return queries;
}

/**
 * Extract key points from content
 */
function extractKeyPoints(content: string, maxPoints: number = 5): string[] {
  const sentences = content
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 300);
  return sentences.slice(0, maxPoints);
}

// =============================================================================
// WEB SEARCH TOOL
// =============================================================================

export const webSearchTool = {
  name: 'web_search' as const,
  tool: createTool({
    description: `Search the web for real-world information using SearXNG meta search engine.
Aggregates results from multiple search engines (Brave, Google, Bing, DuckDuckGo) for comprehensive coverage.

TWO MODES:
1. Standard Search (default): Returns URLs with titles and snippets. Use fetch_url afterward to get full content.
2. Deep Research (deep_research=true): Automatically generates multiple queries, fetches content from top sources, and extracts key points. Use for thorough research.

STANDARD WORKFLOW:
1. Call web_search to find relevant URLs
2. Use fetch_url to get full content from top results
3. Provide answer based on fetched content

DEEP RESEARCH (set deep_research=true):
- Automatically explores topic from multiple angles
- Fetches and analyzes content from multiple sources
- Returns findings with key points extracted
- Best for: complex topics, comprehensive research, multi-faceted questions`,
    args: z.object({
      query: z.string().describe('The search query or topic to research'),
      deep_research: z
        .boolean()
        .optional()
        .describe(
          'Enable deep research mode: auto-generates multiple queries, fetches content, extracts key points. Default: false.',
        ),
      research_depth: z
        .enum(['shallow', 'medium', 'deep'])
        .optional()
        .describe(
          'Only for deep_research mode. shallow=1-2 queries, medium=4-5 queries (default), deep=8-10 queries.',
        ),
      num_results: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe('Number of results to return (default: 10, max: 50).'),
      page_number: z
        .number()
        .min(1)
        .optional()
        .describe('Page number for pagination (default: 1).'),
      time_range: z
        .enum(['day', 'week', 'month', 'year'])
        .optional()
        .describe('Filter by time: day, week, month, or year.'),
      categories: z
        .array(z.string())
        .optional()
        .describe('Categories: general, news, science, it, images, videos.'),
      safesearch: z
        .enum(['0', '1', '2'])
        .optional()
        .describe('Safe search: 0=off, 1=moderate, 2=strict.'),
      site: z
        .string()
        .optional()
        .describe('Limit to domain (e.g., "github.com", "arxiv.org").'),
      language: z
        .string()
        .optional()
        .describe(
          'Language code (default: "all"). Examples: "en", "de", "fr", "zh".',
        ),
    }),
    handler: async (ctx, args): Promise<WebSearchResponse> => {
      const variables = (
        ctx as unknown as { variables?: Record<string, unknown> }
      ).variables;

      const searchServiceUrl = getSearchServiceUrl(variables);
      const numResults = args.num_results ?? 10;
      const pageNumber = args.page_number ?? 1;

      // Deep research mode
      if (args.deep_research) {
        return executeDeepResearch(
          args,
          searchServiceUrl,
          getCrawlerServiceUrl(variables),
        );
      }

      // Standard search mode
      console.log('[tool:web_search] start', {
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

        console.log('[tool:web_search] success', {
          query: args.query,
          results_count: pageData.items.length,
          has_more: hasMore,
        });

        return {
          success: true,
          query: args.query,
          results: pageData.items,
          total_results: pageData.items.length,
          estimated_total: pageData.totalResults,
          has_more: hasMore,
          next_start_index: hasMore ? pageNumber + 1 : null,
          suggestions: pageData.suggestions,
        };
      } catch (error) {
        console.error('[tool:web_search] error', {
          query: args.query,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }),
} as const satisfies ToolDefinition;

// =============================================================================
// DEEP RESEARCH EXECUTION
// =============================================================================

interface DeepResearchArgs {
  query: string;
  research_depth?: 'shallow' | 'medium' | 'deep';
  time_range?: 'day' | 'week' | 'month' | 'year';
  categories?: string[];
  safesearch?: '0' | '1' | '2';
  site?: string;
  language?: string;
  num_results?: number;
}

async function executeDeepResearch(
  args: DeepResearchArgs,
  searchServiceUrl: string,
  crawlerServiceUrl: string,
): Promise<WebSearchResponse> {
  const depth = args.research_depth ?? 'medium';
  const maxSourcesPerQuery = Math.min(args.num_results ?? 3, 5);

  console.log('[tool:web_search:deep] start', {
    topic: args.query,
    depth,
    time_range: args.time_range,
  });

  const queries = generateRelatedQueries(args.query, depth);
  const findings: ResearchFinding[] = [];
  const allSourcesMap = new Map<string, SourceInfo>();
  const allSuggestions: string[] = [];

  // Execute searches for each query
  for (const query of queries) {
    try {
      const searchResult = await fetchSearXNGResults(searchServiceUrl, {
        query,
        numResults: maxSourcesPerQuery * 2,
        timeRange: args.time_range,
        categories: args.categories,
        safesearch: args.safesearch
          ? (parseInt(args.safesearch) as 0 | 1 | 2)
          : undefined,
        site: args.site,
        language: args.language,
      });

      if (searchResult.suggestions) {
        allSuggestions.push(...searchResult.suggestions);
      }

      const querySources: SourceInfo[] = [];
      for (const result of searchResult.items) {
        if (!allSourcesMap.has(result.link)) {
          const source: SourceInfo = {
            url: result.link,
            title: result.title,
            snippet: result.snippet,
          };
          allSourcesMap.set(result.link, source);
          querySources.push(source);
        }
      }

      findings.push({
        query,
        sources: querySources.slice(0, maxSourcesPerQuery),
        keyPoints: [],
      });
    } catch (error) {
      console.error(`[web_search:deep] Search failed for: ${query}`, error);
    }
  }

  // Fetch content from top sources
  const urlsToFetch = Array.from(allSourcesMap.keys()).slice(0, 15);
  const fetchedContents = await fetchUrlContents(
    urlsToFetch,
    crawlerServiceUrl,
  );

  // Update sources with fetched content and extract key points
  let totalFetched = 0;
  const allResults: SearchResult[] = [];

  for (const finding of findings) {
    for (const source of finding.sources) {
      const fetched = fetchedContents.get(source.url);
      if (fetched) {
        source.content = fetched.content.slice(0, 2000);
        source.wordCount = fetched.wordCount;
        totalFetched++;

        const points = extractKeyPoints(fetched.content);
        finding.keyPoints.push(...points);
      }

      // Add to all results
      allResults.push({
        title: source.title,
        link: source.url,
        snippet: source.snippet,
        content: source.content,
        wordCount: source.wordCount,
      });
    }
    finding.keyPoints = [...new Set(finding.keyPoints)].slice(0, 5);
  }

  const totalPoints = findings.reduce((sum, f) => sum + f.keyPoints.length, 0);
  const researchSummary =
    `Deep research completed: ${queries.length} queries, ` +
    `${allSourcesMap.size} sources found, ${totalFetched} fetched, ` +
    `${totalPoints} key points extracted.`;

  console.log('[tool:web_search:deep] complete', {
    topic: args.query,
    queries_executed: queries.length,
    sources_found: allSourcesMap.size,
    sources_fetched: totalFetched,
  });

  return {
    success: true,
    query: args.query,
    results: allResults,
    total_results: allResults.length,
    estimated_total: allSourcesMap.size,
    has_more: false,
    next_start_index: null,
    suggestions: [...new Set(allSuggestions)].slice(0, 5),
    deep_research: {
      queriesExecuted: queries,
      totalSourcesFound: allSourcesMap.size,
      totalSourcesFetched: totalFetched,
      findings,
      researchSummary,
    },
  };
}
