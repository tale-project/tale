'use node';

/**
 * RAG Generate Prefetch Module
 *
 * Provides non-blocking prefetch of RAG generation results.
 * The prefetch is triggered at the start of generateAgentResponse,
 * and the first rag_search tool call uses the prefetched result.
 */

import { listMessages } from '@convex-dev/agent';

import type { ActionCtx } from '../../_generated/server';

import { components } from '../../_generated/api';
import { createDebugLog } from '../debug_log';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[RagPrefetch]');

const DEFAULT_RAG_SERVICE_URL = 'http://localhost:8001';
const RAG_REQUEST_TIMEOUT_MS = 30000;

const MAX_CONTEXT_MESSAGES = 3;
const MAX_CONTEXT_CHARS = 500;

interface RagServiceResponse {
  success: boolean;
  query: string;
  response: string;
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
  /** The Promise that resolves to the generated response string */
  promise: Promise<string>;
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
        ? msg.content.slice(0, MAX_CONTEXT_CHARS) + '...'
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
      .filter(
        (m) => m.message?.role === 'user' || m.message?.role === 'assistant',
      )
      .map((m) => ({
        role: m.message?.role as 'user' | 'assistant',
        content:
          typeof m.message?.content === 'string' ? m.message.content : '',
      }))
      .filter((m) => m.content.length > 0)
      .toReversed();
  } catch (error) {
    debugLog('Failed to get recent messages for prefetch', {
      threadId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Fetch RAG generation results from the RAG service.
 */
async function fetchRagGenerate(options: {
  query: string;
  teamIds: string[];
  userId: string;
}): Promise<string> {
  const ragServiceUrl = getRagServiceUrl();
  const url = `${ragServiceUrl}/api/v1/generate`;

  const payload = {
    query: options.query,
    user_id: options.userId,
    team_ids: options.teamIds,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    RAG_REQUEST_TIMEOUT_MS,
  );

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

    const result = (await response.json()) as RagServiceResponse;
    return result.response;
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
}

/**
 * Start RAG generate prefetch.
 *
 * This function returns IMMEDIATELY (non-blocking).
 * All async operations (fetching recent messages, building query, calling RAG service)
 * happen inside the returned Promise.
 *
 * @returns A cache object containing:
 *   - promise: The Promise that resolves to the generated response string
 *   - consumed: false (set to true after first use)
 *   - timestamp: When the prefetch was started
 */
export function startRagPrefetch(
  options: StartRagPrefetchOptions,
): RagPrefetchCache {
  const promise = (async (): Promise<string> => {
    debugLog('RAG prefetch started', {
      threadId: options.threadId,
      userMessage: options.userMessage.slice(0, 100),
    });

    const recentMessages = await getRecentMessagesForPrefetch(
      options.ctx,
      options.threadId,
    );

    const expandedQuery = buildExpandedQuery(
      options.userMessage,
      recentMessages,
    );

    const teamIds = options.userTeamIds;
    if (teamIds.length === 0) {
      debugLog('RAG prefetch skipped: no team IDs', {
        threadId: options.threadId,
      });
      return '';
    }

    debugLog('RAG prefetch executing', {
      expandedQueryLength: expandedQuery.length,
      hasContextExpansion: expandedQuery !== options.userMessage,
      teamIds,
    });

    try {
      const response = await fetchRagGenerate({
        query: expandedQuery,
        teamIds,
        userId: options.userId,
      });

      debugLog('RAG prefetch completed', {
        responseLength: response.length,
      });

      return response;
    } catch (fetchError) {
      debugLog('RAG prefetch failed (non-fatal)', {
        error:
          fetchError instanceof Error ? fetchError.message : String(fetchError),
      });
      return '';
    }
  })();

  return {
    promise,
    consumed: false,
    timestamp: Date.now(),
  };
}
