'use node';

/**
 * Internal action implementation for generating an agent response.
 *
 * This encapsulates the heavy lifting for generateAgentResponse so the
 * Convex entrypoint file can remain a thin wrapper.
 */

import type { ActionCtx } from '../../_generated/server';
import { components, internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { createChatAgent } from '../../lib/create_chat_agent';
import { handleContextOverflowNoToolRetry } from './context_overflow_retry';
import type { FileAttachment } from './chat_with_agent';
import { getFile } from '@convex-dev/agent';
import type { ImagePart as AIImagePart, FilePart as AIFilePart } from 'ai';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[ChatAgent]');

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

/**
 * Result of registering files with the agent component
 */
interface RegisteredFile {
  agentFileId: string;
  storageId: Id<'_storage'>;
  imagePart?: AIImagePart;
  filePart: AIFilePart;
  fileUrl: string;
  attachment: FileAttachment;
  isImage: boolean;
}

/**
 * Computes SHA-256 hash of a blob
 */
async function computeSha256(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Registers files with the agent component and gets proper AI SDK content parts.
 * This allows:
 * 1. Files to be properly tracked for cleanup (vacuuming)
 * 2. Multi-modal messages to be saved correctly
 * 3. The AI to properly process images via URL
 * 4. Non-image files (PDF, etc.) to be processed via tools
 */
async function registerFilesWithAgent(
  ctx: ActionCtx,
  attachments: FileAttachment[],
): Promise<RegisteredFile[]> {
  const registeredFiles: RegisteredFile[] = [];

  for (const attachment of attachments) {
    try {
      // Get file from storage
      const blob = await ctx.storage.get(attachment.fileId);
      if (!blob) {
        debugLog(`File not found in storage: ${attachment.fileId}`);
        continue;
      }

      // Get file URL for non-image files
      const fileUrl = await ctx.storage.getUrl(attachment.fileId);
      if (!fileUrl) {
        debugLog(`Could not get URL for file: ${attachment.fileId}`);
        continue;
      }

      // Compute hash for the file
      const hash = await computeSha256(blob);

      // Register the file with the agent component
      const { fileId: agentFileId } = await ctx.runMutation(
        components.agent.files.addFile,
        {
          storageId: attachment.fileId as string,
          hash,
          mimeType: attachment.fileType,
          filename: attachment.fileName,
        },
      );

      // Get the proper image/file parts from the agent
      const { imagePart, filePart } = await getFile(
        ctx,
        components.agent,
        agentFileId,
      );

      // Determine if this is an image file
      const isImage = attachment.fileType.startsWith('image/');

      registeredFiles.push({
        agentFileId,
        storageId: attachment.fileId,
        imagePart,
        filePart,
        fileUrl,
        attachment,
        isImage,
      });
    } catch (error) {
      console.error(
        `[chat_agent] Failed to register file ${attachment.fileName}:`,
        error,
      );
    }
  }

  return registeredFiles;
}

export interface GenerateAgentResponseArgs {
  threadId: string;
  organizationId: string;
  maxSteps: number;
  promptMessageId: string;
  attachments?: FileAttachment[];
  messageText?: string;
}

export interface GenerateAgentResponseResult {
  threadId: string;
  text: string;
  toolCalls?: Array<{ toolName: string; status: string }>;
  model: string;
  provider: string;
  usage?: Usage;
  reasoning?: string;
}

/**
 * Attempts to load and parse the context summary from a thread.
 * Returns undefined if the thread doesn't exist, has no summary, or the summary is malformed.
 */
async function loadContextSummary(
  ctx: ActionCtx,
  threadId: string,
): Promise<string | undefined> {
  try {
    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId,
    });

    if (!thread?.summary) {
      return undefined;
    }

    const summaryData = JSON.parse(thread.summary) as {
      contextSummary?: string;
    };
    return typeof summaryData.contextSummary === 'string'
      ? summaryData.contextSummary
      : undefined;
  } catch (error) {
    // Log and gracefully degrade - missing summary is non-fatal
    console.error('[chat_agent] Failed to load existing thread summary', {
      threadId,
      error,
    });
    return undefined;
  }
}

export async function generateAgentResponse(
  ctx: ActionCtx,
  args: GenerateAgentResponseArgs,
): Promise<GenerateAgentResponseResult> {
  const { threadId, organizationId, maxSteps, promptMessageId, attachments, messageText } = args;

  const TIMEOUT_MS = 9 * 60 * 1000;
  const startTime = Date.now();
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    debugLog(`Aborting request after ${TIMEOUT_MS / 1000}s timeout`);
    abortController.abort();
  }, TIMEOUT_MS);

  try {
    // Load any existing incremental summary for this thread without blocking
    // on a fresh summarization run. Summarization itself is handled
    // asynchronously in onChatComplete and on-demand in the
    // context_overflow_retry flow.
    const contextSummary = await loadContextSummary(ctx, threadId);

    debugLog('Using existing context summary (if any)', {
      threadId,
      hasSummary: !!contextSummary,
      attachmentCount: attachments?.length ?? 0,
    });

    const agent = await createChatAgent({
      withTools: true,
      maxSteps,
    });

    const contextWithOrg = {
      ...ctx,
      organizationId,
      threadId,
      variables: {},
    };

    // Build context messages - lightweight text-only context
    type MessageContent = string | Array<AIImagePart | { type: 'text'; text: string }>;
    const contextMessages: Array<{ role: 'user'; content: string }> = [];

    // Always inject threadId so the AI knows which thread to use for context_search
    contextMessages.push({
      role: 'user',
      content: `[SYSTEM] Current thread ID: ${threadId}`,
    });

    if (contextSummary) {
      contextMessages.push({
        role: 'user',
        content: `[CONTEXT] Previous Conversation Summary:\n\n${contextSummary}`,
      });
    }

    // Build the prompt content - this may include multi-modal content for attachments
    let promptContent: Array<{ role: 'user'; content: MessageContent }> | undefined;

    if (attachments && attachments.length > 0) {
      debugLog('Processing file attachments', {
        count: attachments.length,
        files: attachments.map((a) => ({ name: a.fileName, type: a.fileType })),
      });

      // Register files with the agent component for proper tracking
      const registeredFiles = await registerFilesWithAgent(ctx, attachments);

      if (registeredFiles.length > 0) {
        // Separate images from other files
        const imageFiles = registeredFiles.filter((f) => f.isImage);
        const nonImageFiles = registeredFiles.filter((f) => !f.isImage);

        // Build content parts
        const contentParts: Array<AIImagePart | { type: 'text'; text: string }> = [];
        const userText = messageText || 'Please analyze the attached files.';

        contentParts.push({ type: 'text', text: userText });

        // For non-image files (PDF, etc.), just provide the URL and let AI use tools
        if (nonImageFiles.length > 0) {
          const fileReferences = nonImageFiles.map((f) =>
            `- **${f.attachment.fileName}** (${f.attachment.fileType}): ${f.fileUrl}`
          ).join('\n');

          contentParts.push({
            type: 'text',
            text: `\n\n[ATTACHMENTS] The user has attached the following files. Use the appropriate tool to read them:\n${fileReferences}`,
          });
        }

        // For images, include them directly in the prompt for the AI to see
        if (imageFiles.length > 0) {
          if (nonImageFiles.length === 0) {
            contentParts.push({
              type: 'text',
              text: '\n\n[IMAGES] The user has attached the following images:',
            });
          } else {
            contentParts.push({
              type: 'text',
              text: '\n\n[IMAGES] The user has also attached the following images:',
            });
          }

          for (const regFile of imageFiles) {
            if (regFile.imagePart) {
              contentParts.push(regFile.imagePart);
            }
          }
        }

        promptContent = [{
          role: 'user',
          content: contentParts as MessageContent,
        }];
      }
    }

    // Determine if we need special handling for attachments
    const hasAttachmentContent = promptContent !== undefined;

    // Use streamText with saveStreamDeltas for real-time UI updates
    // This allows the UI to show tool calls as they happen
    const streamResult = await agent.streamText(
      contextWithOrg,
      { threadId },
      {
        promptMessageId,
        abortSignal: abortController.signal,
        messages: contextMessages,
        // If we have attachments, use prompt to override the stored message content
        // This allows multi-modal content without storing the large base64 data
        ...(promptContent ? { prompt: promptContent } : {}),
      },
      {
        contextOptions: {
          recentMessages: 20,
          excludeToolMessages: true,
          searchOtherThreads: false,
        },
        // Save stream deltas so UI can show real-time progress
        saveStreamDeltas: true,
        // User message was already saved in the mutation with promptMessageId.
        // The library only saves the assistant response when promptMessageId is provided.
      },
    );

    // Consume the stream to completion and get the final result
    // We need to iterate through the stream for it to complete
    let finalText = '';
    for await (const textPart of streamResult.textStream) {
      finalText += textPart;
    }

    // Get the final result after stream completes
    const result: { text?: string; steps?: unknown[]; usage?: Usage } = {
      text: finalText,
      steps: await streamResult.steps,
      usage: await streamResult.usage,
    };

    clearTimeout(timeoutId);
    const elapsedMs = Date.now() - startTime;
    debugLog(
      `generateAgentResponse completed in ${(elapsedMs / 1000).toFixed(1)}s for thread ${threadId}`,
    );

    const steps = (result.steps ?? []) as Array<{ [key: string]: any }>;
    const toolCalls = steps
      .filter((step) => step.type === 'tool-call')
      .map((step) => ({
        toolName: String(step.toolName ?? 'unknown'),
        status: String(step.result?.success ? 'completed' : 'failed'),
      }));

    const envModel = (process.env.OPENAI_MODEL || '').trim();
    if (!envModel) {
      throw new Error(
        'OPENAI_MODEL environment variable is required but is not set',
      );
    }

    let responseText = (result.text || '').trim();

    if (!responseText) {
      responseText = await handleContextOverflowNoToolRetry(ctx, {
        threadId,
        promptMessageId,
        toolCallCount: toolCalls.length,
        usage: result.usage,
        contextWithOrg,
      });
    }

    return {
      threadId,
      text: responseText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      model: envModel,
      provider: 'openai',
      usage: result.usage,
      reasoning: (result as { reasoningText?: string }).reasoningText,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    // Trigger summarization before retry to reduce context for next attempt.
    // This runs synchronously so the retrier waits for it to complete before
    // scheduling the retry.
    await ctx.runAction(internal.chat_agent.autoSummarizeIfNeeded, {
      threadId,
    });

    const elapsedMs = Date.now() - startTime;

    // Log sanitized error details to help diagnose provider issues like
    // AI_APICallError without leaking sensitive request data.
    // NOTE: We only log high-level metadata (status, type, code, message).
    const err = error as any;
    console.error('[chat_agent] generateAgentResponse error', {
      threadId,
      elapsedMs,
      aborted: abortController.signal.aborted,
      name: err?.name,
      message: err?.message,
      status: err?.status ?? err?.statusCode,
      type: err?.type,
      code: err?.code,
      // Capture response body for API errors (helps debug schema issues)
      responseBody: err?.responseBody ?? err?.data ?? err?.cause?.responseBody,
      cause: err?.cause?.message,
    });

    if (abortController.signal.aborted) {
      throw new Error(
        `generateAgentResponse timed out after ${(elapsedMs / 1000).toFixed(
          1,
        )} seconds (limit: ${TIMEOUT_MS / 1000}s)`,
      );
    }

    throw error;
  }
}
