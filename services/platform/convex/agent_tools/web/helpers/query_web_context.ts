'use node';

/**
 * Web Context Query Helper
 *
 * Standalone helper for querying crawled website pages and returning
 * formatted context for injection into the agent's structured context.
 * Used when webSearchMode is 'context' or 'both'.
 */

import { internal } from '../../../_generated/api';
import type { ActionCtx } from '../../../_generated/server';
import { createDebugLog } from '../../../lib/debug_log';
import { orgSlugFromId } from '../../../lib/helpers/org_slug';
import { formatWebResults } from './format_web_results';

const debugLog = createDebugLog('DEBUG_WEB_CONTEXT', '[WebContext]');

const DEFAULT_LIMIT = 10;
const DEFAULT_SIMILARITY_THRESHOLD = 0.51;

interface SearchResult {
  url: string;
  title: string | null;
  chunk_content: string;
  chunk_index: number;
  score: number;
  // Part B Phase 1+: empty for legacy rows, populated after crawler reindex.
  core_content: string;
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
  ctx: ActionCtx,
  organizationId: string,
  query: string,
  limit = DEFAULT_LIMIT,
): Promise<WebContextResult | undefined> {
  try {
    // Resolve the slug INSIDE the try so an org-lookup failure folds
    // into the documented `undefined`-on-failure contract instead of
    // throwing past the caller (`generate_response.ts`).
    const orgSlug = await orgSlugFromId(ctx, organizationId);
    debugLog('Querying web context', {
      query: query.slice(0, 100),
      limit,
    });

    try {
      // The crawler search logic now lives in a Convex internal action; the
      // network call (and its AbortController timeout) was replaced by an
      // in-process `ctx.runAction`. The action throws plain Errors on
      // failure, caught by the surrounding try/catch below → `undefined`.
      const { results } = await ctx.runAction(internal.crawler.search.search, {
        orgSlug,
        query,
        limit,
        similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
      });

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
      console.error('[web_context] Web search error', {
        error:
          fetchError instanceof Error ? fetchError.message : String(fetchError),
      });
      return undefined;
    }
  } catch (error) {
    console.error('[web_context] Failed to query web context', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
