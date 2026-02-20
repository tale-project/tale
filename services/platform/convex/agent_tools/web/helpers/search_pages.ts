/**
 * Search crawled website pages using semantic similarity.
 *
 * Calls the internal embedding search action and formats results
 * for the LLM — deduplicating by URL and ordering by relevance.
 */

import type { ToolCtx } from '@convex-dev/agent';

import type { Id } from '../../../_generated/dataModel';

import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

const DEFAULT_LIMIT = 10;

interface SearchResult {
  url: string;
  title?: string;
  chunkContent: string;
  chunkIndex: number;
  score: number;
}

export async function searchPages(
  ctx: ToolCtx,
  args: { query: string },
): Promise<string> {
  const organizationId = ctx.organizationId;
  if (!organizationId) {
    throw new Error('search_pages requires organizationId in ToolCtx.');
  }

  debugLog('web:search_pages start', { query: args.query });

  const results: SearchResult[] = await ctx.runAction(
    internal.website_page_embeddings.internal_actions.search,
    {
      organizationId,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- organizationId is always a valid string; websiteId intentionally omitted to search all websites
      websiteId: undefined as Id<'websites'> | undefined,
      query: args.query,
      limit: DEFAULT_LIMIT,
    },
  );

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
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map((c) => c.chunkContent)
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
