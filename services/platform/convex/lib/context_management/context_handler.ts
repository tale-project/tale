/**
 * Context Handler for Message Ordering
 *
 * SDK DEFAULT ORDER (problematic):
 *   search -> conversationHistory -> systemContext -> currentUserMessage -> existingResponses
 *
 * OUR REORDERED (correct):
 *   systemContext -> search -> conversationHistory -> currentUserMessage -> existingResponses
 *
 * WHY REORDER:
 * The SDK places our injected system context ([SYSTEM], [CONTEXT], [KNOWLEDGE BASE])
 * AFTER the conversation history, which can confuse the model into thinking
 * these are mid-conversation messages rather than system-level context.
 *
 * By placing systemContext first, the model clearly understands:
 * 1. System context comes first (thread ID, summary, RAG results, integrations)
 * 2. Search results (if vector search is enabled)
 * 3. Conversation history in chronological order
 * 4. Current user message at the end
 * 5. Any existing responses (for continuation scenarios)
 *
 * SMART HISTORY SELECTION:
 * Additionally applies token-budget-based filtering to conversation history,
 * skipping large tool results when necessary to fit within context limits.
 */

import type { ModelMessage } from '@ai-sdk/provider-utils';
import { estimateMessagesTokens, estimateMessageTokens } from './estimate_tokens';
import {
  DEFAULT_MODEL_CONTEXT_LIMIT,
  CONTEXT_SAFETY_MARGIN,
  SYSTEM_INSTRUCTIONS_TOKENS,
  OUTPUT_RESERVE,
  LARGE_MESSAGE_THRESHOLD,
} from './constants';
import { createDebugLog } from '../debug_log';

const debugLog = createDebugLog('DEBUG_CONTEXT_MANAGEMENT', '[ContextHandler]');

/**
 * SDK callback arguments - we must use SDK's parameter names here.
 */
export interface ContextHandlerArgs {
  allMessages: ModelMessage[];
  search: ModelMessage[];
  recent: ModelMessage[];
  inputMessages: ModelMessage[]; // SDK name - semantically: systemContext
  inputPrompt: ModelMessage[]; // SDK name - semantically: currentUserMessage
  existingResponses: ModelMessage[];
  userId: string | undefined;
  threadId: string | undefined;
}

/**
 * Context handler type compatible with SDK.
 */
export type ContextHandler = (
  ctx: unknown,
  args: ContextHandlerArgs,
) => Promise<ModelMessage[]>;

/**
 * Options for creating a context handler.
 */
export interface ContextHandlerOptions {
  /** Model context limit in tokens */
  modelContextLimit?: number;
  /** Safety margin for context limit (0-1) */
  safetyMargin?: number;
  /** Reserved tokens for output */
  outputReserve?: number;
  /** Minimum number of recent messages to keep */
  minRecentMessages?: number;
}

/**
 * Apply smart filtering to conversation history based on token budget.
 *
 * Strategy:
 * 1. Calculate available budget for history
 * 2. Keep messages that fit within budget
 * 3. Skip large tool results when budget is tight
 * 4. Always keep at least the most recent few messages
 */
function filterHistoryByBudget(
  conversationHistory: ModelMessage[],
  otherTokens: number,
  options?: ContextHandlerOptions,
): { filtered: ModelMessage[]; skippedCount: number } {
  const modelContextLimit = options?.modelContextLimit ?? DEFAULT_MODEL_CONTEXT_LIMIT;
  const safetyMargin = options?.safetyMargin ?? CONTEXT_SAFETY_MARGIN;
  const outputReserve = options?.outputReserve ?? OUTPUT_RESERVE;
  const minRecentMessages = options?.minRecentMessages ?? 4;

  // Calculate budget for history
  const totalBudget = modelContextLimit * safetyMargin;
  const historyBudget = totalBudget - otherTokens - SYSTEM_INSTRUCTIONS_TOKENS - outputReserve;

  if (historyBudget <= 0) {
    debugLog('No budget for history, keeping minimal', { otherTokens, historyBudget });
    // Keep at least the last 2 messages
    return {
      filtered: conversationHistory.slice(-2),
      skippedCount: Math.max(0, conversationHistory.length - 2),
    };
  }

  const filtered: ModelMessage[] = [];
  let usedTokens = 0;
  let skippedCount = 0;

  // Process from newest to oldest (history is in chronological order, so reverse)
  const reversed = [...conversationHistory].reverse();

  for (let i = 0; i < reversed.length; i++) {
    const msg = reversed[i];
    const msgTokens = estimateMessageTokens(msg);
    const isToolMessage = msg.role === 'tool';
    const isLarge = msgTokens > LARGE_MESSAGE_THRESHOLD;

    // Always keep the most recent N messages regardless of size
    const isRecentMust = i < minRecentMessages;

    if (isRecentMust) {
      filtered.unshift(msg); // Add to front to maintain order
      usedTokens += msgTokens;
      continue;
    }

    // Check if this large tool message should be skipped
    if (isLarge && isToolMessage) {
      const remainingBudget = historyBudget - usedTokens;
      // Skip if it would use more than 30% of remaining budget
      if (msgTokens > remainingBudget * 0.3) {
        skippedCount++;
        debugLog('Skipping large tool message', {
          msgTokens,
          remainingBudget,
          index: i,
        });
        continue;
      }
    }

    // Check if we have budget
    if (usedTokens + msgTokens > historyBudget) {
      skippedCount++;
      continue;
    }

    filtered.unshift(msg); // Add to front to maintain order
    usedTokens += msgTokens;
  }

  return { filtered, skippedCount };
}

/**
 * Creates a context handler that reorders messages for optimal LLM understanding.
 * Also applies smart history filtering to stay within token budgets.
 */
export function createContextHandler(options?: ContextHandlerOptions): ContextHandler {
  return async (_ctx: unknown, args: ContextHandlerArgs): Promise<ModelMessage[]> => {
    // Rename SDK parameters to semantic names for clarity
    const systemContext = args.inputMessages;
    const searchResults = args.search;
    const conversationHistory = args.recent;
    const currentUserMessage = args.inputPrompt;
    const { existingResponses } = args;

    debugLog('Composing context messages', {
      systemContextCount: systemContext.length,
      searchResultsCount: searchResults.length,
      conversationHistoryCount: conversationHistory.length,
      currentUserMessageCount: currentUserMessage.length,
      existingResponsesCount: existingResponses.length,
    });

    // Calculate tokens used by non-history components
    const systemContextTokens = estimateMessagesTokens(systemContext);
    const searchTokens = estimateMessagesTokens(searchResults);
    const currentPromptTokens = estimateMessagesTokens(currentUserMessage);
    const existingResponsesTokens = estimateMessagesTokens(existingResponses);
    const otherTokens = systemContextTokens + searchTokens + currentPromptTokens + existingResponsesTokens;

    // Apply smart history filtering
    const { filtered: filteredHistory, skippedCount } = filterHistoryByBudget(
      conversationHistory,
      otherTokens,
      options,
    );

    if (skippedCount > 0) {
      debugLog('Smart history filtering applied', {
        originalCount: conversationHistory.length,
        filteredCount: filteredHistory.length,
        skippedCount,
      });
    }

    // Reorder: system context first, then search, filtered history, current message
    const reorderedMessages: ModelMessage[] = [
      ...systemContext, // [SYSTEM], [CONTEXT], [KNOWLEDGE BASE], [INTEGRATIONS]
      ...searchResults, // Vector/text search results (if enabled)
      ...filteredHistory, // Filtered conversation history
      ...currentUserMessage, // Current user message being processed
      ...existingResponses, // Any existing responses to the prompt
    ];

    debugLog('Context composition complete', {
      totalMessages: reorderedMessages.length,
      estimatedTokens: estimateMessagesTokens(reorderedMessages),
      historySkipped: skippedCount,
    });

    return reorderedMessages;
  };
}
