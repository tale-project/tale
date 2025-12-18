/**
 * RAG Context Query Helper
 *
 * Shared helper for querying the RAG service to get relevant context.
 * Used by chat agent to automatically retrieve context before responding.
 */

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[ChatAgent]');

// Configuration constants
const DEFAULT_RAG_SERVICE_URL = 'http://localhost:8001';
const DEFAULT_TOP_K = 5;
const DEFAULT_SIMILARITY_THRESHOLD = 0.3;
const RAG_REQUEST_TIMEOUT_MS = 10000; // 10 seconds

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
 * Get RAG service URL from environment variables
 */
function getRagServiceUrl(): string {
  return process.env.RAG_URL || DEFAULT_RAG_SERVICE_URL;
}

/**
 * Query the RAG service for relevant context based on the user's message.
 * Returns formatted context string that can be injected into the agent's context.
 *
 * @param userMessage - The user's message to search for relevant context
 * @param topK - Number of results to return (default: 5)
 * @param similarityThreshold - Minimum similarity score (default: 0.3)
 * @param signal - Optional AbortSignal for timeout control
 * @returns Formatted context string or undefined if no relevant results
 */
export async function queryRagContext(
  userMessage: string,
  topK: number = DEFAULT_TOP_K,
  similarityThreshold: number = DEFAULT_SIMILARITY_THRESHOLD,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const ragServiceUrl = getRagServiceUrl();
    const url = `${ragServiceUrl}/api/v1/search`;

    debugLog('Querying RAG service for context', {
      userMessage: userMessage.substring(0, 100),
      topK,
      ragServiceUrl,
    });

    // Create abort controller for timeout if no signal provided
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RAG_REQUEST_TIMEOUT_MS);
    const fetchSignal = signal || controller.signal;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: userMessage,
          top_k: topK,
          similarity_threshold: similarityThreshold,
          include_metadata: true,
        }),
        signal: fetchSignal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[chat_agent] RAG service error', {
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
        console.error('[chat_agent] RAG service request timeout', {
          timeoutMs: RAG_REQUEST_TIMEOUT_MS,
        });
      } else {
        console.error('[chat_agent] RAG service fetch error', {
          error: fetchError instanceof Error ? fetchError.message : String(fetchError),
        });
      }
      return undefined; // Gracefully degrade on fetch error
    }
  } catch (error) {
    console.error('[chat_agent] Failed to query RAG service', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined; // Gracefully degrade on error
  }
}

