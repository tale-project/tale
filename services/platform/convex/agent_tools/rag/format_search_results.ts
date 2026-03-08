/**
 * Shared formatting for RAG search results.
 *
 * Used by rag_search_tool and query_rag_context
 * to produce a consistent numbered-chunk format.
 */

export interface SearchResult {
  content: string;
  score: number;
  document_id?: string;
  filename?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchResponse {
  success: boolean;
  query: string;
  results: SearchResult[];
  total_results: number;
  processing_time_ms: number;
}

/**
 * Format search results into a numbered list with relevance scores.
 *
 * Example output:
 * ```
 * [1] (Relevance: 87.3%)
 * <chunk content>
 *
 * ---
 *
 * [2] (Relevance: 72.1%)
 * <chunk content>
 * ```
 *
 * Returns `undefined` when there are no results.
 */
export function formatSearchResults(
  results: SearchResult[],
): string | undefined {
  if (results.length === 0) return undefined;

  return results
    .map((r, idx) => {
      const score = (r.score * 100).toFixed(1);
      return `[${idx + 1}] (Relevance: ${score}%)\n${r.content}`;
    })
    .join('\n\n---\n\n');
}
