/**
 * Unified Agent Completion Handler
 *
 * Called after any agent (routing or specialized) completes a response.
 * Handles saving message metadata (model, usage, reasoning, context stats).
 *
 * This function runs in action context and calls mutations as needed.
 */

import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { estimateCostCents } from '../../governance/cost_estimation';
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
  organizationId?: string;
  userId?: string;
  teamIds?: string[];
  agentSlug?: string;
  providerCost?: {
    inputCentsPerMillion: number;
    outputCentsPerMillion: number;
  };
  options?: {
    skipMetadata?: boolean;
  };
}

export async function onAgentComplete(
  ctx: ActionCtx,
  args: OnAgentCompleteArgs,
): Promise<void> {
  const {
    threadId,
    agentType,
    result,
    organizationId,
    userId,
    teamIds,
    options,
  } = args;

  debugLog('onAgentComplete called', {
    threadId,
    agentType,
    model: result.model,
    hasUsage: !!result.usage,
  });

  const promises: Promise<unknown>[] = [];

  // Compute cost estimate (used by both metadata save and ledger)
  const msgInputTokens = result.usage?.inputTokens ?? 0;
  const msgOutputTokens = result.usage?.outputTokens ?? 0;
  const costCents =
    msgInputTokens > 0 || msgOutputTokens > 0
      ? estimateCostCents(
          result.model,
          msgInputTokens,
          msgOutputTokens,
          args.providerCost,
        )
      : undefined;

  // Step 1: Save message metadata (unless skipped)
  if (!options?.skipMetadata) {
    const messageId = result.messageId;

    if (messageId) {
      promises.push(
        ctx
          .runMutation(
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
              costEstimateCents: costCents,
            },
          )
          .then(() => {
            debugLog('Metadata saved', {
              threadId,
              agentType,
              messageId,
              model: result.model,
            });
          })
          .catch((error) => {
            console.error(`[${agentType}] Failed to save message metadata:`, {
              threadId,
              error,
            });
          }),
      );
    } else {
      debugLog('No messageId provided, skipping metadata save', {
        threadId,
        agentType,
      });
    }
  }

  // Step 2: Increment usage ledger
  const totalTokens = msgInputTokens + msgOutputTokens;

  if (totalTokens > 0 && organizationId && userId && costCents != null) {
    const timestamp = Date.now();

    const ledgerTeamIds = teamIds && teamIds.length > 0 ? teamIds : [undefined];

    for (const teamId of ledgerTeamIds) {
      promises.push(
        ctx
          .runMutation(
            internal.governance.internal_mutations.incrementUsageLedger,
            {
              organizationId,
              userId,
              teamId,
              inputTokens: msgInputTokens,
              outputTokens: msgOutputTokens,
              costEstimateCents: costCents,
              timestamp,
            },
          )
          .catch((error) => {
            console.error(`[${agentType}] Failed to increment usage ledger:`, {
              threadId,
              teamId,
              error,
            });
          }),
      );
    }

    // AI audit log for usage tracking
    promises.push(
      ctx
        .runMutation(internal.audit_logs.internal_mutations.createAuditLog, {
          organizationId,
          actorId: userId,
          actorType: 'user' as const,
          action: result.error ? 'ai.completion_failed' : 'ai.completion',
          category: 'ai' as const,
          resourceType: 'agent_completion',
          resourceId: result.messageId,
          resourceName: args.agentSlug,
          status: result.error ? ('failure' as const) : ('success' as const),
          errorMessage: result.error,
          metadata: {
            model: result.model,
            provider: result.provider,
            inputTokens: result.usage?.inputTokens,
            outputTokens: result.usage?.outputTokens,
            totalTokens: result.usage?.totalTokens,
            reasoningTokens: result.usage?.reasoningTokens,
            cachedInputTokens: result.usage?.cachedInputTokens,
            costEstimateCents: costCents,
            durationMs: result.durationMs,
            timeToFirstTokenMs: result.timeToFirstTokenMs,
            threadId,
            agentType,
            agentSlug: args.agentSlug,
            toolCallCount: result.toolCalls?.length,
            toolNames: result.toolCalls?.map((tc) => tc.toolName),
          },
        })
        .catch((error) => {
          console.error(`[${agentType}] Failed to write AI audit log:`, {
            threadId,
            error,
          });
        }),
    );
  }

  await Promise.all(promises);
}
