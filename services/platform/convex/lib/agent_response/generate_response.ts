'use node';

/**
 * Generic Agent Response Generator
 *
 * This module provides a unified implementation for generating agent responses.
 * All agents (chat, web, document, crm, integration, workflow) use this shared
 * implementation with their specific configuration.
 *
 * Features:
 * - Supports both generateText (sub-agents) and streamText (chat agent)
 * - Hooks system for customizing the pipeline (beforeContext, beforeGenerate, afterGenerate)
 * - Automatic tool call extraction and sub-agent usage tracking
 * - Context window building and token estimation
 */

import type { ModelMessage } from 'ai';

import { listMessages, type MessageDoc } from '@convex-dev/agent';

import type {
  GenerateResponseConfig,
  GenerateResponseArgs,
  GenerateResponseResult,
  BeforeContextResult,
} from './types';

import { isRecord, getString } from '../../../lib/utils/type-guards';
import { components, internal } from '../../_generated/api';
import { onAgentComplete } from '../agent_completion';
import {
  buildStructuredContext,
  AGENT_CONTEXT_CONFIGS,
  estimateTokens,
} from '../context_management';
import { wrapInDetails } from '../context_management/message_formatter';
import { createDebugLog } from '../debug_log';
import { startRagPrefetch, type RagPrefetchCache } from '../rag_prefetch';

/**
 * Generate an agent response using the provided configuration.
 *
 * This is the core implementation shared by all agents.
 * Each agent provides its specific configuration (agent factory, model, etc.)
 * and this function handles the common logic:
 * 1. Call beforeContext hook (optional)
 * 2. Build structured context
 * 3. Call beforeGenerate hook (optional)
 * 4. Generate response (streaming or non-streaming)
 * 5. Extract tool calls and sub-agent usage
 * 6. Call afterGenerate hook (optional)
 * 7. Save completion metadata
 */
export async function generateAgentResponse(
  config: GenerateResponseConfig,
  args: GenerateResponseArgs,
): Promise<GenerateResponseResult> {
  const {
    agentType,
    createAgent,
    model,
    provider,
    debugTag,
    enableStreaming,
    hooks,
    convexToolNames,
    instructions,
    toolsSummary,
  } = config;
  const {
    ctx,
    threadId,
    userId,
    organizationId,
    promptMessage,
    additionalContext,
    parentThreadId,
    agentOptions,
    streamId,
    promptMessageId,
    maxSteps: _maxSteps,
    userTeamIds,
  } = args;

  const debugLog = createDebugLog(
    `DEBUG_${agentType.toUpperCase()}_AGENT`,
    debugTag,
  );
  const startTime = Date.now();

  try {
    debugLog(`generate${capitalize(agentType)}Response called`, {
      threadId,
      userId,
      organizationId,
      hasParentThread: !!parentThreadId,
      additionalContextKeys: additionalContext
        ? Object.keys(additionalContext)
        : [],
      enableStreaming,
    });

    // Start stream if streamId provided
    if (streamId) {
      await ctx.runMutation(internal.streaming.internal_mutations.startStream, {
        streamId,
      });
    }

    // Start RAG prefetch immediately (non-blocking) if:
    // 1. userId is provided (needed for RAG search)
    // 2. promptMessage exists (query to search)
    // 3. rag_search tool is configured for this agent
    // This must be started in the main action context, not in a hook (Promises can't be serialized)
    let ragPrefetchCache: RagPrefetchCache | undefined;
    const hasRagSearchTool = convexToolNames?.includes('rag_search') ?? false;
    if (userId && promptMessage && hasRagSearchTool) {
      ragPrefetchCache = startRagPrefetch({
        ctx,
        threadId,
        userMessage: promptMessage,
        userId,
        userTeamIds: userTeamIds ?? [],
      });
      debugLog('RAG prefetch started', {
        threadId,
        userId,
        elapsedMs: Date.now() - startTime,
      });
    }

    // Call beforeContext hook if provided
    let hookData: BeforeContextResult | undefined;
    if (hooks?.beforeContext) {
      hookData = await hooks.beforeContext(ctx, args);
      debugLog('beforeContext hook completed', {
        threadId,
        elapsedMs: Date.now() - startTime,
      });
    }

    // Build structured context (history, RAG, integrations)
    // Note: promptMessage is NOT included - it's passed via `prompt` parameter
    const agentConfig = AGENT_CONTEXT_CONFIGS[agentType];
    const structuredThreadContext = await buildStructuredContext({
      ctx,
      threadId,
      additionalContext,
      parentThreadId,
      maxMessages: agentConfig.recentMessages,
      ragContext: hookData?.ragContext,
      integrationsInfo: hookData?.integrationsInfo,
    });

    debugLog('Context built', {
      estimatedTokens: structuredThreadContext.stats.totalTokens,
      messageCount: structuredThreadContext.stats.messageCount,
      elapsedMs: Date.now() - startTime,
    });

    // Hook can override prompt content (e.g., for attachments → ModelMessage[])
    let hookPromptContent: string | ModelMessage[] | undefined;

    // Call beforeGenerate hook if provided
    if (hooks?.beforeGenerate) {
      const beforeResult = await hooks.beforeGenerate(
        ctx,
        args,
        structuredThreadContext,
        hookData,
      );
      if (beforeResult.promptContent) {
        hookPromptContent = beforeResult.promptContent;
      }
      debugLog('beforeGenerate hook completed', {
        threadId,
        elapsedMs: Date.now() - startTime,
      });
    }

    // Create agent instance
    const agent = createAgent(agentOptions);

    // Build context with organization and optional RAG prefetch cache
    const contextWithOrg = {
      ...ctx,
      organizationId,
      threadId,
      userTeamIds: userTeamIds ?? [],
      variables: {},
      ...(ragPrefetchCache ? { ragPrefetchCache } : {}),
    };

    // Track time to first token for streaming
    let firstTokenTime: number | null = null;

    // Generate response - streaming or non-streaming
    let result: {
      text?: string;
      steps?: unknown[];
      usage?: GenerateResponseResult['usage'];
      finishReason?: string;
      response?: { modelId?: string };
    };

    const promptToSend = hookPromptContent ?? promptMessage;

    // Combine agent instructions with thread context for the system prompt.
    // The Agent SDK uses `system ?? this.options.instructions`, so when we pass
    // `system` explicitly the agent's own instructions are overridden.
    // We prepend them here so the LLM receives both the agent's identity/guidance
    // and the structured thread context (history, RAG, integrations).
    const systemPrompt = instructions
      ? `${instructions}\n\n${structuredThreadContext.threadContext}`
      : structuredThreadContext.threadContext;

    debugLog('PRE_LLM_CALL', {
      threadId,
      model,
      enableStreaming,
      promptMessageId,
      system: systemPrompt,
      prompt: promptToSend,
      elapsedMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    if (enableStreaming) {
      // Streaming mode (chat agent)
      // - system: thread context (history, RAG, integrations)
      // - prompt: current user message (passed separately to avoid duplication)
      const streamResult = await agent.streamText(
        contextWithOrg,
        { threadId, userId },
        {
          promptMessageId,
          system: systemPrompt,
          prompt: promptToSend,
          onChunk: ({ chunk }: { chunk: { type: string } }) => {
            if (firstTokenTime === null && chunk.type === 'text-delta') {
              firstTokenTime = Date.now();
            }
          },
        },
        {
          contextOptions: {
            recentMessages: 0,
            excludeToolMessages: true,
            searchOtherThreads: false,
          },
          saveStreamDeltas: true,
        },
      );

      // Wait for stream to complete
      const [
        streamText,
        streamSteps,
        streamUsage,
        streamFinishReason,
        streamResponse,
      ] = await Promise.all([
        streamResult.text,
        streamResult.steps,
        streamResult.usage,
        streamResult.finishReason,
        streamResult.response,
      ]);

      debugLog('Stream completed', {
        threadId,
        elapsedMs: Date.now() - startTime,
      });

      result = {
        text: streamText,
        steps: streamSteps,
        usage: streamUsage,
        finishReason: streamFinishReason,
        response: streamResponse,
      };

      // If the LLM called tools but didn't generate a substantive follow-up response,
      // retry without tools. This handles cases where the LLM outputs preamble text
      // (e.g., "Let me check...") before tool calls but stops without summarizing results.
      if (needsToolResultRetry(result.text, result.steps)) {
        debugLog(
          'Stream: empty text with tool results, retrying without tools',
          {
            stepsCount: result.steps?.length ?? 0,
            finishReason: result.finishReason,
          },
        );

        const retryContext = await buildStructuredContext({
          ctx,
          threadId,
          additionalContext,
          parentThreadId,
          maxMessages: agentConfig.recentMessages,
          ragContext: hookData?.ragContext,
          integrationsInfo: hookData?.integrationsInfo,
        });

        const retryAgent = createAgent({ ...agentOptions, tools: undefined });

        const retrySystemPrompt = instructions
          ? `${instructions}\n\n${retryContext.threadContext}`
          : retryContext.threadContext;

        const retryResult = await retryAgent.generateText(
          contextWithOrg,
          { threadId, userId },
          {
            system: retrySystemPrompt,
            prompt: promptMessage
              ? `Based on the tool results, complete this task: ${promptMessage}`
              : 'Based on the conversation and tool results above, provide a summary response.',
          },
          {
            contextOptions: {
              recentMessages: 0,
              excludeToolMessages: false,
              searchOtherThreads: false,
            },
            storageOptions: { saveMessages: 'none' },
          },
        );

        result = {
          text: retryResult.text,
          steps: [...(result.steps || []), ...retryResult.steps],
          usage: mergeUsage(result.usage, retryResult.usage),
          finishReason: retryResult.finishReason,
          response: result.response,
        };

        debugLog('Stream retry completed', {
          textLength: result.text?.length ?? 0,
          finishReason: result.finishReason,
        });
      }
    } else {
      // Non-streaming mode (sub-agents)
      // Extend context with all fields from contextWithOrg for consistency
      const subAgentContext = {
        ...ctx,
        organizationId,
        threadId,
        userTeamIds: userTeamIds ?? [],
        variables: {},
        ...(parentThreadId ? { parentThreadId } : {}),
        ...(ragPrefetchCache ? { ragPrefetchCache } : {}),
      };

      const generateResult = await agent.generateText(
        subAgentContext,
        { threadId, userId },
        {
          // Use system parameter for context - it's passed to LLM but NOT saved to database
          // This prevents XML system messages from being stored as thread messages
          system: systemPrompt,
          // Use prompt parameter for the task - this triggers the agent response
          // and gets saved as the user message in the thread (unless promptMessageId is provided)
          prompt: promptMessage,
          // If promptMessageId is provided, the message was already saved (e.g., with attachments)
          // This prevents double-saving the user message
          ...(promptMessageId ? { promptMessageId } : {}),
        },
        {
          contextOptions: {
            recentMessages: 0,
            excludeToolMessages: false,
          },
        },
      );

      debugLog('Generate completed', {
        threadId,
        elapsedMs: Date.now() - startTime,
      });

      result = {
        text: generateResult.text,
        steps: generateResult.steps,
        usage: generateResult.usage,
        finishReason: generateResult.finishReason,
        response: generateResult.response,
      };

      // If the LLM called tools but didn't generate a substantive follow-up response,
      // retry without tools. Handles both completely empty text (e.g., DeepSeek with
      // finishReason: "stop") and preamble-only text before tool calls.
      if (needsToolResultRetry(result.text, result.steps)) {
        debugLog('Empty text with tool results, retrying without tools', {
          stepsCount: result.steps?.length ?? 0,
          finishReason: result.finishReason,
        });

        // Rebuild context to include the just-saved tool results
        const retryContext = await buildStructuredContext({
          ctx,
          threadId,
          additionalContext,
          parentThreadId,
          maxMessages: agentConfig.recentMessages,
          ragContext: hookData?.ragContext,
          integrationsInfo: hookData?.integrationsInfo,
        });

        debugLog('Rebuilt context for retry', {
          estimatedTokens: retryContext.stats.totalTokens,
          messageCount: retryContext.stats.messageCount,
        });

        // Create agent without tools for the retry
        const retryAgent = createAgent({ ...agentOptions, tools: undefined });

        const retrySystemPrompt = instructions
          ? `${instructions}\n\n${retryContext.threadContext}`
          : retryContext.threadContext;

        const retryResult = await retryAgent.generateText(
          subAgentContext,
          { threadId, userId },
          {
            system: retrySystemPrompt,
            prompt: promptMessage
              ? `Based on the tool results, complete this task: ${promptMessage}`
              : 'Based on the conversation and tool results above, provide a summary response.',
          },
          {
            contextOptions: {
              recentMessages: 0,
              excludeToolMessages: false,
            },
            storageOptions: { saveMessages: 'none' },
          },
        );

        result = {
          text: retryResult.text,
          steps: [...(result.steps || []), ...retryResult.steps],
          usage: mergeUsage(result.usage, retryResult.usage),
          finishReason: retryResult.finishReason,
        };

        debugLog('Retry completed', {
          textLength: result.text?.length ?? 0,
          finishReason: result.finishReason,
        });
      }

      // General empty text retry (handles cases like thinking models that consume all tokens for reasoning)
      if (!result.text?.trim()) {
        debugLog('Empty text response, retrying', {
          finishReason: result.finishReason,
          usage: result.usage,
        });

        // Rebuild context to include any messages saved during the original generation
        const retryContext = await buildStructuredContext({
          ctx,
          threadId,
          additionalContext,
          parentThreadId,
          maxMessages: agentConfig.recentMessages,
          ragContext: hookData?.ragContext,
          integrationsInfo: hookData?.integrationsInfo,
        });

        debugLog('Rebuilt context for empty text retry', {
          estimatedTokens: retryContext.stats.totalTokens,
          messageCount: retryContext.stats.messageCount,
        });

        const retryAgent = createAgent({ ...agentOptions, tools: undefined });

        const emptyRetrySystemPrompt = instructions
          ? `${instructions}\n\n${retryContext.threadContext}`
          : retryContext.threadContext;

        const retryResult = await retryAgent.generateText(
          subAgentContext,
          { threadId, userId },
          {
            system: emptyRetrySystemPrompt,
            prompt: promptMessage
              ? `Please complete this task: ${promptMessage}`
              : 'Please provide a response based on the conversation above.',
          },
          {
            contextOptions: {
              recentMessages: 0,
              excludeToolMessages: false,
            },
            storageOptions: { saveMessages: 'none' },
          },
        );

        result = {
          text: retryResult.text,
          steps: result.steps,
          usage: mergeUsage(result.usage, retryResult.usage),
          finishReason: retryResult.finishReason,
        };

        debugLog('Empty text retry completed', {
          textLength: result.text?.length ?? 0,
          finishReason: result.finishReason,
        });
      }
    }

    // Fallback: if text is still missing after all retries, provide a minimal response
    // so the user always sees something rather than an empty message
    if (needsToolResultRetry(result.text, result.steps)) {
      const toolNames = extractToolNamesFromSteps(result.steps ?? []);
      debugLog('All retries exhausted, using fallback message', {
        toolNames,
        finishReason: result.finishReason,
      });
      result.text =
        toolNames.length > 0
          ? `I attempted to process your request using ${toolNames.join(', ')}, but was unable to generate a complete response. Please try again.`
          : 'I was unable to generate a response. Please try again.';
    }

    const durationMs = Date.now() - startTime;
    const timeToFirstTokenMs = firstTokenTime
      ? firstTokenTime - startTime
      : undefined;

    debugLog('Response generated', {
      durationMs,
      textLength: result.text?.length ?? 0,
      finishReason: result.finishReason,
      stepsCount: result.steps?.length ?? 0,
      timeToFirstTokenMs,
    });

    // Extract tool calls from steps
    const { toolCalls, subAgentUsage } = extractToolCallsFromSteps(
      result.steps ?? [],
    );

    // Build complete context window for metadata (uses <details> for collapsible display)
    const contextWindowParts = [];
    if (instructions) {
      contextWindowParts.push(wrapInDetails('📋 System Prompt', instructions));
    }
    if (toolsSummary) {
      contextWindowParts.push(wrapInDetails('🔧 Tools', toolsSummary));
    }
    contextWindowParts.push(structuredThreadContext.threadContext);
    const completeContextWindow = contextWindowParts.join('\n\n');

    // Get actual model from response (no fallback to config)
    const actualModel = result.response?.modelId;

    // Augment context stats to include system prompt + tools tokens
    const systemPromptTokens = instructions ? estimateTokens(instructions) : 0;
    const toolsTokens = toolsSummary ? estimateTokens(toolsSummary) : 0;
    const contextStats = {
      ...structuredThreadContext.stats,
      totalTokens:
        structuredThreadContext.stats.totalTokens +
        systemPromptTokens +
        toolsTokens,
    };

    const responseResult: GenerateResponseResult = {
      threadId,
      text: result.text || '',
      usage: result.usage,
      finishReason: result.finishReason,
      durationMs,
      timeToFirstTokenMs,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      subAgentUsage: subAgentUsage.length > 0 ? subAgentUsage : undefined,
      contextWindow: completeContextWindow,
      contextStats,
      model: actualModel,
      provider,
    };

    // Call afterGenerate hook if provided
    if (hooks?.afterGenerate) {
      await hooks.afterGenerate(ctx, args, responseResult, hookData);
    }

    // Call unified completion handler (saves metadata + schedules summarization)
    await onAgentComplete(ctx, {
      threadId,
      agentType,
      result: {
        threadId,
        text: responseResult.text,
        model: actualModel,
        provider,
        usage: responseResult.usage,
        durationMs,
        timeToFirstTokenMs,
        toolCalls: responseResult.toolCalls,
        subAgentUsage: responseResult.subAgentUsage,
        contextWindow: completeContextWindow,
        contextStats: responseResult.contextStats,
      },
    });

    // Link approvals to message (only for main agent, not sub-agents)
    if (!parentThreadId) {
      try {
        const messagesResult = await listMessages(ctx, components.agent, {
          threadId,
          paginationOpts: { cursor: null, numItems: 50 },
          excludeToolMessages: false,
        });

        const latestAssistantMessage = messagesResult.page.find(
          (m: MessageDoc) => m.message?.role === 'assistant',
        );

        if (latestAssistantMessage) {
          const currentOrder = latestAssistantMessage.order;
          const messagesInSameOrder = messagesResult.page.filter(
            (m: MessageDoc) =>
              m.order === currentOrder && m.message?.role !== 'user',
          );

          messagesInSameOrder.sort(
            (a: MessageDoc, b: MessageDoc) => a.stepOrder - b.stepOrder,
          );
          const firstMessageInOrder =
            messagesInSameOrder[0] || latestAssistantMessage;

          const linkedCount = await ctx.runMutation(
            internal.approvals.internal_mutations.linkApprovalsToMessage,
            {
              threadId,
              messageId: firstMessageInOrder._id,
            },
          );
          if (linkedCount > 0) {
            debugLog(
              `Linked ${linkedCount} pending approvals to message ${firstMessageInOrder._id}`,
            );
          }
        }
      } catch (error) {
        console.error(
          '[generateAgentResponse] Failed to link approvals to message:',
          error,
        );
      }
    }

    // Complete stream if streamId provided
    if (streamId) {
      if (responseResult.text) {
        await ctx.runMutation(
          internal.streaming.internal_mutations.appendToStream,
          {
            streamId,
            text: responseResult.text,
          },
        );
      }
      await ctx.runMutation(
        internal.streaming.internal_mutations.completeStream,
        { streamId },
      );
    }

    return responseResult;
  } catch (error) {
    // Log the original error BEFORE calling any hooks
    const err = isRecord(error) ? error : { message: String(error) };
    console.error('[generateAgentResponse] ORIGINAL ERROR:', {
      name: getString(err, 'name'),
      message: getString(err, 'message'),
      code: getString(err, 'code'),
      status: err['status'],
      cause: err['cause'],
      stack: getString(err, 'stack'),
    });

    // Mark stream as errored
    if (streamId) {
      try {
        await ctx.runMutation(
          internal.streaming.internal_mutations.errorStream,
          { streamId },
        );
      } catch (streamError) {
        console.error(
          '[generateAgentResponse] Failed to mark stream as errored:',
          streamError,
        );
      }
    }

    throw error;
  }
}

/**
 * Extract tool calls and sub-agent usage from AI SDK steps.
 */
function extractToolCallsFromSteps(steps: unknown[]): {
  toolCalls: Array<{ toolName: string; status: string }>;
  subAgentUsage: Array<{
    toolName: string;
    model?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    durationMs?: number;
    input?: string;
    output?: string;
  }>;
} {
  type StepWithTools = {
    toolCalls?: Array<{ toolName: string }>;
    toolResults?: Array<{
      toolName: string;
      result?: unknown;
      output?: unknown;
    }>;
  };

  const subAgentToolNames = new Set([
    'workflow_assistant',
    'web_assistant',
    'document_assistant',
    'integration_assistant',
    'crm_assistant',
  ]);
  const toolCalls: Array<{ toolName: string; status: string }> = [];
  const subAgentUsage: Array<{
    toolName: string;
    model?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    durationMs?: number;
    input?: string;
    output?: string;
  }> = [];

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
  for (const step of steps as StepWithTools[]) {
    const stepToolCalls = step.toolCalls ?? [];
    const stepToolResults = step.toolResults ?? [];

    // Extract tool call statuses
    for (const toolCall of stepToolCalls) {
      const matchingResult = stepToolResults.find(
        (r) => r.toolName === toolCall.toolName,
      );
      const directSuccess =
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
        (matchingResult?.result as { success?: boolean } | undefined)?.success;
      const outputSuccess =
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
        (matchingResult?.output as { success?: boolean } | undefined)?.success;
      const isSuccess = directSuccess ?? outputSuccess ?? true;
      toolCalls.push({
        toolName: toolCall.toolName,
        status: isSuccess ? 'completed' : 'failed',
      });
    }

    // Extract sub-agent usage
    for (const toolResult of stepToolResults) {
      if (subAgentToolNames.has(toolResult.toolName)) {
        type SubAgentResultData = {
          model?: string;
          provider?: string;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            totalTokens?: number;
            durationSeconds?: number;
          };
          input?: string;
          output?: string;
        };
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
        const directResult = toolResult.result as
          | SubAgentResultData
          | undefined;
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
        const outputDirect = toolResult.output as
          | SubAgentResultData
          | undefined;
        const outputValue =
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
          (toolResult.output as { value?: SubAgentResultData } | undefined)
            ?.value;
        const hasRelevantData = (d: SubAgentResultData | undefined) =>
          d?.model !== undefined || d?.usage !== undefined;
        const subAgentData = hasRelevantData(directResult)
          ? directResult
          : hasRelevantData(outputDirect)
            ? outputDirect
            : outputValue;
        const toolUsage = subAgentData?.usage;
        if (toolUsage || subAgentData?.model) {
          subAgentUsage.push({
            toolName: toolResult.toolName,
            model: subAgentData?.model,
            provider: subAgentData?.provider,
            inputTokens: toolUsage?.inputTokens,
            outputTokens: toolUsage?.outputTokens,
            totalTokens: toolUsage?.totalTokens,
            durationMs: toolUsage?.durationSeconds
              ? Math.round(toolUsage.durationSeconds * 1000)
              : undefined,
            input: subAgentData?.input,
            output: subAgentData?.output,
          });
        }
      }
    }
  }

  return { toolCalls, subAgentUsage };
}

/**
 * Merge usage stats from two LLM calls.
 * Used when retrying with empty text.
 */
function mergeUsage(
  usage1?: GenerateResponseResult['usage'],
  usage2?: GenerateResponseResult['usage'],
): GenerateResponseResult['usage'] {
  if (!usage1) return usage2;
  if (!usage2) return usage1;
  return {
    inputTokens: (usage1.inputTokens ?? 0) + (usage2.inputTokens ?? 0),
    outputTokens: (usage1.outputTokens ?? 0) + (usage2.outputTokens ?? 0),
    totalTokens: (usage1.totalTokens ?? 0) + (usage2.totalTokens ?? 0),
    reasoningTokens:
      (usage1.reasoningTokens ?? 0) + (usage2.reasoningTokens ?? 0),
    cachedInputTokens:
      (usage1.cachedInputTokens ?? 0) + (usage2.cachedInputTokens ?? 0),
  };
}

/**
 * Determine if a retry is needed because tools were called but no
 * substantive follow-up text was generated.
 *
 * Catches two scenarios:
 * 1. Text is completely empty (LLM stopped right after tool calls)
 * 2. Text exists but is only a preamble before tool calls (e.g., "Let me check...")
 *    with no actual response incorporating the tool results
 */
function needsToolResultRetry(
  text: string | undefined,
  steps: unknown[] | undefined,
): boolean {
  if (!steps || steps.length === 0) return false;

  // Completely empty text always needs retry if there were steps
  if (!text?.trim()) return true;

  type StepLike = { toolCalls?: Array<{ toolName: string }>; text?: string };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data from AI SDK
  const typedSteps = steps as StepLike[];
  const hasToolSteps = typedSteps.some((s) => (s.toolCalls?.length ?? 0) > 0);
  if (!hasToolSteps) return false;

  const lastStep = typedSteps[typedSteps.length - 1];
  const lastStepHasToolCalls = (lastStep?.toolCalls?.length ?? 0) > 0;
  const lastStepText = lastStep?.text?.trim() ?? '';

  // Retry if:
  // - The last step itself has tool calls (response ended mid-tool-execution,
  //   LLM output like "Let me check..." is just preamble before tool calls)
  // - The last step (follow-up after tool results) has no text
  return lastStepHasToolCalls || !lastStepText;
}

/**
 * Extract unique tool names from AI SDK steps for fallback messages.
 */
function extractToolNamesFromSteps(steps: unknown[]): string[] {
  type StepWithToolCalls = { toolCalls?: Array<{ toolName: string }> };
  const names = new Set<string>();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data from AI SDK
  for (const step of steps as StepWithToolCalls[]) {
    for (const tc of step.toolCalls ?? []) {
      names.add(tc.toolName);
    }
  }
  return [...names];
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
