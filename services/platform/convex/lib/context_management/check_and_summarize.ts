/**
 * Context Size Check
 *
 * Checks context size before API calls to estimate token usage.
 */

import type { ActionCtx } from '../../_generated/server';

import { createDebugLog } from '../debug_log';
import {
  DEFAULT_MODEL_CONTEXT_LIMIT,
  DEFAULT_RECENT_MESSAGES,
  SUMMARIZATION_THRESHOLD,
} from './constants';
import { estimateContextSize } from './estimate_context_size';

const debugLog = createDebugLog('DEBUG_CONTEXT_MANAGEMENT', '[ContextCheck]');

/**
 * Arguments for context size check.
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
 * Result of context size check.
 */
export interface CheckAndSummarizeResult {
  /** The context summary */
  contextSummary: string | undefined;
  /** Whether context is approaching limit */
  summarizationTriggered: boolean;
  /** Context size estimate */
  estimate: {
    totalTokens: number;
    usagePercent: number;
    needsSummarization: boolean;
  };
}

/**
 * Check context size and return estimate.
 *
 * @returns The existing context summary and context size estimate
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
    excludeToolMessages: true,
    modelContextLimit,
  });

  const usageRatio = estimate.totalTokens / modelContextLimit;
  const needsSummarization = usageRatio >= SUMMARIZATION_THRESHOLD;

  debugLog('Context size check', {
    threadId,
    totalTokens: estimate.totalTokens,
    usagePercent: estimate.usagePercent.toFixed(1) + '%',
    needsSummarization,
  });

  return {
    contextSummary: existingSummary,
    summarizationTriggered: false,
    estimate: {
      totalTokens: estimate.totalTokens,
      usagePercent: estimate.usagePercent,
      needsSummarization,
    },
  };
}
