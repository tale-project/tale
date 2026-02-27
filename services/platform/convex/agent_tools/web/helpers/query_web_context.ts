'use node';

/**
 * Web Context Query Helper
 *
 * Standalone helper for querying crawled website pages and returning
 * formatted context for injection into the agent's structured context.
 * Used when webSearchMode is 'context' or 'both'.
 */

import type { ActionCtx } from '../../../_generated/server';

import { createDebugLog } from '../../../lib/debug_log';
import { getCrawlerServiceUrl } from './get_crawler_service_url';

const debugLog = createDebugLog('DEBUG_WEB_CONTEXT', '[WebContext]');

const DEFAULT_LIMIT = 10;
const WEB_CONTEXT_TIMEOUT_MS = 10_000;

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

/**
 * Query crawled website pages and return formatted context string.
 *
 * @returns Formatted context string or undefined if no results / on failure
 */
export async function queryWebContext(
  _ctx: ActionCtx,
  _organizationId: string,
  query: string,
  limit = DEFAULT_LIMIT,
): Promise<string | undefined> {
  try {
    debugLog('Querying web context', {
      query: query.slice(0, 100),
      limit,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      WEB_CONTEXT_TIMEOUT_MS,
    );

    try {
      const crawlerUrl = getCrawlerServiceUrl();
      const response = await fetch(`${crawlerUrl}/api/v1/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error('[web_context] Search API error', {
          status: response.status,
        });
        return undefined;
      }

      const data: SearchApiResponse = await response.json();
      const results = data.results;

      if (!results || results.length === 0) {
        debugLog('No web context results', { query: query.slice(0, 100) });
        return undefined;
      }

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

      const webContext = formatted.join('\n\n---\n\n');

      debugLog('Web context retrieved', {
        resultCount: results.length,
        pageCount: byUrl.size,
        contextLength: webContext.length,
      });

      return webContext;
    } catch (fetchError) {
      clearTimeout(timeoutId);

      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        console.error('[web_context] Web search timeout', {
          timeoutMs: WEB_CONTEXT_TIMEOUT_MS,
        });
      } else {
        console.error('[web_context] Web search error', {
          error:
            fetchError instanceof Error
              ? fetchError.message
              : String(fetchError),
        });
      }
      return undefined;
    }
  } catch (error) {
    console.error('[web_context] Failed to query web context', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
