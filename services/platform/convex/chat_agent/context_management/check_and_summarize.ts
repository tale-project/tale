/**
 * Proactive Context Overflow Check and Summarization
 *
 * Checks context size before API calls and triggers summarization
 * if we're approaching the context limit. This avoids wasted API
 * calls that would fail due to context overflow.
 *
 * IMPROVEMENT (P2): Always async summarization
 * - Summarization is always triggered asynchronously to avoid blocking
 * - Uses existing summary for current request
 * - New summary will be available for next request
 * - This significantly reduces user-perceived latency
 */

import type { ActionCtx } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { estimateContextSize } from './estimate_context_size';
import {
  DEFAULT_MODEL_CONTEXT_LIMIT,
  DEFAULT_RECENT_MESSAGES,
  SUMMARIZATION_THRESHOLD,
} from '../../lib/context_management';
import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[ContextCheck]');

/**
 * Arguments for check and summarize.
 */
export interface CheckAndSummarizeArgs {
  threadId: string;
  /** Tokens for injected context messages */
  contextMessagesTokens: number;
  /** Tokens for the current user prompt */
  currentPromptTokens: number;
  /** Existing context summary (if any) */
  existingSummary: string | undefined;
  /** Model's context limit in tokens */
  modelContextLimit?: number;
}

/**
 * Result of check and summarize.
 */
export interface CheckAndSummarizeResult {
  /** The context summary (always the existing one - async doesn't wait) */
  contextSummary: string | undefined;
  /** Whether summarization was triggered (async) */
  summarizationTriggered: boolean;
  /** Context size estimate */
  estimate: {
    totalTokens: number;
    usagePercent: number;
    needsSummarization: boolean;
  };
}

/**
 * Check context size and trigger async summarization if needed.
 *
 * ALWAYS ASYNC (P2 improvement):
 * - When context exceeds threshold, summarization is triggered asynchronously
 * - Returns immediately with existing summary (doesn't block)
 * - New summary will be available for next request
 * - Significantly reduces user-perceived latency
 *
 * @returns The existing context summary and whether async summarization was triggered
 */
export async function checkAndSummarizeIfNeeded(
  ctx: ActionCtx,
  args: CheckAndSummarizeArgs,
): Promise<CheckAndSummarizeResult> {
  const {
    threadId,
    contextMessagesTokens,
    currentPromptTokens,
    existingSummary,
    modelContextLimit = DEFAULT_MODEL_CONTEXT_LIMIT,
  } = args;

  // Estimate context size with tool messages included
  const estimate = await estimateContextSize(ctx, {
    threadId,
    contextMessagesTokens,
    currentPromptTokens,
    recentMessagesCount: DEFAULT_RECENT_MESSAGES,
    excludeToolMessages: true, // Tool messages excluded from context (sub-agents have own memory)
    modelContextLimit,
  });

  const usageRatio = estimate.totalTokens / modelContextLimit;

  // Below threshold: no action needed
  if (usageRatio < SUMMARIZATION_THRESHOLD) {
    debugLog('Context size within limits, no summarization needed', {
      threadId,
      totalTokens: estimate.totalTokens,
      usagePercent: estimate.usagePercent.toFixed(1) + '%',
    });

    return {
      contextSummary: existingSummary,
      summarizationTriggered: false,
      estimate: {
        totalTokens: estimate.totalTokens,
        usagePercent: estimate.usagePercent,
        needsSummarization: false,
      },
    };
  }

  // Above threshold: trigger ASYNC summarization (never blocks)
  debugLog('Context approaching limit, triggering ASYNC summarization', {
    threadId,
    totalTokens: estimate.totalTokens,
    usagePercent: estimate.usagePercent.toFixed(1) + '%',
    breakdown: estimate.breakdown,
  });

  // Schedule async summarization - don't await
  // Uses scheduler to run in background after current action completes
  ctx.scheduler.runAfter(0, internal.chat_agent.actions.autoSummarizeIfNeeded, {
    threadId,
  });

  debugLog('Async summarization scheduled', { threadId });

  return {
    contextSummary: existingSummary, // Always use existing summary (async)
    summarizationTriggered: true,
    estimate: {
      totalTokens: estimate.totalTokens,
      usagePercent: estimate.usagePercent,
      needsSummarization: true,
    },
  };
}
