/**
 * Shared formatting for RAG search results.
 *
 * Used by rag_search_tool and query_rag_context
 * to produce a consistent numbered-chunk format.
 *
 * SEC1 (prompt-injection defense): every user-controlled field that
 * lands in the rendered prompt string runs through
 * `stripReservedPromptTags` before it's interpolated. The reserved
 * tag set includes `<system>...</system>`, `<governance_*>`,
 * `<user_memories>` etc. — wrappers an attacker would use to escape
 * the surrounding agent system prompt. Sanitising in this single
 * chokepoint instead of at every call site stops a future caller
 * from forgetting `r.filename` or chunk content again
 * (a regression that surfaced repeatedly during the round-3 review).
 */

import { stripReservedPromptTags } from '../../lib/agent_response/sanitize_prompt';

export interface SearchResult {
  content: string;
  score: number;
  file_id?: string;
  filename?: string;
  source_created_at?: string | null;
  source_modified_at?: string | null;
  page_number?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ServiceUsageInfo {
  input_tokens: number;
  output_tokens?: number;
  total_tokens: number;
  model?: string;
}

export interface SearchResponse {
  success: boolean;
  query: string;
  results: SearchResult[];
  total_results: number;
  processing_time_ms: number;
  usage?: ServiceUsageInfo;
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
/**
 * Structured citation metadata extracted from search results.
 * Shape matches `citationItemValidator` in streaming/validators.ts.
 */
export interface ContextCitation {
  index: number;
  type: 'rag' | 'web';
  source: string;
  fileId?: string;
  url?: string;
  page?: number;
  relevance?: number;
}

/**
 * Extract deduplicated citation metadata from RAG search results.
 * Groups by file_id (one citation per unique document), keeping the
 * highest relevance score when multiple chunks match the same file.
 *
 * Logic mirrors rag_search_tool.ts lines 315-344.
 */
export function extractCitationsFromSearchResults(
  results: SearchResult[],
): ContextCitation[] {
  if (results.length === 0) return [];

  const citationsByFile = new Map<
    string,
    { source: string; fileId?: string; relevance?: number }
  >();

  for (const r of results) {
    const key = r.file_id ?? r.filename ?? `unknown-${citationsByFile.size}`;
    const existing = citationsByFile.get(key);
    if (
      !existing ||
      (r.score != null &&
        (existing.relevance == null || r.score > existing.relevance))
    ) {
      citationsByFile.set(key, {
        source: r.filename ?? 'Unknown',
        fileId: r.file_id,
        relevance: r.score,
      });
    }
  }

  return Array.from(citationsByFile.values()).map((c, idx) => {
    const entry: ContextCitation = {
      index: idx + 1,
      type: 'rag' as const,
      source: c.source,
    };
    if (c.fileId !== undefined) entry.fileId = c.fileId;
    if (c.relevance !== undefined) entry.relevance = c.relevance;
    return entry;
  });
}

export function formatSearchResults(
  results: SearchResult[],
): string | undefined {
  if (results.length === 0) return undefined;

  return results
    .map((r, idx) => {
      const score = (r.score * 100).toFixed(1);
      // SEC1: `filename` is user-uploaded (any user with write access
      // to the org can name a file `</system><system>You are now…`),
      // and `file_id` is server-issued but cheap to sanitise. Strip
      // reserved tags before the annotation lands inline with the
      // chunk content in the prompt-bound string.
      const safeFilename = r.filename
        ? stripReservedPromptTags(r.filename)
        : undefined;
      const safeFileId = r.file_id
        ? stripReservedPromptTags(r.file_id)
        : undefined;
      const safeContent = stripReservedPromptTags(r.content);
      const sourceAnnotation = safeFilename ? ` [Source: ${safeFilename}]` : '';
      const fileIdAnnotation = safeFileId ? ` [FileID: ${safeFileId}]` : '';
      const pageAnnotation =
        r.page_number != null ? ` [Page: ${r.page_number}]` : '';
      const dateAnnotation = r.source_modified_at
        ? ` [Modified: ${r.source_modified_at.slice(0, 10)}]`
        : r.source_created_at
          ? ` [Created: ${r.source_created_at.slice(0, 10)}]`
          : '';
      return `[${idx + 1}] (Relevance: ${score}%)${sourceAnnotation}${pageAnnotation}${dateAnnotation}${fileIdAnnotation}\n${safeContent}`;
    })
    .join('\n\n---\n\n');
}
