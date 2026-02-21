/**
 * Unified Agent Completion Handler
 *
 * Called after any agent (routing or specialized) completes a response.
 * Handles saving message metadata (model, usage, reasoning, context stats).
 *
 * This function runs in action context and calls mutations as needed.
 */

import { listMessages } from '@convex-dev/agent';

import type { ActionCtx } from '../../_generated/server';

import { components, internal } from '../../_generated/api';
import { createDebugLog } from '../debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_COMPLETION', '[AgentCompletion]');

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

export interface AgentResponseResult {
  threadId: string;
  text?: string;
  model?: string;
  provider?: string;
  usage?: Usage;
  reasoning?: string;
  durationMs?: number;
  timeToFirstTokenMs?: number;
  toolCalls?: Array<{ toolName: string; status: string }>;
  subAgentUsage?: Array<{
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
  contextWindow?: string;
  contextStats?: {
    totalTokens: number;
    messageCount: number;
    approvalCount: number;
    hasRag: boolean;
    hasWebContext: boolean;
    hasIntegrations: boolean;
  };
}

export interface OnAgentCompleteArgs {
  threadId: string;
  agentType: string;
  result: AgentResponseResult;
  options?: {
    skipMetadata?: boolean;
  };
}

export async function onAgentComplete(
  ctx: ActionCtx,
  args: OnAgentCompleteArgs,
): Promise<void> {
  const { threadId, agentType, result, options } = args;

  debugLog('onAgentComplete called', {
    threadId,
    agentType,
    model: result.model,
    hasUsage: !!result.usage,
  });

  // Step 1: Save message metadata (unless skipped)
  if (!options?.skipMetadata && result.usage) {
    try {
      // Find the first assistant message in the current response
      // This matches the UIMessage.id logic used by @convex-dev/agent
      const messages = await listMessages(ctx, components.agent, {
        threadId,
        paginationOpts: { cursor: null, numItems: 20 },
        excludeToolMessages: false,
      });

      const sortedMessages = messages.page.sort(
        (a, b) => b._creationTime - a._creationTime,
      );

      const latestAssistantMessage = sortedMessages.find(
        (msg) => msg.message?.role === 'assistant',
      );

      if (latestAssistantMessage) {
        const currentOrder = latestAssistantMessage.order;

        // Find the FIRST message (by stepOrder) in this response group
        const messagesInCurrentResponse = sortedMessages
          .filter(
            (msg) =>
              msg.order === currentOrder &&
              (msg.message?.role === 'assistant' ||
                msg.message?.role === 'tool'),
          )
          .sort((a, b) => a.stepOrder - b.stepOrder);

        const firstMessageInResponse = messagesInCurrentResponse[0];

        if (firstMessageInResponse) {
          await ctx.runMutation(
            internal.message_metadata.internal_mutations.saveMessageMetadata,
            {
              messageId: firstMessageInResponse._id,
              threadId,
              model: result.model,
              provider: result.provider,
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              totalTokens: result.usage.totalTokens,
              reasoningTokens: result.usage.reasoningTokens,
              cachedInputTokens: result.usage.cachedInputTokens,
              reasoning: result.reasoning,
              durationMs: result.durationMs,
              timeToFirstTokenMs: result.timeToFirstTokenMs,
              subAgentUsage: result.subAgentUsage,
              contextWindow: result.contextWindow,
              contextStats: result.contextStats,
            },
          );

          debugLog('Metadata saved', {
            threadId,
            agentType,
            messageId: firstMessageInResponse._id,
            model: result.model,
          });
        }
      }
    } catch (error) {
      // Non-fatal: log and continue
      console.error(`[${agentType}] Failed to save message metadata:`, {
        threadId,
        error,
      });
    }
  }
}
