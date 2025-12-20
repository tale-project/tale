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
import type { FileAttachment } from '../../lib/attachments/index';

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
  const { threadId, message, organizationId, maxSteps = 500, attachments } = args;

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

  // Build message content - save as TEXT ONLY to avoid breaking non-vision models
  // when thread history is loaded later. Images are handled via the image tool.
  //
  // IMPORTANT: We do NOT save image parts inline because:
  // 1. The main chat model (Kimi K2) doesn't support images
  // 2. When loading thread history for follow-up messages, old image parts would
  //    be sent to the model, causing "No endpoints found that support image input"
  // 3. Images are processed via the dedicated vision model in generate_agent_response.ts
  let messageContent: string = trimmedMessage;

  if (hasAttachments) {
    // Separate images from other files
    const imageAttachments = attachments.filter((a) =>
      a.fileType.startsWith('image/'),
    );
    const documentAttachments = attachments.filter(
      (a) => !a.fileType.startsWith('image/'),
    );

    // Fetch all URLs in parallel for better performance
    const [documentUrls, imageUrls] = await Promise.all([
      Promise.all(
        documentAttachments.map(async (a) => ({
          attachment: a,
          url: await ctx.storage.getUrl(a.fileId),
        })),
      ),
      Promise.all(
        imageAttachments.map(async (a) => ({
          attachment: a,
          url: await ctx.storage.getUrl(a.fileId),
        })),
      ),
    ]);

    // Start with user's text
    let textContent = trimmedMessage;

    // Add document references as markdown to the text
    if (documentUrls.length > 0) {
      const docMarkdown: string[] = [];
      for (const { attachment, url } of documentUrls) {
        if (url) {
          const sizeKB = Math.round(attachment.fileSize / 1024);
          const sizeDisplay =
            sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
          docMarkdown.push(
            `📎 [${attachment.fileName}](${url}) (${attachment.fileType}, ${sizeDisplay})`,
          );
        }
      }
      if (docMarkdown.length > 0) {
        textContent = `${trimmedMessage}\n\n${docMarkdown.join('\n')}`;
      }
    }

    // Add image references as markdown images (NOT multi-modal image parts)
    // Use ![alt](url) syntax to display images inline in the chat UI
    // Include fileId so the image can be referenced later for re-analysis
    // The actual image analysis happens in generate_agent_response.ts via the image tool
    if (imageUrls.length > 0) {
      const imageMarkdown: string[] = [];
      for (const { attachment, url } of imageUrls) {
        if (url) {
          // Use markdown image syntax with fileId preserved for future reference
          imageMarkdown.push(
            `![${attachment.fileName}](${url})\n*(fileId: ${attachment.fileId})*`,
          );
        }
      }
      if (imageMarkdown.length > 0) {
        textContent = textContent
          ? `${textContent}\n\n${imageMarkdown.join('\n\n')}`
          : imageMarkdown.join('\n\n');
      }
    }

    messageContent = textContent;
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
