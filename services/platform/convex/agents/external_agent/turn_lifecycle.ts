'use node';

// Shared lifecycle for an external-agent turn that is decoupled from any single
// action / HTTP connection.
//
//  - patchStreamingMessage / finalizeMessage: the persisted assistant message is
//    the single durable record (the live op only mirrors it).
//  - finalizeTurnSideEffects: VK revoke + usage ledger + clear generation,
//    guarded by an exactly-once claim so the initial action, a continuation, the
//    recovery watchdog, and cancel can all race safely.
//  - handleTurnOutcome: dispatch a runAgentInSessionImpl result — TERMINAL ⇒
//    finalize; 'continued' ⇒ checkpoint to _storage + schedule the continuation
//    action (the cross-30-min-ceiling handoff).

import type { AgentEvent } from '@tale/agent-adapters';

import { components, internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import type { AgentAssistantContent } from '../../node_only/sandbox/agent_message_parts';
import {
  getVirtualKeySpendCents,
  revokeVirtualKey,
} from '../../node_only/sandbox/bifrost_admin';
import type { RunAgentInSessionResult } from '../../node_only/sandbox/run_agent';

/** Cap on cross-action handoffs (the runnerd exec timeout bounds a turn well
 * before this; a backstop against a handoff loop). */
const MAX_CONTINUATIONS = 12;

/** Everything the lifecycle needs to finalize or continue a turn — carried in
 * action args and mirrored onto the op row so the recovery path has it too. */
export interface TurnContext {
  organizationId: string;
  sessionId: string;
  execId: string;
  threadId: string;
  agentKind: 'claude-code' | 'opencode';
  agentSlug?: string;
  modelRef: string;
  userId?: string;
  streamId?: string;
  assistantMessageId: string;
  mintedKeyId: string | null;
  continuationCount: number;
}

/** Patch the streaming assistant message's content in place (reactive read path
 * picks it up). The onTimeline mirror + the finalize both go through here. */
export async function patchStreamingMessage(
  ctx: ActionCtx,
  messageId: string,
  content: AgentAssistantContent,
  status?: 'success' | 'failed',
): Promise<void> {
  await ctx.runMutation(components.agent.messages.updateMessage, {
    messageId,
    patch: {
      ...(status !== undefined && { status }),
      message: { role: 'assistant', content },
    },
  });
}

/** Mark a streaming message terminal WITHOUT touching its content — preserves
 * the already-patched tool timeline (used when a continuation/recovery fails and
 * we only want to flip the status). */
export async function markMessageStatus(
  ctx: ActionCtx,
  messageId: string,
  status: 'success' | 'failed',
): Promise<void> {
  await ctx.runMutation(components.agent.messages.updateMessage, {
    messageId,
    patch: { status },
  });
}

/**
 * Terminal side-effects, exactly once. Returns true if THIS caller won the
 * finalize claim (and ran them), false if already finalized / op row gone.
 */
export async function finalizeTurnSideEffects(
  ctx: ActionCtx,
  turn: TurnContext,
  turnTokens?: { inputTokens: number; outputTokens: number } | null,
): Promise<boolean> {
  const claimed = await ctx.runMutation(
    internal.sandbox.session_mutations.claimSessionOpFinalize,
    { sessionId: turn.sessionId, execId: turn.execId },
  );
  if (!claimed) return false;

  if (turn.mintedKeyId) {
    try {
      // Bifrost aggregates per-VK spend asynchronously (~seconds); poll briefly.
      let costCents: number | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        costCents = await getVirtualKeySpendCents(turn.mintedKeyId);
        if ((costCents ?? 0) > 0) break;
        await new Promise((r) => setTimeout(r, 800));
      }
      const inputTokens = turnTokens?.inputTokens ?? 0;
      const outputTokens = turnTokens?.outputTokens ?? 0;
      if (inputTokens > 0 || outputTokens > 0 || (costCents ?? 0) > 0) {
        const colon = turn.modelRef.indexOf(':');
        const provider =
          colon === -1 ? undefined : turn.modelRef.slice(0, colon);
        await ctx.runMutation(
          internal.governance.internal_mutations.incrementUsageLedger,
          {
            organizationId: turn.organizationId,
            userId: turn.userId ?? 'system',
            inputTokens,
            outputTokens,
            costEstimateCents: costCents ?? 0,
            timestamp: Date.now(),
            agentSlug: turn.agentSlug ?? turn.agentKind,
            model: turn.modelRef,
            ...(provider ? { provider } : {}),
          },
        );
      }
    } catch (usageErr) {
      console.warn('[finalizeTurn] usage sync failed:', usageErr);
    }
    try {
      await revokeVirtualKey(turn.mintedKeyId);
    } catch (revokeErr) {
      console.warn('[finalizeTurn] VK revoke failed:', revokeErr);
    }
  }

  if (turn.streamId) {
    try {
      await ctx.runMutation(
        internal.threads.internal_mutations.clearGenerationStatus,
        { threadId: turn.threadId, streamId: turn.streamId },
      );
    } catch (clearErr) {
      console.error('[finalizeTurn] clear generation status failed:', clearErr);
    }
  }
  return true;
}

/**
 * Dispatch a turn result. TERMINAL ⇒ finalize the message + side-effects.
 * 'continued' ⇒ persist the timeline checkpoint to _storage, stamp the op, and
 * schedule the continuation action that re-attaches and resumes.
 */
export async function handleTurnOutcome(
  ctx: ActionCtx,
  turn: TurnContext,
  result: RunAgentInSessionResult,
): Promise<void> {
  if (result.status === 'continued') {
    if (turn.continuationCount >= MAX_CONTINUATIONS) {
      // Runaway guard: stop handing off, finalize as failed.
      await patchStreamingMessage(
        ctx,
        turn.assistantMessageId,
        result.assistantContent ?? 'Agent run exceeded the continuation limit.',
        'failed',
      );
      await finalizeTurnSideEffects(ctx, turn, turnTokensOf(result));
      return;
    }
    const checkpoint = JSON.stringify({
      timeline: result.timeline ?? [],
      lastSeq: result.lastSeq ?? 0,
      agentSessionId: result.agentSessionId,
      finalText: result.finalText,
    });
    const storageId = await ctx.storage.store(new Blob([checkpoint]));
    await ctx.runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
      organizationId: turn.organizationId,
      sessionId: turn.sessionId,
      threadId: turn.threadId,
      execId: turn.execId,
      kind: 'agent-run',
      status: 'running',
      heartbeatAt: Date.now(),
      lastSeq: result.lastSeq ?? 0,
      checkpointStorageId: storageId,
      continuationCount: turn.continuationCount + 1,
      ...(result.agentSessionId !== undefined && {
        agentSessionId: result.agentSessionId,
      }),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.agents.external_agent.continue_external_agent_turn
        .continueExternalAgentTurn,
      {
        organizationId: turn.organizationId,
        sessionId: turn.sessionId,
        execId: turn.execId,
        threadId: turn.threadId,
        agentKind: turn.agentKind,
        modelRef: turn.modelRef,
        assistantMessageId: turn.assistantMessageId,
        mintedKeyId: turn.mintedKeyId,
        continuationCount: turn.continuationCount + 1,
        checkpointStorageId: storageId,
        ...(turn.agentSlug !== undefined && { agentSlug: turn.agentSlug }),
        ...(turn.userId !== undefined && { userId: turn.userId }),
        ...(turn.streamId !== undefined && { streamId: turn.streamId }),
      },
    );
    return;
  }

  // Terminal: finalize the message in place + run the side-effects.
  const finalText =
    result.finalText ??
    (result.status === 'completed'
      ? 'Agent run completed.'
      : `Agent run ${result.status}.`);
  const content =
    result.assistantContent !== undefined &&
    (typeof result.assistantContent !== 'string' ||
      result.assistantContent.length > 0)
      ? result.assistantContent
      : finalText;
  await patchStreamingMessage(
    ctx,
    turn.assistantMessageId,
    content,
    result.status === 'completed' ? 'success' : 'failed',
  );
  await finalizeTurnSideEffects(ctx, turn, turnTokensOf(result));
}

function turnTokensOf(
  result: RunAgentInSessionResult,
): { inputTokens: number; outputTokens: number } | null {
  return result.usage
    ? {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      }
    : null;
}

/** Load + parse a turn checkpoint blob ({timeline, lastSeq, ...}) from _storage. */
export async function loadCheckpoint(
  ctx: ActionCtx,
  storageId: string,
): Promise<{
  timeline: AgentEvent[];
  lastSeq: number;
  agentSessionId?: string;
  finalText?: string;
} | null> {
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  const blob = await ctx.storage.get(storageId as any);
  if (!blob) return null;
  try {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return JSON.parse(await blob.text()) as {
      timeline: AgentEvent[];
      lastSeq: number;
      agentSessionId?: string;
      finalText?: string;
    };
  } catch (err) {
    console.error('[turn_lifecycle] bad checkpoint blob:', err);
    return null;
  }
}
