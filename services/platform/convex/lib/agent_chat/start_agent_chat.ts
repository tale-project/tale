/**
 * Start Agent Chat - Generic Mutation Helper
 *
 * Provides unified chat initialization logic for all agents:
 * - Create persistent text stream (if enabled)
 * - Deduplicate user messages
 * - Process attachments and save message
 * - Schedule agent response action
 *
 * Each agent can use this helper with their specific configuration.
 * Configuration is passed as parameters - lib/ has no dependencies on agents/.
 */

import type { MutationCtx } from '../../_generated/server';
import { components } from '../../_generated/api';
import { listMessages, saveMessage } from '@convex-dev/agent';
import {
  computeDeduplicationState,
  type AgentListMessagesResult,
} from '../message_deduplication';
import { persistentStreaming } from '../../streaming/helpers';
import { getUserTeamIds } from '../get_user_teams';
import { getRunAgentGenerationRef } from '../function_refs';
import type { AgentType } from '../context_management/constants';
import type { FileAttachment } from '../attachments';
import type { SerializableAgentConfig, AgentHooksConfig } from './types';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(1)} MB`;
  }
  const gb = mb / 1024;
  if (gb < 1024) {
    return `${gb.toFixed(1)} GB`;
  }
  const tb = gb / 1024;
  return `${tb.toFixed(1)} TB`;
}

export interface StartAgentChatArgs {
  ctx: MutationCtx;
  agentType: AgentType;
  threadId: string;
  organizationId: string;
  message: string;
  maxSteps?: number;
  attachments?: FileAttachment[];
  /** Additional context to pass to the agent (key-value pairs) */
  additionalContext?: Record<string, string>;
  /** Agent configuration (serializable) */
  agentConfig: SerializableAgentConfig;
  /** Model to use for generation */
  model: string;
  /** Model provider (e.g., 'openai') */
  provider: string;
  /** Debug tag for logging */
  debugTag: string;
  /** Enable streaming response */
  enableStreaming: boolean;
  /** Optional hooks configuration (FunctionHandles) */
  hooks?: AgentHooksConfig;
}

export interface StartAgentChatResult {
  messageAlreadyExists: boolean;
  /**
   * The stream ID for the AI response.
   * Empty string if streaming is disabled for this agent.
   */
  streamId: string;
}

/**
 * Start a chat with an agent.
 *
 * This function handles the common mutation logic:
 * 1. Create persistent stream (if streaming enabled)
 * 2. Get thread and user team IDs
 * 3. Deduplicate and save user message
 * 4. Process attachments as markdown
 * 5. Schedule the agent response action
 */
export async function startAgentChat(
  args: StartAgentChatArgs,
): Promise<StartAgentChatResult> {
  const {
    ctx,
    agentType,
    threadId,
    organizationId,
    message,
    attachments,
    additionalContext,
    agentConfig,
    model,
    provider,
    debugTag,
    enableStreaming,
    hooks,
  } = args;

  // Use caller's maxSteps if provided, otherwise use agent config's maxSteps
  const maxSteps = args.maxSteps ?? agentConfig.maxSteps ?? 20;

  // Create persistent stream if streaming is enabled for this agent
  const streamId = enableStreaming
    ? await persistentStreaming.createStream(ctx)
    : '';

  // Get thread to retrieve userId, then get user's team IDs for RAG search
  const thread = await ctx.runQuery(components.agent.threads.getThread, { threadId });
  const userTeamIds = thread?.userId
    ? await getUserTeamIds(ctx, thread.userId)
    : [];

  // Load recent non-tool messages for deduplication
  const existingMessages: AgentListMessagesResult = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { cursor: null, numItems: 10 },
    excludeToolMessages: true,
  });

  const { lastUserMessage, messageAlreadyExists, trimmedMessage } =
    computeDeduplicationState(existingMessages, message);

  const hasAttachments = attachments && attachments.length > 0;

  // Build message content with attachment markdown
  const messageContent = hasAttachments
    ? await buildMessageWithAttachments(ctx, trimmedMessage, attachments)
    : trimmedMessage;

  // Save user message if not a duplicate
  let promptMessageId: string;
  if (!messageAlreadyExists) {
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      message: { role: 'user', content: messageContent },
    });
    promptMessageId = messageId;
  } else {
    if (!lastUserMessage) {
      throw new Error('Expected lastUserMessage to exist when messageAlreadyExists is true');
    }
    promptMessageId = lastUserMessage._id;
  }

  // Prepare attachments for action (only if new message)
  const actionAttachments =
    !messageAlreadyExists && hasAttachments
      ? attachments.map((a) => ({
          fileId: a.fileId,
          fileName: a.fileName,
          fileType: a.fileType,
          fileSize: a.fileSize,
        }))
      : undefined;

  // Schedule the generic agent action with full configuration
  await ctx.scheduler.runAfter(0, getRunAgentGenerationRef(), {
    agentType,
    agentConfig,
    model,
    provider,
    debugTag,
    enableStreaming,
    hooks,
    threadId,
    organizationId,
    userId: thread?.userId,
    taskDescription: trimmedMessage,
    attachments: actionAttachments,
    streamId: streamId || undefined,
    promptMessageId,
    maxSteps,
    userTeamIds,
    additionalContext,
  });

  return { messageAlreadyExists, streamId };
}

/**
 * Check if a file is a text file based on type or extension.
 */
function isTextFile(attachment: FileAttachment): boolean {
  return (
    attachment.fileType === 'text/plain' ||
    attachment.fileName.toLowerCase().endsWith('.txt') ||
    attachment.fileName.toLowerCase().endsWith('.log')
  );
}

/**
 * Build message content with attachment markdown.
 *
 * Converts attachments to markdown format (all include fileId):
 * - Documents: 📎 [filename](url) (type, size) *(fileId: xxx)*
 * - Text files: 📄 [filename](url) (size) *(fileId: xxx)*
 * - Images: ![filename](url) *(fileId: xxx)*
 */
async function buildMessageWithAttachments(
  ctx: MutationCtx,
  message: string,
  attachments: FileAttachment[],
): Promise<string> {
  // Separate images, text files, and other documents
  const imageAttachments = attachments.filter((a) =>
    a.fileType.startsWith('image/'),
  );
  const textFileAttachments = attachments.filter(
    (a) => !a.fileType.startsWith('image/') && isTextFile(a),
  );
  const documentAttachments = attachments.filter(
    (a) => !a.fileType.startsWith('image/') && !isTextFile(a),
  );

  // Fetch all URLs in parallel
  const [documentUrls, textFileUrls, imageUrls] = await Promise.all([
    Promise.all(
      documentAttachments.map(async (a) => ({
        attachment: a,
        url: await ctx.storage.getUrl(a.fileId),
      })),
    ),
    Promise.all(
      textFileAttachments.map(async (a) => ({
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

  let textContent = message;

  // Add document references as markdown (PDF, DOCX, PPTX, etc.)
  if (documentUrls.length > 0) {
    const docMarkdown: string[] = [];
    for (const { attachment, url } of documentUrls) {
      if (url) {
        docMarkdown.push(
          `📎 [${attachment.fileName}](${url}) (${attachment.fileType}, ${formatFileSize(attachment.fileSize)})\n*(fileId: ${attachment.fileId})*`,
        );
      }
    }
    if (docMarkdown.length > 0) {
      textContent = `${message}\n\n${docMarkdown.join('\n\n')}`;
    }
  }

  // Add text file references as markdown with fileId (TXT, LOG)
  if (textFileUrls.length > 0) {
    const textFileMarkdown: string[] = [];
    for (const { attachment, url } of textFileUrls) {
      if (url) {
        textFileMarkdown.push(
          `📄 [${attachment.fileName}](${url}) (${formatFileSize(attachment.fileSize)})\n*(fileId: ${attachment.fileId})*`,
        );
      }
    }
    if (textFileMarkdown.length > 0) {
      textContent = textContent
        ? `${textContent}\n\n${textFileMarkdown.join('\n\n')}`
        : textFileMarkdown.join('\n\n');
    }
  }

  // Add image references as markdown with fileId
  if (imageUrls.length > 0) {
    const imageMarkdown: string[] = [];
    for (const { attachment, url } of imageUrls) {
      if (url) {
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

  return textContent;
}
