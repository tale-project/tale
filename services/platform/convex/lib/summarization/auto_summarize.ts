/**
 * Model helper for automatic incremental summarization of a chat thread.
 *
 * UNIFIED TOOL MESSAGE STRATEGY (P0 Fix):
 * Previously, this module only summarized tool messages, while the context
 * loading in generate_response excluded tool messages. This caused
 * context discontinuity - summaries contained tool results but the recent
 * message history didn't include the tool calls that produced them.
 *
 * Now both systems are aligned:
 * - Context loading: includes all message types (excludeToolMessages: false)
 * - Summarization: summarizes all message types for complete context
 *
 * This ensures the model always has a coherent view of the conversation.
 */

import { listMessages, type MessageDoc } from '@convex-dev/agent';

import type { ActionCtx } from '../../_generated/server';

import { components } from '../../_generated/api';
import { createDebugLog } from '../debug_log';
import {
  summarizeMessages,
  updateSummary,
  type MessageForSummary,
} from '../summarize_context';

const debugLog = createDebugLog('DEBUG_SUMMARIZATION', '[Summarization]');

/**
 * Shape of a tool-result part in message content.
 * Used when extracting tool names from tool messages.
 */
interface ToolResultPart {
  type: string;
  toolName?: string;
}

/**
 * Minimum number of messages required before summarization.
 * We need at least a couple of messages to make summarization worthwhile.
 */
const MIN_MESSAGES_FOR_SUMMARIZATION = 4;

/**
 * Maximum number of recent messages to keep unsummarized.
 * These remain in full detail while older messages are summarized.
 */
const RECENT_MESSAGES_TO_PRESERVE = 10;

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

  // Count messages by type for logging
  const messageCounts = {
    user: newMessages.filter((m) => m.message?.role === 'user').length,
    assistant: newMessages.filter((m) => m.message?.role === 'assistant')
      .length,
    tool: newMessages.filter((m) => m.message?.role === 'tool').length,
  };

  debugLog('autoSummarizeIfNeeded check', {
    threadId: args.threadId,
    totalMessages: allMessages.length,
    newMessages: newMessages.length,
    messageCounts,
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

  // Determine which messages to summarize vs keep in recent context
  // We preserve the most recent messages and summarize older ones
  const messagesToSummarize =
    newMessages.length > RECENT_MESSAGES_TO_PRESERVE
      ? newMessages.slice(0, newMessages.length - RECENT_MESSAGES_TO_PRESERVE)
      : [];

  // Skip if no messages to summarize (all are recent)
  if (messagesToSummarize.length === 0) {
    debugLog('autoSummarizeIfNeeded all messages are recent, skipping', {
      newMessagesCount: newMessages.length,
      preserveCount: RECENT_MESSAGES_TO_PRESERVE,
    });
    return {
      summarized: false,
      existingSummary,
      newMessageCount: newMessages.length,
      totalMessagesSummarized: summaryData.totalMessagesSummarized || 0,
    };
  }

  // Convert all message types to MessageForSummary format
  // This ensures we capture user decisions, assistant conclusions, AND tool results
  const newMessagesForSummary: MessageForSummary[] = messagesToSummarize
    .filter((m) => m.message?.content)
    .map((m) => {
      const message = m.message;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
      const role = message?.role as 'user' | 'assistant' | 'tool' | 'system';
      const content =
        typeof message?.content === 'string'
          ? message.content
          : JSON.stringify(message?.content);

      // For tool messages, try to extract the tool name from content
      // Message content can include tool-result parts with toolName
      let toolName: string | undefined;
      if (role === 'tool' && Array.isArray(message?.content)) {
        const toolPart = (message.content as ToolResultPart[]).find(
          (p) => p.type === 'tool-result' && p.toolName,
        );
        if (toolPart) {
          toolName = toolPart.toolName;
        }
      }

      return {
        role,
        content,
        ...(toolName ? { toolName } : {}),
      };
    });

  // Skip if no meaningful content to summarize
  if (newMessagesForSummary.length === 0) {
    debugLog('autoSummarizeIfNeeded no content to summarize');
    return {
      summarized: false,
      existingSummary,
      newMessageCount: newMessages.length,
      totalMessagesSummarized: summaryData.totalMessagesSummarized || 0,
    };
  }

  debugLog('autoSummarizeIfNeeded summarizing messages incrementally', {
    threadId: args.threadId,
    messagesToSummarize: newMessagesForSummary.length,
    preservingRecent: newMessages.length - messagesToSummarize.length,
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
  // Use the last message that was summarized, not the last new message overall
  const lastSummarizedMessage =
    messagesToSummarize[messagesToSummarize.length - 1];
  const newTotalSummarized =
    (summaryData.totalMessagesSummarized || 0) + newMessagesForSummary.length;

  // Re-read the thread to get any fields that may have been updated during summarization
  // (e.g., activeRunId may have been set by chat_with_agent during the AI call)
  const freshThread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId: args.threadId,
  });

  let freshSummaryData: ThreadSummaryData = {};
  if (freshThread?.summary) {
    freshSummaryData = JSON.parse(freshThread.summary);
  }

  // Merge: preserve fields from fresh read (like activeRunId) while updating summarization fields
  const mergedSummaryData: ThreadSummaryData = {
    ...freshSummaryData,
    contextSummary: newSummary,
    summarizedAt: Date.now(),
    lastSummarizedMessageId: lastSummarizedMessage._id,
    totalMessagesSummarized: newTotalSummarized,
  };

  await ctx.runMutation(components.agent.threads.updateThread, {
    threadId: args.threadId,
    patch: { summary: JSON.stringify(mergedSummaryData) },
  });

  debugLog('autoSummarizeIfNeeded complete', {
    threadId: args.threadId,
    newSummaryLength: newSummary.length,
    messagesSummarized: newMessagesForSummary.length,
    totalMessagesSummarized: newTotalSummarized,
    lastSummarizedMessageId: lastSummarizedMessage._id,
    recentMessagesPreserved: newMessages.length - messagesToSummarize.length,
  });

  return {
    summarized: true,
    existingSummary: newSummary,
    // After summarization, all messages are now summarized, so unsummarized count is 0
    newMessageCount: 0,
    totalMessagesSummarized: newTotalSummarized,
  };
}
