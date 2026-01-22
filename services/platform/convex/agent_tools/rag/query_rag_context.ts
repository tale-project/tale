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

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_RAG_QUERY', '[RAGQuery]');

// Configuration constants
const DEFAULT_RAG_SERVICE_URL = 'http://localhost:8001';
const DEFAULT_TOP_K = 10;
const DEFAULT_SIMILARITY_THRESHOLD = 0.3;
const RAG_REQUEST_TIMEOUT_MS = 10000; // 10 seconds

// Query expansion constants
const MAX_CONTEXT_MESSAGES = 3; // Number of recent messages to include for context
const MAX_CONTEXT_CHARS = 500; // Max chars per context message

interface SearchResult {
  content: string;
  score: number;
  document_id?: string;
  metadata?: Record<string, unknown>;
}

interface QueryResponse {
  success: boolean;
  query: string;
  results: SearchResult[];
  total_results: number;
  processing_time_ms: number;
}

/**
 * Recent conversation message for context expansion.
 */
export interface RecentMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Get RAG service URL from environment variables
 */
function getRagServiceUrl(): string {
  return process.env.RAG_URL || DEFAULT_RAG_SERVICE_URL;
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
        ? msg.content.substring(0, MAX_CONTEXT_CHARS) + '...'
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
 * Options for multi-tenant RAG context queries.
 */
export interface RagContextOptions {
  /** User ID for multi-tenant search */
  userId?: string;
  /** List of dataset names to search within */
  datasets?: string[];
}

/**
 * Query the RAG service for relevant context based on the user's message.
 * Returns formatted context string that can be injected into the agent's context.
 *
 * @param userMessage - The user's message to search for relevant context
 * @param topK - Number of results to return (default: 5)
 * @param similarityThreshold - Minimum similarity score (default: 0.3)
 * @param signal - Optional AbortSignal for timeout control
 * @param recentMessages - Optional recent conversation messages for context expansion
 * @param options - Optional multi-tenant options (userId, datasets)
 * @returns Formatted context string or undefined if no relevant results
 */
export async function queryRagContext(
  userMessage: string,
  topK: number = DEFAULT_TOP_K,
  similarityThreshold: number = DEFAULT_SIMILARITY_THRESHOLD,
  signal?: AbortSignal,
  recentMessages?: RecentMessage[],
  options?: RagContextOptions,
): Promise<string | undefined> {
  try {
    const ragServiceUrl = getRagServiceUrl();
    const url = `${ragServiceUrl}/api/v1/search`;

    // Build expanded query with conversation context
    const expandedQuery = buildExpandedQuery(userMessage, recentMessages);

    debugLog('Querying RAG service for context', {
      userMessage: userMessage.substring(0, 100),
      expandedQueryLength: expandedQuery.length,
      hasContextExpansion: expandedQuery !== userMessage,
      topK,
      ragServiceUrl,
    });

    // Create abort controller for timeout if no signal provided
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      RAG_REQUEST_TIMEOUT_MS,
    );
    const fetchSignal = signal || controller.signal;

    try {
      // Build request payload with multi-tenant support
      const requestPayload: Record<string, unknown> = {
        query: expandedQuery,
        top_k: topK,
        similarity_threshold: similarityThreshold,
        include_metadata: true,
      };

      // Add multi-tenant parameters if provided
      if (options?.userId) {
        requestPayload.user_id = options.userId;
      }
      if (options?.datasets && options.datasets.length > 0) {
        requestPayload.datasets = options.datasets;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
        signal: fetchSignal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[rag_query] RAG service error', {
          status: response.status,
          error: errorText,
        });
        return undefined; // Gracefully degrade if RAG is unavailable
      }

      const result = (await response.json()) as QueryResponse;

      if (!result.success || result.total_results === 0) {
        debugLog('No relevant RAG context found', {
          success: result.success,
          total_results: result.total_results,
        });
        return undefined;
      }

      // Format the RAG results into a context string
      const contextParts = result.results.map((r, idx) => {
        const score = (r.score * 100).toFixed(1);
        return `[${idx + 1}] (Relevance: ${score}%)\n${r.content}`;
      });

      const ragContext = contextParts.join('\n\n---\n\n');

      debugLog('RAG context retrieved', {
        resultCount: result.total_results,
        contextLength: ragContext.length,
        processingTimeMs: result.processing_time_ms,
      });

      return ragContext;
    } catch (fetchError) {
      clearTimeout(timeoutId);

      // Handle timeout specifically
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        console.error('[rag_query] RAG service request timeout', {
          timeoutMs: RAG_REQUEST_TIMEOUT_MS,
        });
      } else {
        console.error('[rag_query] RAG service fetch error', {
          error:
            fetchError instanceof Error ? fetchError.message : String(fetchError),
        });
      }
      return undefined; // Gracefully degrade on fetch error
    }
  } catch (error) {
    console.error('[rag_query] Failed to query RAG service', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined; // Gracefully degrade on error
  }
}
