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

import { saveMessage } from '@convex-dev/agent';

import { components, internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import type { AgentAssistantContent } from '../../node_only/sandbox/agent_message_parts';
import {
  getVirtualKeySpendCents,
  revokeVirtualKey,
} from '../../node_only/sandbox/bifrost_admin';
import { sessionCancelExec } from '../../node_only/sandbox/helpers/session_client';
import type { RunAgentInSessionResult } from '../../node_only/sandbox/run_agent';

/** Pure runaway backstop on cross-action handoffs. The real bound on a long
 * task is the exec timeout (24h) + the rolling budget gate, not a count — at a
 * ~25min action window a 24h task is ~58 handoffs, so this is set well above
 * any legitimate run. */
const MAX_CONTINUATIONS = 1000;

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

    // Rolling-budget gate at the seam (never mid-exec). Poll the turn's VK for
    // cumulative in-task spend and re-check the org's rolling cap WITH that
    // spend folded in (prospectiveCostCents), so a long task's own burn counts
    // toward the cap continuously — not just via the retrospective ledger row
    // written at finalize. Over budget → seal the current segment cleanly and
    // STOP (the in-sandbox step already finished at this seam; we just don't
    // hand off). The clean alternative to a mid-exec SIGKILL. Userless/system
    // turns skip the gate (no per-user budget — matches the turn-start gate).
    let spentCents: number | undefined;
    if (turn.userId) {
      if (turn.mintedKeyId) {
        try {
          const polled = await getVirtualKeySpendCents(turn.mintedKeyId);
          if (polled !== null) spentCents = polled;
        } catch (spendErr) {
          console.warn('[handleTurnOutcome] VK spend poll failed:', spendErr);
        }
      }
      const verdict = await ctx.runQuery(
        internal.governance.internal_queries.evaluateExternalAgentBudget,
        {
          organizationId: turn.organizationId,
          userId: turn.userId,
          ...(spentCents !== undefined && { prospectiveCostCents: spentCents }),
        },
      );
      if (!verdict.allowed) {
        // Stop the in-sandbox agent FIRST: at a seam its exec is still running
        // under the detach-grace (the action just stopped draining). Without an
        // explicit cancel the agent keeps making LLM calls on the VK past the
        // cap until the grace reaps it. Best-effort; the VK revoke below + the
        // detach-grace are the backstops.
        await sessionCancelExec(turn.sessionId, turn.execId).catch((e) =>
          console.warn('[handleTurnOutcome] pause cancel exec failed:', e),
        );
        // Seal the current bubble (preserve its tool timeline) with a pause note
        // so the user sees why it stopped; the op carries pausedReason for the
        // management page. Then finalize (usage ledger + VK revoke + clear gen).
        await patchStreamingMessage(
          ctx,
          turn.assistantMessageId,
          appendPauseNote(result.assistantContent, verdict.reason),
          'success',
        );
        await ctx.runMutation(
          internal.sandbox.session_mutations.upsertSessionOp,
          {
            organizationId: turn.organizationId,
            sessionId: turn.sessionId,
            threadId: turn.threadId,
            execId: turn.execId,
            kind: 'agent-run',
            status: 'cancelled',
            heartbeatAt: Date.now(),
            pausedReason: 'budget',
            ...(spentCents !== undefined && { spentCents }),
          },
        );
        await finalizeTurnSideEffects(ctx, turn, turnTokensOf(result));
        return;
      }
    }

    // S4 segmentation: seal the current segment's message (success) and open a
    // FRESH streaming message for the next segment, so one long task renders as
    // an ordered sequence of bubbles, none of which approaches Convex's 1 MB doc
    // cap. The agent's exec keeps running (detach-grace) and `--resume` keeps the
    // conversation continuous — only the rendered message is segmented.
    // A quiet handoff (this segment produced nothing — e.g. the 25min window
    // elapsed during one long, silent tool) reuses the same message instead of
    // littering an empty bubble.
    let nextMessageId = turn.assistantMessageId;
    if (!isContentEmpty(result.assistantContent)) {
      await patchStreamingMessage(
        ctx,
        turn.assistantMessageId,
        result.assistantContent ?? '',
        'success',
      );
      const created = await saveMessage(ctx, components.agent, {
        threadId: turn.threadId,
        message: { role: 'assistant', content: '' },
        metadata: { status: 'pending' },
      });
      nextMessageId = created.messageId;
    }

    // Checkpoint is now just the resume cursor (+ captured agent session id) —
    // the timeline is NOT carried across the seam (each segment owns its own
    // message), which keeps the blob tiny and the handoff cheap.
    const checkpoint = JSON.stringify({
      lastSeq: result.lastSeq ?? 0,
      agentSessionId: result.agentSessionId,
    });
    // An untyped Blob sends an empty content-type header that self-hosted
    // Convex storage rejects ("Bad header for content-type") — set it.
    const storageId = await ctx.storage.store(
      new Blob([checkpoint], { type: 'application/json' }),
    );
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
      // The continuation streams into the fresh segment message — mirror it on
      // the op so the recovery watchdog finalizes the right (current) bubble.
      assistantMessageId: nextMessageId,
      // Live in-task spend for the management page (refreshed each seam).
      ...(spentCents !== undefined && { spentCents }),
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
        assistantMessageId: nextMessageId,
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

/** A continued segment that produced no renderable content — reuse its message
 * across the seam rather than sealing an empty bubble. */
function isContentEmpty(content: AgentAssistantContent | undefined): boolean {
  if (content === undefined) return true;
  return typeof content === 'string'
    ? content.trim().length === 0
    : content.length === 0;
}

/** Append a non-error pause note to the segment-so-far WITHOUT discarding its
 * tool timeline (mirror of run_external_agent's withErrorNote, for a clean
 * budget stop). The user resumes by sending a new message once budget frees. */
function appendPauseNote(
  content: AgentAssistantContent | undefined,
  reason?: string,
): AgentAssistantContent {
  const note = `\n\n⏸️ Paused — ${
    reason ?? 'usage limit reached for this period'
  }. Send a new message once budget is available to continue.`;
  if (content === undefined || isContentEmpty(content)) return note.trimStart();
  if (typeof content === 'string') return content + note;
  return [...content, { type: 'text', text: note.trimStart() }];
}

/** Load + parse a turn checkpoint blob ({lastSeq, agentSessionId}) from _storage.
 * Post-S4 the timeline is no longer carried — each segment renders into its own
 * message, so the checkpoint is just the resume cursor. */
export async function loadCheckpoint(
  ctx: ActionCtx,
  storageId: string,
): Promise<{ lastSeq: number; agentSessionId?: string } | null> {
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  const blob = await ctx.storage.get(storageId as any);
  if (!blob) return null;
  try {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return JSON.parse(await blob.text()) as {
      lastSeq: number;
      agentSessionId?: string;
    };
  } catch (err) {
    console.error('[turn_lifecycle] bad checkpoint blob:', err);
    return null;
  }
}
