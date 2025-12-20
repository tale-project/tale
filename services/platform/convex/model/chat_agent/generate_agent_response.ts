'use node';

/**
 * Internal action implementation for generating an agent response.
 *
 * This encapsulates the heavy lifting for generateAgentResponse so the
 * Convex entrypoint file can remain a thin wrapper.
 */

import type { ActionCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { components, internal } from '../../_generated/api';
import { createChatAgent } from '../../lib/create_chat_agent';
import {
  type FileAttachment,
  registerFilesWithAgent,
  type MessageContentPart,
} from '../../lib/attachments/index';
import { parseFile } from '../../agent_tools/files/helpers/parse_file';
import { queryRagContext } from '../../agent_tools/rag/query_rag_context';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[ChatAgent]');

// RAG configuration constants
const RAG_TOP_K = 5;
const RAG_SIMILARITY_THRESHOLD = 0.3;

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

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

    // Always query RAG service first to get relevant context for the user's message
    // This ensures the agent has access to knowledge base information before responding
    const userQuery = messageText || '';
    let ragContext: string | undefined;
    if (userQuery.trim()) {
      ragContext = await queryRagContext(
        userQuery,
        RAG_TOP_K,
        RAG_SIMILARITY_THRESHOLD,
        abortController.signal,
      );
    }

    debugLog('Context loaded', {
      threadId,
      hasSummary: !!contextSummary,
      hasRagContext: !!ragContext,
      ragContextLength: ragContext?.length ?? 0,
      attachmentCount: attachments?.length ?? 0,
    });

    const agent = createChatAgent({
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
    type MessageContent = string | MessageContentPart[];
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

    // Inject RAG context if available - this provides knowledge base context before the agent responds
    if (ragContext) {
      contextMessages.push({
        role: 'user',
        content: `[KNOWLEDGE BASE] Relevant information from your knowledge base:\n\n${ragContext}`,
      });
    }

    // Build the prompt content - this may include multi-modal content for attachments
    let promptContent: Array<{ role: 'user'; content: MessageContent }> | undefined;

    if (attachments && attachments.length > 0) {
      debugLog('Processing file attachments', {
        count: attachments.length,
        files: attachments.map((a) => ({ name: a.fileName, type: a.fileType })),
      });

      // Separate images from documents
      const imageAttachments = attachments.filter((a) =>
        a.fileType.startsWith('image/'),
      );
      const documentAttachments = attachments.filter(
        (a) => !a.fileType.startsWith('image/'),
      );

      // Parse document files to extract their text content (in parallel for performance)
      const parseResults = await Promise.all(
        documentAttachments.map(async (attachment) => {
          try {
            const url = await ctx.storage.getUrl(attachment.fileId);
            if (!url) return null;

            const parseResult = await parseFile(
              url,
              attachment.fileName,
              'chat_agent',
            );
            return { attachment, parseResult };
          } catch (error) {
            debugLog('Error parsing document', {
              fileName: attachment.fileName,
              error: String(error),
            });
            return null;
          }
        }),
      );

      const parsedDocuments: Array<{
        fileName: string;
        content: string;
      }> = [];

      for (const result of parseResults) {
        if (result?.parseResult.success && result.parseResult.full_text) {
          parsedDocuments.push({
            fileName: result.attachment.fileName,
            content: result.parseResult.full_text,
          });
          debugLog('Parsed document', {
            fileName: result.attachment.fileName,
            textLength: result.parseResult.full_text.length,
          });
        } else if (result) {
          debugLog('Failed to parse document', {
            fileName: result.attachment.fileName,
            error: result.parseResult.error,
          });
        }
      }

      // Get image info for the image tool's analyze operation (no inline multi-modal)
      // Instead of sending images directly to the model, we provide fileId and URL
      // so the AI can use the image tool with a dedicated vision model
      // The tool will try storage.get(fileId) first, falling back to URL fetch
      const imageInfoResults = await Promise.all(
        imageAttachments.map(async (attachment) => {
          const url = await ctx.storage.getUrl(attachment.fileId);
          return {
            fileName: attachment.fileName,
            fileId: attachment.fileId,
            url: url || undefined,
          };
        }),
      );
      const imageInfoList = imageInfoResults.filter(
        (
          r,
        ): r is {
          fileName: string;
          fileId: Id<'_storage'>;
          url: string | undefined;
        } => r.fileId !== undefined,
      );

      // Register files with the agent component for proper tracking (documents only)
      // Images are now handled via the image_analyze tool, not inline
      const registeredFiles = await registerFilesWithAgent(
        ctx,
        documentAttachments,
      );

      if (
        registeredFiles.length > 0 ||
        parsedDocuments.length > 0 ||
        imageInfoList.length > 0
      ) {
        // Start with user text
        const userText = messageText || 'Please analyze the attached files.';
        const contentParts: MessageContentPart[] = [
          { type: 'text', text: userText },
        ];

        // Add parsed document content for the AI to read
        if (parsedDocuments.length > 0) {
          for (const doc of parsedDocuments) {
            // Truncate very long documents to avoid exceeding context limits
            const maxLength = 50000;
            const truncatedContent =
              doc.content.length > maxLength
                ? doc.content.substring(0, maxLength) +
                  '\n\n[... Document truncated due to length ...]'
                : doc.content;

            contentParts.push({
              type: 'text',
              text: `\n\n---\n**Document: ${doc.fileName}**\n\n${truncatedContent}\n---\n`,
            });
          }
        }

        // Add image information as text so the AI knows to use image tool with analyze operation
        // Images are NOT sent inline - the AI must use the image tool with operation: "analyze"
        // Provide both fileId (for storage.get) and imageUrl (as fallback)
        if (imageInfoList.length > 0) {
          const imageInfo = imageInfoList
            .map((img) => {
              const urlPart = img.url ? `, imageUrl="${img.url}"` : '';
              return `- **${img.fileName}**: Use the \`image\` tool with operation="analyze", fileId="${img.fileId}"${urlPart} to analyze this image.`;
            })
            .join('\n');
          contentParts.push({
            type: 'text',
            text: `\n\n---\n**Attached Images** (use \`image\` tool with operation="analyze" to view/analyze):\n${imageInfo}\n---\n`,
          });
        }

        promptContent = [
          {
            role: 'user',
            content: contentParts,
          },
        ];
      }
    }

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
    const result: {
      text?: string;
      steps?: unknown[];
      usage?: Usage;
      finishReason?: string;
      warnings?: unknown[];
    } = {
      text: finalText,
      steps: await streamResult.steps,
      usage: await streamResult.usage,
      finishReason: await streamResult.finishReason,
      warnings: await streamResult.warnings,
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

    const responseText = (result.text || '').trim();

    if (!responseText) {
      const usage = result.usage;
      const inputTokens = usage?.inputTokens ?? 0;
      const outputTokens = usage?.outputTokens ?? 0;
      const warnings = result.warnings;

      // Build detailed step summary for debugging
      const stepSummary = steps.map((step, i) => {
        const finishReason = step.finishReason;
        const textLen = step.text?.length ?? 0;
        const toolCallsCount = step.toolCalls?.length ?? 0;
        const toolResultsCount = step.toolResults?.length ?? 0;

        // Extract content info (may contain error details)
        let contentInfo: string | undefined;
        if (step.content) {
          if (typeof step.content === 'string') {
            contentInfo = step.content.slice(0, 200);
          } else if (Array.isArray(step.content)) {
            contentInfo = `array[${step.content.length}]`;
          }
        }

        // Check providerMetadata for errors
        const providerError = step.providerMetadata?.error || step.providerMetadata?.openai?.error;

        const stepInfo: Record<string, unknown> = {
          step: i,
          finishReason,
          textLen,
          toolCalls: toolCallsCount,
          toolResults: toolResultsCount,
        };

        if (contentInfo) stepInfo.content = contentInfo;
        if (providerError) stepInfo.providerError = providerError;
        if (step.warnings?.length) stepInfo.warnings = step.warnings;

        return stepInfo;
      });

      const errorDetails: Record<string, unknown> = {
        model: envModel,
        inputTokens,
        outputTokens,
        stepCount: steps.length,
        steps: stepSummary,
      };

      if (warnings && warnings.length > 0) {
        errorDetails.warnings = warnings;
      }

      throw new Error(
        `Agent returned empty response: ${JSON.stringify(errorDetails)}`,
      );
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
