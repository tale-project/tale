'use node';

/**
 * Web Context Query Helper
 *
 * Standalone helper for querying crawled website pages and returning
 * formatted context for injection into the agent's structured context.
 * Used when webSearchMode is 'context' or 'both'.
 */

import type { ActionCtx } from '../../../_generated/server';

import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_WEB_CONTEXT', '[WebContext]');

const DEFAULT_LIMIT = 10;
const WEB_CONTEXT_TIMEOUT_MS = 10_000;

interface SearchResult {
  url: string;
  title?: string;
  chunkContent: string;
  chunkIndex: number;
  score: number;
}

/**
 * Query crawled website pages and return formatted context string.
 *
 * @returns Formatted context string or undefined if no results / on failure
 */
export async function queryWebContext(
  ctx: ActionCtx,
  organizationId: string,
  query: string,
  limit = DEFAULT_LIMIT,
): Promise<string | undefined> {
  try {
    debugLog('Querying web context', {
      query: query.slice(0, 100),
      organizationId,
      limit,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      WEB_CONTEXT_TIMEOUT_MS,
    );

    try {
      const results: SearchResult[] = await ctx.runAction(
        internal.website_page_embeddings.internal_actions.search,
        { organizationId, query, limit },
      );

      clearTimeout(timeoutId);

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
