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
 * - Hooks system for customizing the pipeline (beforeContext, beforeGenerate, afterGenerate, onError)
 * - Automatic tool call extraction and sub-agent usage tracking
 * - Context window building and token estimation
 */

import { components } from '../../_generated/api';
import { listMessages, type MessageDoc } from '@convex-dev/agent';
import {
  buildStructuredContext,
  AGENT_CONTEXT_CONFIGS,
  estimateTokens,
} from '../context_management';
import { onAgentComplete } from '../agent_completion';
import { formatCurrentTurn, type CurrentTurnToolCall } from '../context_management/message_formatter';
import { createDebugLog } from '../debug_log';
import {
  getLinkApprovalsToMessageRef,
  getStartStreamRef,
  getAppendToStreamRef,
  getCompleteStreamRef,
  getErrorStreamRef,
} from '../function_refs';
import type {
  GenerateResponseConfig,
  GenerateResponseArgs,
  GenerateResponseResult,
  BeforeContextResult,
} from './types';

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
  const { agentType, createAgent, model, provider, debugTag, enableStreaming, hooks } = config;
  const {
    ctx,
    threadId,
    userId,
    organizationId,
    taskDescription,
    additionalContext,
    parentThreadId,
    agentOptions,
    streamId,
    promptMessageId,
    maxSteps,
    userTeamIds,
  } = args;

  const debugLog = createDebugLog(`DEBUG_${agentType.toUpperCase()}_AGENT`, debugTag);
  const startTime = Date.now();

  try {
    debugLog(`generate${capitalize(agentType)}Response called`, {
      threadId,
      userId,
      organizationId,
      hasParentThread: !!parentThreadId,
      additionalContextKeys: additionalContext ? Object.keys(additionalContext) : [],
      enableStreaming,
    });

    // Start stream if streamId provided
    if (streamId) {
      await ctx.runMutation(getStartStreamRef(), { streamId });
    }

    // Call beforeContext hook if provided
    let hookData: BeforeContextResult | undefined;
    if (hooks?.beforeContext) {
      hookData = await hooks.beforeContext(ctx, args);
    }

    // Build structured context using the unified approach
    const agentConfig = AGENT_CONTEXT_CONFIGS[agentType];
    const structuredContext = await buildStructuredContext({
      ctx,
      threadId,
      taskDescription,
      additionalContext,
      parentThreadId,
      maxMessages: agentConfig.recentMessages,
      contextSummary: hookData?.contextSummary,
      ragContext: hookData?.ragContext,
      integrationsInfo: hookData?.integrationsInfo,
    });

    debugLog('Context built', {
      estimatedTokens: structuredContext.stats.totalTokens,
      messageCount: structuredContext.stats.messageCount,
    });

    // Call beforeGenerate hook if provided
    let promptContent = structuredContext.messages;
    let systemContextMessages = structuredContext.messages;
    if (hooks?.beforeGenerate) {
      const beforeResult = await hooks.beforeGenerate(ctx, args, structuredContext, hookData);
      if (beforeResult.promptContent) {
        promptContent = beforeResult.promptContent;
      }
      if (beforeResult.systemContextMessages) {
        systemContextMessages = beforeResult.systemContextMessages;
      }
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
      ...(hookData?.ragPrefetchCache ? { ragPrefetchCache: hookData.ragPrefetchCache } : {}),
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

    if (enableStreaming) {
      // Streaming mode (chat agent)
      const streamResult = await agent.streamText(
        contextWithOrg,
        { threadId, userId },
        {
          promptMessageId,
          messages: systemContextMessages,
          prompt: promptContent,
          onChunk: ({ chunk }: { chunk: { type: string } }) => {
            if (firstTokenTime === null && chunk.type === 'text-delta') {
              firstTokenTime = Date.now();
            }
          },
        },
        {
          contextOptions: {
            recentMessages: 0,
            excludeToolMessages: false,
            searchOtherThreads: false,
          },
          saveStreamDeltas: true,
        },
      );

      // Wait for stream to complete
      const [streamText, streamSteps, streamUsage, streamFinishReason, streamResponse] = await Promise.all([
        streamResult.text,
        streamResult.steps,
        streamResult.usage,
        streamResult.finishReason,
        streamResult.response,
      ]);

      result = {
        text: streamText,
        steps: streamSteps,
        usage: streamUsage,
        finishReason: streamFinishReason,
        response: streamResponse,
      };
    } else {
      // Non-streaming mode (sub-agents)
      // Extend context with parentThreadId for human input card linking
      const subAgentContext = parentThreadId
        ? { ...ctx, parentThreadId, organizationId }
        : { ...ctx, organizationId };

      const generateResult = await agent.generateText(
        subAgentContext,
        { threadId, userId },
        {
          messages: structuredContext.messages,
        },
        {
          contextOptions: {
            recentMessages: 0,
            excludeToolMessages: false,
          },
        },
      );

      result = {
        text: generateResult.text,
        steps: generateResult.steps,
        usage: generateResult.usage,
        finishReason: generateResult.finishReason,
      };
    }

    const durationMs = Date.now() - startTime;
    const timeToFirstTokenMs = firstTokenTime ? firstTokenTime - startTime : undefined;

    debugLog('Response generated', {
      durationMs,
      textLength: result.text?.length ?? 0,
      finishReason: result.finishReason,
      stepsCount: result.steps?.length ?? 0,
      timeToFirstTokenMs,
    });

    // Extract tool calls from steps
    const { toolCalls, subAgentUsage } = extractToolCallsFromSteps(result.steps ?? []);

    // Build complete context window for metadata
    const currentTurnFormatted = formatCurrentTurn({
      userInput: taskDescription,
      assistantOutput: result.text || '',
      toolCalls: toolCalls.length > 0 ? toolCalls as CurrentTurnToolCall[] : undefined,
      timestamp: Date.now(),
    });
    const completeContextWindow =
      structuredContext.contextText + '\n\n' + currentTurnFormatted;
    const currentTurnTokens = estimateTokens(currentTurnFormatted);

    // Get actual model from response or fall back to config
    const actualModel = result.response?.modelId || model;

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
      contextStats: {
        ...structuredContext.stats,
        totalTokens: structuredContext.stats.totalTokens + currentTurnTokens,
      },
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
          (m: MessageDoc) => m.message?.role === 'assistant'
        );

        if (latestAssistantMessage) {
          const currentOrder = latestAssistantMessage.order;
          const messagesInSameOrder = messagesResult.page.filter(
            (m: MessageDoc) => m.order === currentOrder && m.message?.role !== 'user'
          );

          messagesInSameOrder.sort((a: MessageDoc, b: MessageDoc) => a.stepOrder - b.stepOrder);
          const firstMessageInOrder = messagesInSameOrder[0] || latestAssistantMessage;

          const linkedCount = await ctx.runMutation(
            getLinkApprovalsToMessageRef(),
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
        console.error('[generateAgentResponse] Failed to link approvals to message:', error);
      }
    }

    // Complete stream if streamId provided
    if (streamId && responseResult.text) {
      await ctx.runMutation(getAppendToStreamRef(), {
        streamId,
        text: responseResult.text,
      });
      await ctx.runMutation(getCompleteStreamRef(), { streamId });
    }

    return responseResult;
  } catch (error) {
    // Mark stream as errored
    if (streamId) {
      try {
        await ctx.runMutation(getErrorStreamRef(), { streamId });
      } catch (streamError) {
        console.error('[generateAgentResponse] Failed to mark stream as errored:', streamError);
      }
    }

    // Call onError hook if provided
    if (hooks?.onError) {
      await hooks.onError(ctx, args, error);
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
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
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

  const subAgentToolNames = ['workflow_assistant', 'web_assistant', 'document_assistant', 'integration_assistant', 'crm_assistant'];
  const toolCalls: Array<{ toolName: string; status: string }> = [];
  const subAgentUsage: Array<{
    toolName: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }> = [];

  for (const step of steps as StepWithTools[]) {
    const stepToolCalls = step.toolCalls ?? [];
    const stepToolResults = step.toolResults ?? [];

    // Extract tool call statuses
    for (const toolCall of stepToolCalls) {
      const matchingResult = stepToolResults.find(r => r.toolName === toolCall.toolName);
      const directSuccess = (matchingResult?.result as { success?: boolean } | undefined)?.success;
      const outputSuccess = (matchingResult?.output as { success?: boolean } | undefined)?.success;
      const isSuccess = directSuccess ?? outputSuccess ?? true;
      toolCalls.push({
        toolName: toolCall.toolName,
        status: isSuccess !== false ? 'completed' : 'failed',
      });
    }

    // Extract sub-agent usage
    for (const toolResult of stepToolResults) {
      if (subAgentToolNames.includes(toolResult.toolName)) {
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

  return { toolCalls, subAgentUsage };
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
