/**
 * Search crawled website pages using hybrid search (full-text + vector).
 *
 * Calls the crawler service search API and formats results
 * for the LLM — deduplicating by URL and ordering by relevance.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createDebugLog } from '../../../lib/debug_log';
import { getCrawlerServiceUrl } from './get_crawler_service_url';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

const DEFAULT_LIMIT = 10;

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

export async function searchPages(
  ctx: ToolCtx,
  args: { query: string },
): Promise<string> {
  debugLog('web:search_pages start', { query: args.query });

  const crawlerUrl = getCrawlerServiceUrl();
  const response = await fetch(`${crawlerUrl}/api/v1/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: args.query, limit: DEFAULT_LIMIT }),
  });

  if (!response.ok) {
    throw new Error(`Search API returned ${response.status}`);
  }

  const data: SearchApiResponse = await response.json();
  const results = data.results;

  if (!results || results.length === 0) {
    debugLog('web:search_pages no results', { query: args.query });
    return 'No matching website pages found for your query. Try rephrasing, or suggest the user add the relevant website to their knowledge base.';
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

  const formatted = Array.from(byUrl.entries())
    .map(([url, chunks]) => {
      const bestScore = Math.max(...chunks.map((c) => c.score));
      const title = chunks[0].title ?? url;
      const contentParts = chunks
        .sort((a, b) => a.chunk_index - b.chunk_index)
        .map((c) => c.chunk_content)
        .join('\n\n');

      return {
        text: `**${title}**\nURL: ${url}\nRelevance: ${(bestScore * 100).toFixed(1)}%\n\n${contentParts}`,
        score: bestScore,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((r) => r.text);

  return formatted.join('\n\n---\n\n');
}
