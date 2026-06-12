/**
 * Shared single-delegate executor.
 *
 * The core "run one delegate agent in a sub-thread and return a ToolResponse"
 * sequence, factored out of `createDelegationTool` so BOTH agent-initiated
 * delegation (the tool) and router-driven orchestration (`execute_plan.ts`)
 * share one code path. Sub-thread reuse, budget/deadline propagation,
 * governance-skip (via `parentThreadId`), and failover therefore behave
 * identically in both modes.
 */

import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import type { SerializableAgentConfig } from '../../lib/agent_chat/types';
import { persistentStreaming } from '../../streaming/helpers';
import {
  handleToolError,
  successResponse,
  type ToolResponse,
} from '../sub_agents/helpers/tool_response';
import type { DelegateAgentMeta } from './create_delegation_tool';

/**
 * The double-delegation guard: when an orchestrated leaf delegate runs, strip
 * its delegation entirely so it can't re-delegate (the router owns
 * decomposition). Returns the config UNCHANGED when not stripping, and never
 * mutates the input. Uses the explicit `delegationDisabled` flag — delegates
 * are derived from the org chart at tool-build time, so only this flag
 * reliably disables delegation.
 */
export function applyDelegationStrip(
  config: SerializableAgentConfig,
  strip: boolean | undefined,
): SerializableAgentConfig {
  return strip ? { ...config, delegationDisabled: true } : config;
}

export interface RunDelegateStepArgs {
  parentThreadId: string;
  organizationId: string;
  userId?: string;
  delegate: DelegateAgentMeta;
  /** The instruction handed to the delegate (sub-task + any upstream context). */
  prompt: string;
  /** Wall-clock deadline propagated from the parent action's budget. */
  deadlineMs?: number;
  /**
   * When true, run the delegate with its own delegation tools stripped so it
   * cannot re-delegate. The router orchestrator owns decomposition; leaf
   * delegates just answer (the double-delegation guard).
   */
  stripDelegation?: boolean;
  /**
   * When true, stream the delegate's reasoning/tool deltas to a sub-stream so
   * the parent UI can render a live, nested timeline under the `delegate_*`
   * tool row. The interactive `delegate_*` tool sets this; the non-interactive
   * router orchestrator (`execute_plan.ts`) leaves it off (no one is watching a
   * live timeline, so an extra stream would just be write-amplification).
   */
  streamSubAgent?: boolean;
}

/**
 * Run one delegate agent in its (reused or freshly-created) sub-thread and
 * return a structured `ToolResponse`. Never throws — failures become an error
 * `ToolResponse` so callers can aggregate partial results.
 */
export async function runDelegateStep(
  ctx: ActionCtx,
  args: RunDelegateStepArgs,
  label = `[Delegate:${args.delegate.displayName}]`,
): Promise<ToolResponse> {
  const { delegate, parentThreadId, organizationId, userId } = args;
  try {
    const { threadId: subThreadId, isNew } = await getSubThread(
      ctx,
      parentThreadId,
      delegate.agentSlug,
      userId,
    );
    console.log(
      `${label} Sub-thread:`,
      subThreadId,
      isNew ? '(new)' : '(reused)',
    );

    // Monetary guard: a budget-paused delegate runs nothing, anywhere. The
    // parent agent gets a structured error so it can handle the sub-task
    // itself or escalate. (Concurrency caps deliberately do NOT apply to
    // synchronous, human-attended delegation — see guard_core.ts.)
    const guardVerdict = await ctx.runQuery(
      internal.agents.guardrails.budget_guard.checkAgentRunAllowed,
      {
        organizationId,
        agentSlug: delegate.agentSlug,
        context: 'delegation',
        budget: delegate.agentConfig.budget,
      },
    );
    if (!guardVerdict.allowed) {
      return handleToolError(
        label,
        new Error(
          `Delegate ${delegate.displayName} is unavailable: monthly budget exhausted. Handle this part yourself or escalate.`,
        ),
      );
    }
    const prompt = guardVerdict.warningInstruction
      ? `${guardVerdict.warningInstruction}\n\n${args.prompt}`
      : args.prompt;

    const agentConfig = applyDelegationStrip(
      delegate.agentConfig,
      args.stripDelegation,
    );

    // When streaming, pre-allocate a stream on the sub-thread so the delegate's
    // reasoning/tool deltas are persisted there and the parent UI can subscribe
    // to a live nested timeline. `generateAgentResponse` finalizes/tombstones
    // the stream on completion or error, so no manual cleanup is needed here.
    const subStreamId = args.streamSubAgent
      ? await persistentStreaming.createStream(ctx)
      : undefined;

    const result = await ctx.runAction(
      internal.lib.agent_chat.internal_actions.runAgentGeneration,
      {
        agentType: 'custom',
        agentConfig,
        model: delegate.model,
        provider: delegate.provider,
        debugTag: label,
        enableStreaming: subStreamId !== undefined,
        ...(subStreamId !== undefined ? { streamId: subStreamId } : {}),
        threadId: subThreadId,
        organizationId,
        userId,
        promptMessage: prompt,
        parentThreadId,
        deadlineMs: args.deadlineMs,
        maxSteps: agentConfig.maxSteps,
      },
    );

    return successResponse(
      result.text,
      {
        ...result.usage,
        durationSeconds:
          result.durationMs !== undefined
            ? result.durationMs / 1000
            : undefined,
      },
      result.model,
      result.provider,
      undefined,
      prompt,
      subStreamId !== undefined ? { subThreadId, subStreamId } : undefined,
    );
  } catch (error) {
    return handleToolError(label, error);
  }
}

// Lazy import keeps the eager module graph small; the helper itself is cheap.
async function getSubThread(
  ctx: ActionCtx,
  parentThreadId: string,
  subAgentType: string,
  userId?: string,
): Promise<{ threadId: string; isNew: boolean }> {
  const { getOrCreateSubThread } =
    await import('../sub_agents/helpers/get_or_create_sub_thread');
  return getOrCreateSubThread(ctx, { parentThreadId, subAgentType, userId });
}
