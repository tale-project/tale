/**
 * Model helper for automatic incremental summarization of a chat thread.
 *
 * This contains the core logic previously in convex/summarize_thread.ts
 * so that Convex entrypoints can remain thin wrappers.
 */

import type { ActionCtx } from '../../_generated/server';
import { components } from '../../_generated/api';
import { listMessages, type MessageDoc } from '@convex-dev/agent';
import {
  summarizeMessages,
  updateSummary,
  type MessageForSummary,
} from '../../lib/summarize_context';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[ChatAgent]');

/**
 * Minimum number of messages required before summarization.
 * We need at least a couple of messages to make summarization worthwhile.
 */
const MIN_MESSAGES_FOR_SUMMARIZATION = 2;

/**
 * Thread summary data structure for tracking summarization state.
 * Mirrors the structure stored in thread.summary JSON.
 */
interface ThreadSummaryData {
  chatType?: string;
  activeRunId?: string;
  /** The accumulated context summary */
  contextSummary?: string;
  /** Timestamp of last summarization */
  summarizedAt?: number;
  /** ID of the last message included in the summary */
  lastSummarizedMessageId?: string;
  /** Total count of messages that have been summarized */
  totalMessagesSummarized?: number;
}

export interface AutoSummarizeIfNeededArgs {
  threadId: string;
}

export interface AutoSummarizeIfNeededResult {
  summarized: boolean;
  existingSummary?: string;
  newMessageCount: number;
  totalMessagesSummarized: number;
}

export async function autoSummarizeIfNeededModel(
  ctx: ActionCtx,
  args: AutoSummarizeIfNeededArgs,
): Promise<AutoSummarizeIfNeededResult> {
  // Get thread metadata to check last summarized message
  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId: args.threadId,
  });

  let summaryData: ThreadSummaryData = {};
  if (thread?.summary) {
    try {
      summaryData = JSON.parse(thread.summary);
    } catch {
      // Ignore parse errors and fall back to empty summary data
    }
  }

  const existingSummary = summaryData.contextSummary;
  const lastSummarizedMessageId = summaryData.lastSummarizedMessageId;

  // Collect all messages using pagination
  const allMessages: MessageDoc[] = [];
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const result = await listMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: { cursor, numItems: 100 },
      excludeToolMessages: false,
    });
    allMessages.push(...result.page);
    cursor = result.continueCursor;
    isDone = result.isDone;
  }

  // Reverse to chronological order (oldest first)
  allMessages.reverse();

  // Find messages AFTER the last summarized message
  let newMessages: MessageDoc[] = [];
  if (lastSummarizedMessageId) {
    const lastSummarizedIndex = allMessages.findIndex(
      (m) => m._id === lastSummarizedMessageId,
    );
    if (lastSummarizedIndex >= 0) {
      newMessages = allMessages.slice(lastSummarizedIndex + 1);
    } else {
      // Last summarized message not found (maybe deleted?), summarize all
      newMessages = allMessages;
    }
  } else {
    // No previous summary, all messages are new
    newMessages = allMessages;
  }

  // Count tool messages in new messages for the check
  const newToolMessagesCount = newMessages.filter(
    (m) => m.message?.role === 'tool',
  ).length;

  debugLog('autoSummarizeIfNeeded check', {
    threadId: args.threadId,
    totalMessages: allMessages.length,
    newMessages: newMessages.length,
    newToolMessages: newToolMessagesCount,
    minRequired: MIN_MESSAGES_FOR_SUMMARIZATION,
    hasExistingSummary: !!existingSummary,
    lastSummarizedMessageId,
  });

  // Skip if not enough messages to summarize
  if (newMessages.length < MIN_MESSAGES_FOR_SUMMARIZATION) {
    return {
      summarized: false,
      existingSummary,
      newMessageCount: 0,
      totalMessagesSummarized: summaryData.totalMessagesSummarized || 0,
    };
  }

  // Filter to only tool messages for summarization
  const newToolMessages = newMessages.filter((m) => m.message?.role === 'tool');

  // Skip if no tool messages to summarize
  if (newToolMessages.length === 0) {
    debugLog('autoSummarizeIfNeeded no tool messages to summarize');
    return {
      summarized: false,
      existingSummary,
      newMessageCount: 0,
      totalMessagesSummarized: summaryData.totalMessagesSummarized || 0,
    };
  }

  // Convert tool messages to MessageForSummary format
  const newMessagesForSummary: MessageForSummary[] = newToolMessages
    .filter((m) => m.message?.content)
    .map((m) => ({
      role: 'tool' as const,
      content:
        typeof m.message!.content === 'string'
          ? m.message!.content
          : JSON.stringify(m.message!.content),
      toolName: 'tool_result',
    }));

  debugLog('autoSummarizeIfNeeded summarizing tool messages incrementally', {
    threadId: args.threadId,
    newToolMessagesCount: newMessagesForSummary.length,
    existingSummaryLength: existingSummary?.length || 0,
  });

  // Generate summary - incremental if we have existing summary
  let newSummary: string;
  if (existingSummary) {
    // Incremental: merge existing summary with new messages
    newSummary = await updateSummary(
      ctx,
      existingSummary,
      newMessagesForSummary,
    );
  } else {
    // First summary: summarize all new messages
    newSummary = await summarizeMessages(ctx, newMessagesForSummary);
  }

  // Update thread metadata
  const lastMessage = newMessages[newMessages.length - 1];
  const newTotalSummarized =
    (summaryData.totalMessagesSummarized || 0) + newMessagesForSummary.length;

  summaryData.contextSummary = newSummary;
  summaryData.summarizedAt = Date.now();
  summaryData.lastSummarizedMessageId = lastMessage._id;
  summaryData.totalMessagesSummarized = newTotalSummarized;

  await ctx.runMutation(components.agent.threads.updateThread, {
    threadId: args.threadId,
    patch: { summary: JSON.stringify(summaryData) },
  });

  debugLog('autoSummarizeIfNeeded complete', {
    threadId: args.threadId,
    newSummaryLength: newSummary.length,
    messagesSummarized: newMessagesForSummary.length,
    totalMessagesSummarized: newTotalSummarized,
    lastSummarizedMessageId: lastMessage._id,
  });

  return {
    summarized: true,
    existingSummary: newSummary,
    // After summarization, all messages are now summarized, so unsummarized count is 0
    newMessageCount: 0,
    totalMessagesSummarized: newTotalSummarized,
  };
}
