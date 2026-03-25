/**
 * Shared formatting for RAG search results.
 *
 * Used by rag_search_tool and query_rag_context
 * to produce a consistent numbered-chunk format.
 */

export interface SearchResult {
  content: string;
  score: number;
  file_id?: string;
  filename?: string;
  source_created_at?: string | null;
  source_modified_at?: string | null;
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
 * [1] (Relevance: 87.3%) [Source: report.pdf] [Modified: 2023-06-15] [FileID: doc-123]
 * <chunk content>
 *
 * ---
 *
 * [2] (Relevance: 72.1%) [Source: memo.docx] [Created: 2024-01-01] [FileID: doc-456]
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
      const sourceAnnotation = r.filename ? ` [Source: ${r.filename}]` : '';
      const fileIdAnnotation = r.file_id ? ` [FileID: ${r.file_id}]` : '';
      const dateAnnotation = r.source_modified_at
        ? ` [Modified: ${r.source_modified_at.slice(0, 10)}]`
        : r.source_created_at
          ? ` [Created: ${r.source_created_at.slice(0, 10)}]`
          : '';
      return `[${idx + 1}] (Relevance: ${score}%)${sourceAnnotation}${dateAnnotation}${fileIdAnnotation}\n${r.content}`;
    })
    .join('\n\n---\n\n');
}
