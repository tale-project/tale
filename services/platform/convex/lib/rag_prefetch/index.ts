'use node';

/**
 * RAG Search Prefetch Module
 *
 * Provides non-blocking prefetch of RAG search results.
 * The prefetch is triggered at the start of generateAgentResponse,
 * and the first rag_search tool call uses the prefetched result.
 */

import type { ActionCtx } from '../../_generated/server';
import { components } from '../../_generated/api';
import { listMessages } from '@convex-dev/agent';
import { createDebugLog } from '../debug_log';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[RagPrefetch]');

// Configuration constants
const DEFAULT_RAG_SERVICE_URL = 'http://localhost:8001';
const DEFAULT_TOP_K = 5;
const DEFAULT_SIMILARITY_THRESHOLD = 0.3;
const RAG_REQUEST_TIMEOUT_MS = 10000;

// Query expansion constants
const MAX_CONTEXT_MESSAGES = 3;
const MAX_CONTEXT_CHARS = 500;

interface SearchResult {
  content: string;
  score: number;
  document_id?: string;
  metadata?: Record<string, unknown>;
}

export interface QueryResponse {
  success: boolean;
  query: string;
  results: SearchResult[];
  total_results: number;
  processing_time_ms: number;
}

interface RecentMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * RAG prefetch cache object.
 * Attached to the action context and passed to tools.
 */
export interface RagPrefetchCache {
  /** The Promise that resolves to the RAG search result */
  promise: Promise<QueryResponse>;
  /** Whether this cache has been consumed (first call sets this to true) */
  consumed: boolean;
  /** Timestamp when the prefetch was started */
  timestamp: number;
}

function getRagServiceUrl(): string {
  return process.env.RAG_URL || DEFAULT_RAG_SERVICE_URL;
}

/**
 * Check if the query likely contains unresolved references.
 */
function hasUnresolvedReferences(query: string): boolean {
  const lowered = query.toLowerCase();
  const referencePatterns = [
    /\b(it|this|that|these|those|they|them|its|their)\b/i,
    /\b(the same|the one|the other|above|previous|mentioned|said)\b/i,
    /\b(他|她|它|这个|那个|这些|那些|上面|之前|刚才)\b/,
    /\b(그것|이것|저것|그|이|저)\b/,
    /\b(それ|これ|あれ|その|この|あの)\b/,
  ];
  return referencePatterns.some((pattern) => pattern.test(lowered));
}

/**
 * Build an expanded query that includes conversation context.
 */
function buildExpandedQuery(
  currentQuery: string,
  recentMessages?: RecentMessage[],
): string {
  if (!recentMessages || recentMessages.length === 0) {
    return currentQuery;
  }

  if (!hasUnresolvedReferences(currentQuery) && currentQuery.length > 20) {
    return currentQuery;
  }

  const contextParts: string[] = [];
  let totalChars = 0;

  const relevantMessages = recentMessages
    .slice(-MAX_CONTEXT_MESSAGES * 2)
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

  return `Previous conversation:
${contextParts.join('\n')}

Current question: ${currentQuery}`;
}

/**
 * Fetch recent messages from the thread for context expansion.
 */
async function getRecentMessagesForPrefetch(
  ctx: ActionCtx,
  threadId: string,
  limit = 6,
): Promise<RecentMessage[]> {
  try {
    const messagesResult = await listMessages(ctx, components.agent, {
      threadId,
      paginationOpts: { cursor: null, numItems: limit },
      excludeToolMessages: true,
    });

    return messagesResult.page
      .filter((m) => m.message?.role === 'user' || m.message?.role === 'assistant')
      .map((m) => ({
        role: m.message!.role as 'user' | 'assistant',
        content: typeof m.message!.content === 'string'
          ? m.message!.content
          : '',
      }))
      .filter((m) => m.content.length > 0)
      .reverse();
  } catch (error) {
    debugLog('Failed to get recent messages for prefetch', {
      threadId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Fetch RAG search results from the RAG service.
 */
async function fetchRagResults(options: {
  query: string;
  teamIds: string[];
  userId: string;
  top_k: number;
  similarity_threshold?: number;
}): Promise<QueryResponse> {
  const ragServiceUrl = getRagServiceUrl();
  const url = `${ragServiceUrl}/api/v1/search`;

  const payload = {
    query: options.query,
    top_k: options.top_k,
    similarity_threshold: options.similarity_threshold ?? DEFAULT_SIMILARITY_THRESHOLD,
    include_metadata: true,
    user_id: options.userId,
    team_ids: options.teamIds,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RAG_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`RAG service error: ${response.status} ${errorText}`);
    }

    return (await response.json()) as QueryResponse;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export interface StartRagPrefetchOptions {
  ctx: ActionCtx;
  threadId: string;
  userMessage: string;
  userId: string;
  userTeamIds: string[];
  top_k?: number;
}

/**
 * Start RAG search prefetch.
 *
 * This function returns IMMEDIATELY (non-blocking).
 * All async operations (fetching recent messages, building query, calling RAG service)
 * happen inside the returned Promise.
 *
 * @returns A cache object containing:
 *   - promise: The Promise that resolves to QueryResponse
 *   - consumed: false (set to true after first use)
 *   - timestamp: When the prefetch was started
 */
export function startRagPrefetch(options: StartRagPrefetchOptions): RagPrefetchCache {
  const top_k = options.top_k ?? DEFAULT_TOP_K;

  const promise = (async (): Promise<QueryResponse> => {
    debugLog('RAG prefetch started', {
      threadId: options.threadId,
      userMessage: options.userMessage.substring(0, 100),
    });

    // 1. Get recent messages for context expansion
    const recentMessages = await getRecentMessagesForPrefetch(
      options.ctx,
      options.threadId,
    );

    // 2. Build expanded query with conversation context
    const expandedQuery = buildExpandedQuery(
      options.userMessage,
      recentMessages,
    );

    // 3. Use team IDs directly - RAG service converts them to datasets internally
    const teamIds = options.userTeamIds;

    debugLog('RAG prefetch executing', {
      expandedQueryLength: expandedQuery.length,
      hasContextExpansion: expandedQuery !== options.userMessage,
      teamIds,
      top_k,
    });

    // 4. Fetch RAG results
    try {
      const result = await fetchRagResults({
        query: expandedQuery,
        teamIds,
        userId: options.userId,
        top_k,
      });

      debugLog('RAG prefetch completed', {
        success: result.success,
        total_results: result.total_results,
        processing_time_ms: result.processing_time_ms,
      });

      return result;
    } catch (fetchError) {
      // RAG prefetch is non-critical - return empty result on failure
      // This prevents the entire chat from failing when RAG service is unavailable
      debugLog('RAG prefetch failed (non-fatal)', {
        error: fetchError instanceof Error ? fetchError.message : String(fetchError),
      });

      return {
        success: false,
        query: expandedQuery,
        results: [],
        total_results: 0,
        processing_time_ms: 0,
      };
    }
  })();

  return {
    promise,
    consumed: false,
    timestamp: Date.now(),
  };
}
