/**
 * RAG Context Query Helper
 *
 * Shared helper for querying the RAG service to get relevant context.
 * Used by chat agent to automatically retrieve context before responding.
 *
 * IMPROVEMENTS (P1):
 * - Context-aware query expansion: includes recent conversation context
 *   to resolve pronouns and maintain topic continuity
 */

import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { createDebugLog } from '../../lib/debug_log';
import {
  buildRagSearchFilters,
  type RagMetadataFilters,
} from '../../lib/helpers/rag_metadata_filters';
import {
  extractCitationsFromSearchResults,
  formatSearchResults,
  type ContextCitation,
  type SearchResult,
} from './format_search_results';

const debugLog = createDebugLog('DEBUG_RAG_QUERY', '[RAGQuery]');
const DEFAULT_TOP_K = 10;
const DEFAULT_SIMILARITY_THRESHOLD = 0.51;

// Query expansion constants
const MAX_CONTEXT_MESSAGES = 3; // Number of recent messages to include for context
const MAX_CONTEXT_CHARS = 500; // Max chars per context message

/**
 * Recent conversation message for context expansion.
 */
export interface RecentMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Check if the query likely contains unresolved references.
 * This helps determine if we need context expansion.
 */
function hasUnresolvedReferences(query: string): boolean {
  const lowered = query.toLowerCase();

  // Pronouns and demonstratives that suggest references to prior context
  const referencePatterns = [
    /\b(it|this|that|these|those|they|them|its|their)\b/i,
    /\b(the same|the one|the other|above|previous|mentioned|said)\b/i,
    /\b(他|她|它|这个|那个|这些|那些|上面|之前|刚才)\b/, // Chinese references
    /\b(그것|이것|저것|그|이|저)\b/, // Korean references
    /\b(それ|これ|あれ|その|この|あの)\b/, // Japanese references
  ];

  return referencePatterns.some((pattern) => pattern.test(lowered));
}

/**
 * Build an expanded query that includes conversation context.
 * This helps resolve pronouns and maintain topic continuity.
 */
function buildExpandedQuery(
  currentQuery: string,
  recentMessages?: RecentMessage[],
): string {
  // If no context or query is already long, use original
  if (!recentMessages || recentMessages.length === 0) {
    return currentQuery;
  }

  // If query doesn't seem to have unresolved references, skip expansion
  // (unless the query is very short, which might be ambiguous)
  if (!hasUnresolvedReferences(currentQuery) && currentQuery.length > 20) {
    return currentQuery;
  }

  // Build context from recent messages (most recent first, then reverse for chronological)
  const contextParts: string[] = [];
  let totalChars = 0;

  // Take up to MAX_CONTEXT_MESSAGES, preferring user messages for topic context
  const relevantMessages = recentMessages
    .slice(-MAX_CONTEXT_MESSAGES * 2) // Look at more messages
    .filter((m) => m.content && m.content.trim().length > 0);

  for (const msg of relevantMessages) {
    if (totalChars >= MAX_CONTEXT_CHARS * MAX_CONTEXT_MESSAGES) break;

    const truncated =
      msg.content.length > MAX_CONTEXT_CHARS
        ? msg.content.slice(0, MAX_CONTEXT_CHARS) + '...'
        : msg.content;

    contextParts.push(`${msg.role}: ${truncated}`);
    totalChars += truncated.length;
  }

  if (contextParts.length === 0) {
    return currentQuery;
  }

  // Format: provide context then the current query
  // This helps embedding models understand the full context
  const expandedQuery = `Previous conversation:
${contextParts.join('\n')}

Current question: ${currentQuery}`;

  debugLog('Query expanded with conversation context', {
    originalLength: currentQuery.length,
    expandedLength: expandedQuery.length,
    contextMessagesUsed: contextParts.length,
  });

  return expandedQuery;
}

/**
 * Result from a RAG context query, containing both the formatted
 * text for injection and structured citation metadata.
 */
export interface RagContextResult {
  text: string;
  citations: ContextCitation[];
}

/**
 * Options for RAG context queries.
 */
export interface RagContextOptions {
  /** File storage IDs to scope the search to */
  fileIds?: string[];
  /**
   * Optional pre-retrieval narrowing filters forwarded as the `/search`
   * `filters` object: hierarchical folder prefix + flat metadata
   * equality/IN filters. Narrowing-only — `fileIds` stays the
   * authorization boundary.
   */
  filters?: {
    folderPath?: string;
    metadata?: RagMetadataFilters;
  };
  /**
   * Org slug for the X-Tale-Org header. Required by the RAG service's
   * `/api/v1/search` endpoint (it picks the org's provider catalog to
   * embed the query). Empty / missing yields HTTP 400 from RAG and is
   * surfaced (not silently swallowed) so the caller sees the bug.
   */
  orgSlug: string;
}

/**
 * Query the RAG service for relevant context based on the user's message.
 * Returns formatted context string that can be injected into the agent's context.
 *
 * @param userMessage - The user's message to search for relevant context
 * @param topK - Number of results to return (default: 5)
 * @param similarityThreshold - Minimum similarity score (default: 0.51)
 * @param signal - Optional AbortSignal for timeout control
 * @param recentMessages - Optional recent conversation messages for context expansion
 * @param options - Optional multi-tenant options (userId, datasets)
 * @returns Formatted context string or undefined if no relevant results
 */
export async function queryRagContext(
  ctx: ActionCtx,
  userMessage: string,
  topK: number = DEFAULT_TOP_K,
  similarityThreshold: number = DEFAULT_SIMILARITY_THRESHOLD,
  signal?: AbortSignal,
  recentMessages?: RecentMessage[],
  // The type says orgSlug is required, but TS forces this parameter to
  // be optional because all preceding params have defaults. The runtime
  // assertion below (outside the outer try/catch) enforces it loudly.
  options: RagContextOptions = { orgSlug: '' },
): Promise<RagContextResult | undefined> {
  // Validate orgSlug up front, OUTSIDE the outer try/catch so the bug
  // surfaces as a real throw instead of being silently swallowed by the
  // graceful-degrade catch at the bottom of this function. A missing /
  // blank slug is a caller misconfiguration, not a runtime RAG outage.
  // (Round-3 P2 R7-P2-a — previously the empty-slug case hit ragFetch's
  // throw, fell into the catch, and returned undefined as if the search
  // had failed.)
  if (
    !options ||
    typeof options.orgSlug !== 'string' ||
    !options.orgSlug.trim()
  ) {
    throw new Error(
      'queryRagContext: options.orgSlug is required and must be non-empty',
    );
  }
  try {
    // Build expanded query with conversation context
    const expandedQuery = buildExpandedQuery(userMessage, recentMessages);

    debugLog('Querying RAG service for context', {
      userMessage: userMessage.slice(0, 100),
      expandedQueryLength: expandedQuery.length,
      hasContextExpansion: expandedQuery !== userMessage,
      topK,
    });

    try {
      if (!options.fileIds || options.fileIds.length === 0) {
        debugLog('No file IDs provided, skipping RAG query');
        return undefined;
      }

      // Folder-path narrowing maps to the action's `folderPath` arg.
      // NOTE: the `metadata` equality/IN filters that the old `/search`
      // `filters` object supported are not exposed by
      // `internal.rag.search.search` yet; only folder-path narrowing is
      // forwarded here (still narrowing-only — fileIds stays the
      // authorization boundary).
      const searchFilters = options.filters
        ? buildRagSearchFilters({
            folderPath: options.filters.folderPath,
            metadata: options.filters.metadata,
          })
        : undefined;

      // The RAG search logic now lives in a Convex internal action; the
      // HTTP call (and its AbortController timeout / abort signal) was
      // replaced by an in-process `ctx.runAction`. The action throws plain
      // Errors on failure, caught by the surrounding try/catch below.
      const searchResult = await ctx.runAction(internal.rag.search.search, {
        orgSlug: options.orgSlug,
        query: expandedQuery,
        fileIds: options.fileIds,
        topK,
        similarityThreshold,
        folderPath: searchFilters?.folder_path ?? null,
      });

      // Normalize the action's `file_id` / `filename` (`string | null`) to
      // the `SearchResult` optional-`string` shape the formatter expects.
      const results: SearchResult[] = searchResult.results.map((r) => {
        const mapped: SearchResult = {
          content: r.content,
          score: r.score,
          source_created_at: r.source_created_at,
          source_modified_at: r.source_modified_at,
        };
        if (r.file_id != null) mapped.file_id = r.file_id;
        if (r.filename != null) mapped.filename = r.filename;
        return mapped;
      });

      if (results.length === 0) {
        debugLog('No relevant RAG context found', {
          total_results: results.length,
        });
        return undefined;
      }

      const ragContext = formatSearchResults(results);
      if (!ragContext) return undefined;

      const citations = extractCitationsFromSearchResults(results);

      debugLog('RAG context retrieved', {
        resultCount: results.length,
        contextLength: ragContext.length,
        citationCount: citations.length,
      });

      return { text: ragContext, citations };
    } catch (fetchError) {
      console.error('[rag_query] RAG service fetch error', {
        error:
          fetchError instanceof Error ? fetchError.message : String(fetchError),
      });
      return undefined; // Gracefully degrade on fetch error
    }
  } catch (error) {
    console.error('[rag_query] Failed to query RAG service', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined; // Gracefully degrade on error
  }
}
