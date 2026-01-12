/**
 * Context Size Estimation
 *
 * Estimates the total context size before making an API call.
 * This enables proactive summarization before hitting context limits.
 */

import type { ActionCtx } from '../../../_generated/server';
import { components } from '../../../_generated/api';
import { listMessages, type MessageDoc } from '@convex-dev/agent';
import {
  estimateMessageDocTokens,
  SYSTEM_INSTRUCTIONS_TOKENS,
  CONTEXT_SAFETY_MARGIN,
  DEFAULT_MODEL_CONTEXT_LIMIT,
  DEFAULT_RECENT_MESSAGES,
} from '../../../lib/context_management';
import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[ContextSize]');

/**
 * Result of context size estimation.
 */
export interface ContextSizeEstimate {
  /** Estimated total tokens for the context */
  totalTokens: number;
  /** Breakdown of token usage by category */
  breakdown: {
    systemInstructions: number;
    contextMessages: number;
    recentMessages: number;
    currentPrompt: number;
  };
  /** Whether we're approaching the context limit */
  needsSummarization: boolean;
  /** Percentage of context limit used */
  usagePercent: number;
}

/**
 * Arguments for context size estimation.
 */
export interface EstimateContextSizeArgs {
  threadId: string;
  /** Tokens for injected context ([SYSTEM], [CONTEXT], [KNOWLEDGE BASE], etc.) */
  contextMessagesTokens: number;
  /** Tokens for the current user prompt */
  currentPromptTokens: number;
  /** Number of recent messages to consider (default: 20) */
  recentMessagesCount?: number;
  /** Whether tool messages are excluded from context (default: false) */
  excludeToolMessages?: boolean;
  /** Model's context limit in tokens (default: 128000) */
  modelContextLimit?: number;
}

/**
 * Estimate the total context size before making an API call.
 *
 * This allows proactive summarization before hitting context limits,
 * avoiding wasted API calls that would fail due to context overflow.
 */
export async function estimateContextSize(
  ctx: ActionCtx,
  args: EstimateContextSizeArgs,
): Promise<ContextSizeEstimate> {
  const {
    threadId,
    contextMessagesTokens,
    currentPromptTokens,
    recentMessagesCount = DEFAULT_RECENT_MESSAGES,
    excludeToolMessages = false,
    modelContextLimit = DEFAULT_MODEL_CONTEXT_LIMIT,
  } = args;

  // Fetch recent messages to estimate their token count
  const messagesResult = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { cursor: null, numItems: recentMessagesCount },
    excludeToolMessages,
  });

  // Estimate tokens for recent messages using accurate estimation
  // This properly handles tool calls/results with full serialization
  const recentMessagesTokens = messagesResult.page.reduce(
    (sum, m: MessageDoc) => sum + estimateMessageDocTokens(m),
    0,
  );

  const breakdown = {
    systemInstructions: SYSTEM_INSTRUCTIONS_TOKENS,
    contextMessages: contextMessagesTokens,
    recentMessages: recentMessagesTokens,
    currentPrompt: currentPromptTokens,
  };

  const totalTokens = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const usagePercent = (totalTokens / modelContextLimit) * 100;
  const needsSummarization = totalTokens > modelContextLimit * CONTEXT_SAFETY_MARGIN;

  debugLog('Context size estimated', {
    threadId,
    totalTokens,
    usagePercent: usagePercent.toFixed(1) + '%',
    needsSummarization,
    breakdown,
    limit: modelContextLimit,
    threshold: Math.round(modelContextLimit * CONTEXT_SAFETY_MARGIN),
  });

  return {
    totalTokens,
    breakdown,
    needsSummarization,
    usagePercent,
  };
}
