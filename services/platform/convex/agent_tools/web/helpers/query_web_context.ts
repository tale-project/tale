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
import { formatWebResults } from './format_web_results';
import { getCrawlerServiceUrl } from './get_crawler_service_url';

const debugLog = createDebugLog('DEBUG_WEB_CONTEXT', '[WebContext]');

const DEFAULT_LIMIT = 10;
const DEFAULT_SIMILARITY_THRESHOLD = 0.51;
const WEB_CONTEXT_TIMEOUT_MS = 10_000;

interface SearchResult {
  url: string;
  title?: string;
  chunk_content: string;
  chunk_index: number;
  score: number;
  // Part B Phase 1+: empty for legacy rows, populated after crawler reindex.
  core_content?: string;
}

interface SearchApiResponse {
  query: string;
  results: SearchResult[];
  total: number;
}

interface WebContextCitation {
  index: number;
  type: 'web';
  source: string;
  url: string;
  relevance: number;
}

/**
 * Result from a web context query, containing both the formatted
 * text for injection and structured citation metadata.
 */
export interface WebContextResult {
  text: string;
  citations: WebContextCitation[];
}

/**
 * Query crawled website pages and return formatted context with citations.
 *
 * @returns Formatted context with citation metadata, or undefined if no results / on failure
 */
export async function queryWebContext(
  _ctx: ActionCtx,
  _organizationId: string,
  query: string,
  limit = DEFAULT_LIMIT,
): Promise<WebContextResult | undefined> {
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
        body: JSON.stringify({
          query,
          limit,
          similarity_threshold: DEFAULT_SIMILARITY_THRESHOLD,
        }),
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

      const pages = Array.from(byUrl.entries())
        .map(([url, chunks]) => {
          const bestScore = Math.max(...chunks.map((c) => c.score));
          const title = chunks[0].title ?? url;
          const content = chunks
            .sort((a, b) => a.chunk_index - b.chunk_index)
            .map((c) => c.core_content || c.chunk_content)
            .join('\n\n');

          return { title, url, score: bestScore, content };
        })
        .sort((a, b) => b.score - a.score);

      const webContext = formatWebResults(pages);
      if (!webContext) return undefined;

      const citations: WebContextCitation[] = pages.map((p, idx) => ({
        index: idx + 1,
        type: 'web' as const,
        source: p.title,
        url: p.url,
        relevance: p.score,
      }));

      debugLog('Web context retrieved', {
        resultCount: results.length,
        pageCount: byUrl.size,
        contextLength: webContext.length,
        citationCount: citations.length,
      });

      return { text: webContext, citations };
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
