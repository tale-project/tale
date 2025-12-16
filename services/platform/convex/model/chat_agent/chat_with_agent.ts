/**
 * Start a chat run with the agent.
 *
 * Contains the core logic previously in convex/chat_agent.ts:
 * - Deduplicate the last user message
 * - Save the user message if it's new
 * - Kick off the retried internal action
 * - Store activeRunId on the thread summary
 */

import type { MutationCtx } from '../../_generated/server';
import { components, internal } from '../../_generated/api';
import { listMessages, saveMessage } from '@convex-dev/agent';
import type { RunId } from '@convex-dev/action-retrier';
import { chatAgentRetrier } from '../../lib/chat_agent_retrier';
import { computeDeduplicationState } from './message_deduplication';

import { createDebugLog } from '../../lib/debug_log';

// Re-export FileAttachment from shared utilities for backward compatibility
export type { FileAttachment } from '../../lib/attachments/index';
import { type FileAttachment, formatAttachmentsAsMarkdown } from '../../lib/attachments/index';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[ChatAgent]');

export interface ChatWithAgentArgs {
  threadId: string;
  organizationId: string;
  message: string;
  maxSteps?: number;
  attachments?: FileAttachment[];
}

export interface ChatWithAgentResult {
  runId: string;
  messageAlreadyExists: boolean;
}

export async function chatWithAgent(
  ctx: MutationCtx,
  args: ChatWithAgentArgs,
): Promise<ChatWithAgentResult> {
  const { threadId, message, organizationId, maxSteps = 100, attachments } = args;

  // Load recent non-tool messages to deduplicate the last user message
  const existingMessages = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { cursor: null, numItems: 10 },
    excludeToolMessages: true,
  });

  const {
    latestMessage,
    lastUserMessage,
    messageAlreadyExists,
    trimmedMessage,
  } = computeDeduplicationState(existingMessages, message);

  const hasAttachments = attachments && attachments.length > 0;

  debugLog('chatWithAgent called', {
    threadId,
    organizationId,
    messageAlreadyExists,
    lastUserMessageId: lastUserMessage?._id,
    latestMessageRole: latestMessage?.message?.role,
    attachmentCount: attachments?.length ?? 0,
  });

  // Build message content with markdown references for all attachments
  let messageContent = trimmedMessage;
  if (hasAttachments) {
    const attachmentMarkdown = await formatAttachmentsAsMarkdown(ctx, attachments);
    if (attachmentMarkdown) {
      messageContent = `${trimmedMessage}\n\n${attachmentMarkdown}`;
    }
  }

  // Only save if not a duplicate
  let promptMessageId: string;
  if (!messageAlreadyExists) {
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      message: { role: 'user', content: messageContent },
    });
    promptMessageId = messageId;
  } else {
    promptMessageId = lastUserMessage!._id;
  }

  // Kick off the retried internal action
  // Serialize attachments for the action (only pass if not a duplicate message)
  const actionAttachments = !messageAlreadyExists && hasAttachments
    ? attachments.map((a) => ({
        fileId: a.fileId,
        fileName: a.fileName,
        fileType: a.fileType,
        fileSize: a.fileSize,
      }))
    : undefined;

  const runId: RunId = await chatAgentRetrier.run(
    ctx,
    internal.chat_agent.generateAgentResponse,
    {
      threadId,
      organizationId,
      maxSteps,
      promptMessageId,
      attachments: actionAttachments,
      // Pass the original message text so the action can build multi-modal prompts
      messageText: trimmedMessage,
    },
    {
      onComplete: internal.chat_agent.onChatComplete,
    },
  );

  // Store activeRunId on thread summary so UI can recover in-progress runs
  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId,
  });

  if (thread) {
    let summaryData: Record<string, unknown> = { chatType: 'general' };
    if (thread.summary) {
      try {
        summaryData = { chatType: 'general', ...JSON.parse(thread.summary) };
      } catch {
        // Ignore malformed summary and fall back to default
      }
    }

    const updatedSummary = JSON.stringify({
      ...summaryData,
      activeRunId: runId as string,
    });

    await ctx.runMutation(components.agent.threads.updateThread, {
      threadId,
      patch: { summary: updatedSummary },
    });
  }

  return { runId: runId as string, messageAlreadyExists };
}
