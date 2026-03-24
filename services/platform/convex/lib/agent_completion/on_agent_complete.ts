/**
 * Unified Agent Completion Handler
 *
 * Called after any agent (routing or specialized) completes a response.
 * Handles saving message metadata (model, usage, reasoning, context stats).
 *
 * This function runs in action context and calls mutations as needed.
 */

import type { ActionCtx } from '../../_generated/server';

import { internal } from '../../_generated/api';
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
  messageId?: string;
  text?: string;
  model?: string;
  provider?: string;
  usage?: Usage;
  reasoning?: string;
  durationMs?: number;
  timeToFirstTokenMs?: number;
  toolCalls?: Array<{ toolName: string; status: string }>;
  toolsUsage?: Array<{
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
  };
  error?: string;
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
  if (!options?.skipMetadata) {
    const messageId = result.messageId;

    if (messageId) {
      try {
        await ctx.runMutation(
          internal.message_metadata.internal_mutations.saveMessageMetadata,
          {
            messageId,
            threadId,
            model: result.model,
            provider: result.provider,
            inputTokens: result.usage?.inputTokens,
            outputTokens: result.usage?.outputTokens,
            totalTokens: result.usage?.totalTokens,
            reasoningTokens: result.usage?.reasoningTokens,
            cachedInputTokens: result.usage?.cachedInputTokens,
            reasoning: result.reasoning,
            durationMs: result.durationMs,
            timeToFirstTokenMs: result.timeToFirstTokenMs,
            toolsUsage: result.toolsUsage,
            contextWindow: result.contextWindow,
            contextStats: result.contextStats,
            error: result.error,
          },
        );

        debugLog('Metadata saved', {
          threadId,
          agentType,
          messageId,
          model: result.model,
        });
      } catch (error) {
        console.error(`[${agentType}] Failed to save message metadata:`, {
          threadId,
          error,
        });
      }
    } else {
      debugLog('No messageId provided, skipping metadata save', {
        threadId,
        agentType,
      });
    }
  }
}
