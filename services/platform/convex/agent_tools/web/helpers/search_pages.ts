/**
 * Search crawled website pages using hybrid search (full-text + vector).
 *
 * Calls the crawler service search API and formats results
 * for the LLM — deduplicating by URL and ordering by relevance.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { formatWebResults } from './format_web_results';
import { getCrawlerServiceUrl } from './get_crawler_service_url';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

const DEFAULT_LIMIT = 10;
const DEFAULT_SIMILARITY_THRESHOLD = 0.4;

const DOMAIN_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)*[a-zA-Z0-9-]+(:\d+)?$/;

interface SearchResult {
  url: string;
  title?: string;
  chunk_content: string;
  chunk_index: number;
  score: number;
}

interface SearchApiResponse {
  query: string;
  results: SearchResult[];
  total: number;
}

export function isValidDomain(domain: string): boolean {
  return DOMAIN_PATTERN.test(domain);
}

async function fetchSearch(
  crawlerUrl: string,
  query: string,
  domain?: string,
): Promise<SearchApiResponse> {
  const endpoint = domain
    ? `${crawlerUrl}/api/v1/search/${encodeURIComponent(domain)}`
    : `${crawlerUrl}/api/v1/search`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      limit: DEFAULT_LIMIT,
      similarity_threshold: DEFAULT_SIMILARITY_THRESHOLD,
    }),
  });

  if (!response.ok) {
    throw new Error(`Search API returned ${response.status}`);
  }

  return response.json();
}

interface Citation {
  index: number;
  type: 'web';
  source: string;
  url: string;
  relevance: number;
}

interface SearchPagesResult {
  text: string;
  citations: Citation[];
}

export async function searchPages(
  ctx: ToolCtx,
  args: { query: string; domain?: string },
): Promise<SearchPagesResult> {
  let validDomain: string | undefined;

  if (args.domain && isValidDomain(args.domain) && ctx.organizationId) {
    const website = await ctx.runQuery(
      internal.websites.internal_queries.getWebsiteByDomain,
      { organizationId: ctx.organizationId, domain: args.domain },
    );

    if (!website) {
      return {
        text: `The website "${args.domain}" is not in your knowledge base. Ask the user to add it via the Websites settings page, or provide a specific URL to fetch content directly.`,
        citations: [],
      };
    }

    validDomain = args.domain;
  }

  debugLog('web:search_pages start', {
    query: args.query,
    domain: validDomain,
  });

  if (!args.query.trim() && validDomain) {
    return {
      text: 'Please provide a search query along with the domain filter.',
      citations: [],
    };
  }

  const crawlerUrl = getCrawlerServiceUrl();
  let data = await fetchSearch(crawlerUrl, args.query, validDomain);
  let results = data.results;

  // Fallback to global search if domain-scoped search returns no results
  let domainFallback = false;
  if ((!results || results.length === 0) && validDomain) {
    debugLog('web:search_pages domain fallback', {
      query: args.query,
      domain: validDomain,
    });
    data = await fetchSearch(crawlerUrl, args.query);
    results = data.results;
    domainFallback = true;
  }

  if (!results || results.length === 0) {
    debugLog('web:search_pages no results', { query: args.query });
    return {
      text: 'No matching website pages found for your query. Try rephrasing, or suggest the user add the relevant website to their knowledge base.',
      citations: [],
    };
  }

  debugLog('web:search_pages success', {
    query: args.query,
    resultCount: results.length,
  });

  // Deduplicate by URL, keeping all chunks per page
  const byUrl = new Map<string, SearchResult[]>();
  for (const result of results) {
    const existing = byUrl.get(result.url) ?? [];
    existing.push(result);
    byUrl.set(result.url, existing);
  }

  const pages = Array.from(byUrl.entries())
    .map(([url, chunks]) => {
      const bestScore = Math.max(...chunks.map((c) => c.score));
      const title = chunks[0].title ?? url;
      const content = chunks
        .sort((a, b) => a.chunk_index - b.chunk_index)
        .map((c) => c.chunk_content)
        .join('\n\n');

      return { title, url, score: bestScore, content };
    })
    .sort((a, b) => b.score - a.score);

  const output = formatWebResults(pages) ?? '';

  const citations = pages.map((p, idx) => ({
    index: idx + 1,
    type: 'web' as const,
    source: p.title,
    url: p.url,
    relevance: p.score,
  }));

  if (domainFallback) {
    return {
      text: `No results found on ${validDomain}. Showing results from all indexed websites:\n\n${output}`,
      citations,
    };
  }

  return { text: output, citations };
}
