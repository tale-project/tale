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
import { listMessages, type MessageDoc } from '@convex-dev/agent';

// Context management
import {
  createContextHandler,
  checkAndSummarizeIfNeeded,
  estimateTokens,
  buildPrioritizedContexts,
  trimContextsByPriority,
  prioritizedContextsToMessages,
  DEFAULT_MODEL_CONTEXT_LIMIT,
  CONTEXT_SAFETY_MARGIN,
  SYSTEM_INSTRUCTIONS_TOKENS,
  OUTPUT_RESERVE,
  RECENT_MESSAGES_TOKEN_ESTIMATE,
} from './context_management';

import { createDebugLog } from '../../lib/debug_log';
import {
  classifyError,
  NonRetryableError,
} from '../../lib/error_classification';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[ChatAgent]');

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
  /**
   * Stream ID for Persistent Text Streaming.
   * Used to provide optimized text delivery to the frontend.
   * The stream is populated with text content as it's generated.
   */
  streamId?: string;
}

export interface GenerateAgentResponseResult {
  threadId: string;
  text: string;
  toolCalls?: Array<{ toolName: string; status: string }>;
  model: string;
  provider: string;
  usage?: Usage;
  reasoning?: string;
  durationMs?: number;
  subAgentUsage?: Array<{
    toolName: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }>;
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
  const { threadId, organizationId, maxSteps, promptMessageId, attachments, messageText, streamId } = args;

  const startTime = Date.now();

  // If we have a streamId, mark the stream as actively streaming
  // This updates the status from 'pending' to 'streaming' in Persistent Text Streaming
  if (streamId) {
    await ctx.runMutation(internal.streaming.startStream, { streamId });
  }

  try {
    const userQuery = messageText || '';

    // Load context summary and integrations in parallel for faster startup
    // RAG is no longer pre-loaded - AI uses rag_search tool on-demand to reduce token usage
    const [initialContextSummary, integrationsList] = await Promise.all([
      // Load any existing incremental summary for this thread
      loadContextSummary(ctx, threadId),
      // Load available integrations for this organization
      ctx.runQuery(internal.integrations.listInternal, { organizationId }),
    ]);

    // RAG context is no longer injected - AI uses rag_search tool when needed
    const ragContext: string | undefined = undefined;

    debugLog('Initial context loaded', {
      threadId,
      hasSummary: !!initialContextSummary,
      hasRagContext: false,
      ragContextLength: 0,
      attachmentCount: attachments?.length ?? 0,
      integrationsCount: integrationsList?.length ?? 0,
    });

    // Build system context messages using priority management (P1)
    // This ensures critical context is preserved when approaching token limits
    type MessageContent = string | MessageContentPart[];
    const contextSummary = initialContextSummary;

    // Format integrations info if available
    let integrationsInfo: string | undefined;
    if (integrationsList && integrationsList.length > 0) {
      integrationsInfo = integrationsList
        .map((integration: any) => {
          const type = integration.type || 'rest_api';
          const status = integration.status || 'active';
          const title = integration.title || integration.name;
          const desc = integration.description ? ` - ${integration.description}` : '';
          return `• ${integration.name} (${type}, ${status}): ${title}${desc}`;
        })
        .join('\n');
    }

    // DEBUG: Log token breakdown for each context component
    debugLog('Token breakdown analysis', {
      threadId,
      userQueryTokens: estimateTokens(userQuery),
      contextSummaryTokens: contextSummary ? estimateTokens(contextSummary) : 0,
      ragContextTokens: 0, // RAG is now on-demand via rag_search tool
      integrationsInfoTokens: integrationsInfo ? estimateTokens(integrationsInfo) : 0,
      integrationsInfoLength: integrationsInfo?.length ?? 0,
      // Log raw lengths for comparison
      rawLengths: {
        userQuery: userQuery.length,
        contextSummary: contextSummary?.length ?? 0,
        ragContext: 0,
        integrationsInfo: integrationsInfo?.length ?? 0,
      },
    });

    // P1: Proactive context overflow detection
    // Check if we're approaching context limits and summarize if needed
    const currentPromptTokens = estimateTokens(userQuery);

    // Build prioritized contexts for estimation and trimming
    const prioritizedContexts = buildPrioritizedContexts({
      threadId,
      contextSummary,
      ragContext,
      integrationsInfo,
    });

    const initialContextTokens = prioritizedContexts.reduce((sum, c) => sum + c.tokens, 0);

    // P2: Async summarization - triggers in background, doesn't block
    const overflowCheck = await checkAndSummarizeIfNeeded(ctx, {
      threadId,
      contextMessagesTokens: initialContextTokens,
      currentPromptTokens,
      existingSummary: contextSummary,
    });

    if (overflowCheck.summarizationTriggered) {
      debugLog('Async summarization triggered (will be available next request)', {
        threadId,
        currentUsagePercent: overflowCheck.estimate.usagePercent.toFixed(1) + '%',
      });
    }

    // Calculate available token budget for system context
    // Reserve space for: system instructions, recent messages, current prompt, and output
    const contextBudget =
      DEFAULT_MODEL_CONTEXT_LIMIT * CONTEXT_SAFETY_MARGIN -
      SYSTEM_INSTRUCTIONS_TOKENS -
      RECENT_MESSAGES_TOKEN_ESTIMATE -
      currentPromptTokens -
      OUTPUT_RESERVE;

    // Trim contexts by priority if needed
    const trimResult = trimContextsByPriority(prioritizedContexts, contextBudget);

    if (trimResult.wasTrimmed) {
      debugLog('Context trimmed due to token budget', {
        threadId,
        budget: contextBudget,
        keptTokens: trimResult.totalTokens,
        trimmedCount: trimResult.trimmed.length,
        trimmedIds: trimResult.trimmed.map((t) => t.id),
      });
    }

    // Convert prioritized contexts to system messages
    const systemContextMessages = prioritizedContextsToMessages(trimResult.kept);

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
    //
    // IMPORTANT: When saveStreamDeltas is true, the SDK internally calls:
    // 1. streamer.consumeStream(result.toUIMessageStream())
    // 2. await result.consumeStream()
    // So we must NOT manually consume the stream again (e.g., via fullStream iteration),
    // as streams can only be consumed once. Double consumption causes race conditions
    // and may result in UI showing stale/duplicate stream data.
    const streamResult = await agent.streamText(
      contextWithOrg,
      { threadId },
      {
        promptMessageId,
        // SDK calls this `messages` but it's our system context injection
        // (becomes `inputMessages` in contextHandler, we rename to `systemContext` there)
        messages: systemContextMessages,
        // If we have attachments, use prompt to override the stored message content
        // This allows multi-modal content without storing the large base64 data
        ...(promptContent ? { prompt: promptContent } : {}),
      },
      {
        contextOptions: {
          recentMessages: 20,
          // P0: Include tool messages in context for consistency with summarization
          // Previously we excluded tool messages here but summarized them,
          // causing context discontinuity
          excludeToolMessages: false,
          searchOtherThreads: false,
        },
        // P0: Use contextHandler to fix message ordering
        // Default SDK order: search -> recent -> inputMessages -> inputPrompt
        // Our order: systemContext -> search -> conversationHistory -> currentUserMessage
        // This ensures [SYSTEM], [CONTEXT], [KNOWLEDGE BASE] appear before history
        contextHandler: createContextHandler(),
        // Save stream deltas so UI can show real-time progress
        saveStreamDeltas: true,
        // User message was already saved in the mutation with promptMessageId.
        // The library only saves the assistant response when promptMessageId is provided.
      },
    );

    // After stream completes, link any pending approvals to the assistant message
    // The message ID wasn't available during tool execution, so we link it now
    //
    // IMPORTANT: We need to find the FIRST message in the current "order" group,
    // because useUIMessages/listUIMessages includes ALL messages (including tool messages)
    // and combines them by order. The UIMessage.id is set to firstMessage._id.
    try {
      // Get the latest messages from the thread (include ALL messages to match UIMessage grouping)
      const messagesResult = await listMessages(ctx, components.agent, {
        threadId,
        paginationOpts: { cursor: null, numItems: 50 },
        excludeToolMessages: false, // Include all messages to find the correct first message
      });

      // Find the latest assistant message to get its order
      const latestAssistantMessage = messagesResult.page.find(
        (m: MessageDoc) => m.message?.role === 'assistant'
      );

      if (latestAssistantMessage) {
        // Find ALL messages with the same order (this is how UIMessages groups them)
        // But EXCLUDE user messages since they are separate UIMessages
        const currentOrder = latestAssistantMessage.order;
        const messagesInSameOrder = messagesResult.page.filter(
          (m: MessageDoc) => m.order === currentOrder && m.message?.role !== 'user'
        );

        // Sort by stepOrder to find the first one (UIMessage uses firstMessage._id)
        messagesInSameOrder.sort((a: MessageDoc, b: MessageDoc) => a.stepOrder - b.stepOrder);
        const firstMessageInOrder = messagesInSameOrder[0] || latestAssistantMessage;

        debugLog(`Linking approvals: order=${currentOrder}, firstInOrder._id=${firstMessageInOrder._id}, role=${firstMessageInOrder.message?.role || 'tool'}`);

        const linkedCount = await ctx.runMutation(
          internal.approvals.linkApprovalsToMessage,
          {
            threadId,
            messageId: firstMessageInOrder._id,
          }
        );
        if (linkedCount > 0) {
          debugLog(`Linked ${linkedCount} pending approvals to message ${firstMessageInOrder._id}`);
        }
      }
    } catch (error) {
      // Non-fatal: log and continue - approvals will still work, just without messageId
      console.error('[generateAgentResponse] Failed to link approvals to message:', error);
    }

    // Get the final result after stream completes
    const result: {
      text?: string;
      steps?: unknown[];
      usage?: Usage;
      finishReason?: string;
      warnings?: unknown[];
    } = {
      text: await streamResult.text,
      steps: await streamResult.steps,
      usage: await streamResult.usage,
      finishReason: await streamResult.finishReason,
      warnings: await streamResult.warnings,
    };

    const elapsedMs = Date.now() - startTime;
    debugLog(
      `generateAgentResponse completed in ${(elapsedMs / 1000).toFixed(1)}s for thread ${threadId}`,
    );

    // DEBUG: Log actual vs estimated token usage for analysis
    const actualInputTokens = result.usage?.inputTokens ?? 0;
    const estimatedContextTokens = prioritizedContexts.reduce((sum, c) => sum + c.tokens, 0);
    debugLog('Token usage comparison', {
      threadId,
      actual: {
        inputTokens: actualInputTokens,
        outputTokens: result.usage?.outputTokens ?? 0,
        totalTokens: result.usage?.totalTokens ?? 0,
      },
      estimated: {
        contextTokens: estimatedContextTokens,
        userQueryTokens: estimateTokens(userQuery),
        // Note: Tool definitions and system instructions are logged in create_agent_config.ts
        // The difference between actual and estimated gives us insight into SDK overhead
      },
      difference: {
        unexplainedTokens: actualInputTokens - estimatedContextTokens - estimateTokens(userQuery),
        note: 'unexplainedTokens includes: tool definitions, system instructions, recent messages, SDK overhead',
      },
    });

    // AI SDK steps: each step is a generation round with toolCalls[] and toolResults[] arrays
    // Agent SDK stores tool results in `output` field (directly as the result object, not wrapped)
    type StepWithTools = {
      toolCalls?: Array<{ toolName: string }>;
      toolResults?: Array<{
        toolName: string;
        result?: unknown;  // May be undefined if SDK normalized it
        output?: unknown;  // Agent SDK puts the tool's return value here directly
      }>;
      // Additional properties for debugging/error reporting
      finishReason?: string;
      text?: string;
      content?: string | unknown[];
      providerMetadata?: { error?: unknown; openai?: { error?: unknown } };
      warnings?: unknown[];
    };
    const steps = (result.steps ?? []) as StepWithTools[];

    // Sub-agent tool names for usage extraction
    const subAgentToolNames = ['workflow_assistant', 'web_assistant', 'document_assistant', 'integration_assistant'];

    // Extract tool calls from all steps
    // Agent SDK stores tool results in output field directly (not wrapped in {type, value})
    const toolCalls: Array<{ toolName: string; status: string }> = [];
    for (const step of steps) {
      const stepToolCalls = step.toolCalls ?? [];
      const stepToolResults = step.toolResults ?? [];

      for (const toolCall of stepToolCalls) {
        const matchingResult = stepToolResults.find(r => r.toolName === toolCall.toolName);
        // Check both direct result and output for success field
        const directSuccess = (matchingResult?.result as { success?: boolean } | undefined)?.success;
        const outputSuccess = (matchingResult?.output as { success?: boolean } | undefined)?.success;
        const isSuccess = directSuccess ?? outputSuccess ?? true;
        toolCalls.push({
          toolName: toolCall.toolName,
          status: isSuccess !== false ? 'completed' : 'failed',
        });
      }
    }

    // Extract sub-agent usage from tool results
    // Sub-agent tools (workflow_assistant, web_assistant, etc.) return usage in their results
    // Agent SDK stores result directly in output field: { success, response, usage }
    const subAgentUsage: Array<{
      toolName: string;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    }> = [];

    for (const step of steps) {
      const stepToolResults = step.toolResults ?? [];
      for (const toolResult of stepToolResults) {
        if (subAgentToolNames.includes(toolResult.toolName)) {
          // Tool results can be in different places depending on SDK version:
          // 1. toolResult.result.usage - direct AI SDK format
          // 2. toolResult.output.usage - Agent SDK stores result directly in output
          // 3. toolResult.output.value.usage - Agent SDK normalized format
          type UsageData = { inputTokens?: number; outputTokens?: number; totalTokens?: number };
          const directResult = toolResult.result as { usage?: UsageData } | undefined;
          const outputDirect = toolResult.output as unknown as { usage?: UsageData } | undefined;
          const outputValue = (toolResult.output as { value?: { usage?: UsageData } } | undefined)?.value;
          const toolUsage = directResult?.usage ?? outputDirect?.usage ?? outputValue?.usage;
          if (toolUsage) {
            subAgentUsage.push({
              toolName: toolResult.toolName,
              inputTokens: toolUsage.inputTokens,
              outputTokens: toolUsage.outputTokens,
              totalTokens: toolUsage.totalTokens,
            });
          }
        }
      }
    }

    const envModel = (process.env.OPENAI_MODEL || '').trim();
    if (!envModel) {
      throw new Error(
        'OPENAI_MODEL environment variable is required but is not set',
      );
    }

    const responseText = (result.text || '').trim();

    // Save the complete response text to Persistent Text Streaming
    // This enables optimized text retrieval via getChatStreamBody query
    // Note: We save the final text after generation completes because the Agent SDK
    // consumes the stream internally with saveStreamDeltas. For true per-token streaming,
    // we would need to disable saveStreamDeltas and manually handle the stream.
    if (streamId && responseText) {
      await ctx.runMutation(internal.streaming.appendToStream, {
        streamId,
        text: responseText,
      });
      await ctx.runMutation(internal.streaming.completeStream, { streamId });
    }

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

    const chatResult = {
      threadId,
      text: responseText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      model: envModel,
      provider: 'openai',
      usage: result.usage,
      reasoning: (result as { reasoningText?: string }).reasoningText,
      durationMs: Date.now() - startTime,
      subAgentUsage: subAgentUsage.length > 0 ? subAgentUsage : undefined,
    };

    // Call completion handler to save metadata and schedule summarization
    await ctx.runMutation(internal.chat_agent.onChatComplete, {
      result: chatResult,
    });

    return chatResult;
  } catch (error) {
    // Mark the stream as errored if we have one
    if (streamId) {
      try {
        await ctx.runMutation(internal.streaming.errorStream, { streamId });
      } catch (streamError) {
        console.error('[generateAgentResponse] Failed to mark stream as errored:', streamError);
      }
    }

    // Trigger summarization on error to reduce context for potential follow-up
    await ctx.runAction(internal.chat_agent.autoSummarizeIfNeeded, {
      threadId,
    });

    const elapsedMs = Date.now() - startTime;

    // Log sanitized error details to help diagnose provider issues like
    // AI_APICallError without leaking sensitive request data.
    // NOTE: We only log high-level metadata (status, type, code, message).
    // Use Record<string, unknown> to safely access optional properties on unknown error types
    const err = error as Record<string, unknown>;
    const cause = err?.cause as Record<string, unknown> | undefined;
    console.error('[chat_agent] generateAgentResponse error', {
      threadId,
      elapsedMs,
      name: err?.name,
      message: err?.message,
      status: err?.status ?? err?.statusCode,
      type: err?.type,
      code: err?.code,
      // Capture response body for API errors (helps debug schema issues)
      responseBody: err?.responseBody ?? err?.data ?? cause?.responseBody,
      cause: cause?.message,
    });

    // Classify the error for logging purposes
    const classification = classifyError(error);
    console.error('[chat_agent] Error classification', {
      threadId,
      reason: classification.reason,
      description: classification.description,
    });

    // Wrap error with classification info for better debugging
    throw new NonRetryableError(
      `${classification.description}: ${err?.message || 'Unknown error'}`,
      error,
      classification.reason,
    );
  }
}
