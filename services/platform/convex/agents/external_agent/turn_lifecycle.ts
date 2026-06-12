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
import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import type { AgentAssistantContent } from '../../node_only/sandbox/agent_message_parts';
import {
  getVirtualKeySpendCents,
  revokeVirtualKey,
} from '../../node_only/sandbox/bifrost_admin';
import {
  sessionCancelExec,
  sessionListFiles,
} from '../../node_only/sandbox/helpers/session_client';
import type { RunAgentInSessionResult } from '../../node_only/sandbox/run_agent';
import {
  matchConsumedSteerFiles,
  steerDirFor,
} from '../../node_only/sandbox/steer_files';

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
  /** Turn permission posture (plan = read-only planning turn). Fixed at exec
   * start for the whole turn; continuations carry it so the terminal plan
   * detection below knows how the turn ran. */
  permissionMode?: 'plan' | 'execute';
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

  // Steer reconciliation — MUST run before clearGenerationStatus below, whose
  // queue drain has to see any rows this rolls back to 'queued'. A staged file
  // the hook consumed is in the agent transcript (--resume carries it); an
  // unconsumed one re-queues for the boundary drain. On any doubt (session
  // gone, listing failed) we re-queue: at-least-once across turns.
  await reconcileSteeredMessages(ctx, turn);

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

/** Terminal steer-delivery reconciliation: flip rows whose staged file the
 * in-sandbox hook consumed to 'consumed', roll everything else back to
 * 'queued'. Best-effort transport; the safe default on failure is re-queue. */
async function reconcileSteeredMessages(
  ctx: ActionCtx,
  turn: TurnContext,
): Promise<void> {
  try {
    const delivered = await ctx.runQuery(
      internal.threads.message_queue.listDeliveredForExec,
      { threadId: turn.threadId, execId: turn.execId },
    );
    if (delivered.length === 0) return;

    // Marker evidence only applies to file-channel rows. A stdin-channel row
    // is confirmed by the drain (next agent result) or not at all — its
    // tombstoned file may carry a consumed.* marker that says nothing about
    // whether the stdin push was processed, so trusting it could lose the
    // message. Unconfirmed stdin rows fall into reconcileDelivered's rollback
    // branch (re-queued, at-least-once).
    const fileRows = delivered.filter((row) => row.channel === 'file');

    let entries: Awaited<ReturnType<typeof sessionListFiles>> = null;
    if (fileRows.length > 0) {
      try {
        entries = await sessionListFiles(
          turn.sessionId,
          steerDirFor(turn.execId),
        );
      } catch (listErr) {
        console.warn(
          '[finalizeTurn] steer dir listing failed (re-queueing):',
          listErr,
        );
      }
    }

    // null listing (dir/session gone or the catch above) ⇒ [] ⇒ everything
    // rolls back to 'queued' — identical failure semantics to before.
    const consumedMessageIds = matchConsumedSteerFiles(fileRows, entries);
    await ctx.runMutation(internal.threads.message_queue.reconcileDelivered, {
      threadId: turn.threadId,
      execId: turn.execId,
      consumedMessageIds,
    });
  } catch (err) {
    console.warn('[finalizeTurn] steer reconciliation failed:', err);
  }
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
    // littering an empty bubble — EXCEPT at a steer seam: there the whole point
    // is conversational order (the fresh message must sit BELOW the user
    // message that was just steered in), so an empty segment's bubble is
    // replaced (created fresh, the empty one deleted) rather than reused.
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
    } else if (result.steerSeam === true) {
      const created = await saveMessage(ctx, components.agent, {
        threadId: turn.threadId,
        message: { role: 'assistant', content: '' },
        metadata: { status: 'pending' },
      });
      nextMessageId = created.messageId;
      await ctx
        .runMutation(components.agent.messages.deleteByIds, {
          messageIds: [turn.assistantMessageId],
        })
        .catch((err: unknown) =>
          console.warn(
            '[handleTurnOutcome] empty steer-seam bubble delete failed:',
            err,
          ),
        );
    }

    // Checkpoint is now just the resume cursor (+ captured agent session id) —
    // the timeline is NOT carried across the seam (each segment owns its own
    // message), which keeps the blob tiny and the handoff cheap.
    const checkpoint = JSON.stringify({
      lastSeq: result.lastSeq ?? 0,
      agentSessionId: result.agentSessionId,
      // Plan captured by this segment (ExitPlanMode) — the continuation seeds
      // its capture state from this so the terminal segment's detection sees
      // it (still subject to run_agent's execute-mode reset rule).
      ...(result.planText !== undefined && { planText: result.planText }),
      // toolUseId → toolName across the whole turn so far, so a post-seam
      // segment can name the orphan results of pre-seam tool calls instead of
      // rendering them as a bare "Tool" (long parallel subagent calls
      // routinely straddle seams).
      ...(result.toolNames !== undefined && { toolNames: result.toolNames }),
      // stdin-hold lifecycle (claude-code): whether the per-turn agent result
      // already streamed (pre-seam) and which background tasks were still
      // pending — the continuation's linger loop must not EOF a process whose
      // pending tasks it never saw start.
      ...(result.agentResultSeen === true && { agentResultSeen: true }),
      ...(result.agentIdle === true && { agentIdle: true }),
      ...(result.pendingTaskIds !== undefined &&
        result.pendingTaskIds.length > 0 && {
          pendingTaskIds: result.pendingTaskIds,
        }),
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
      // Pre-seam events belong to the just-sealed segment's bubble; left in
      // place they'd flash as stale rows in the post-send live timeline while
      // the fresh segment message is still empty. The continuation's flush
      // buffer starts empty, so it only ever re-fills with post-seam events.
      recentEvents: [],
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
        ...(turn.permissionMode !== undefined && {
          permissionMode: turn.permissionMode,
        }),
      },
    );
    return;
  }

  // Terminal: finalize the message in place + run the side-effects.
  //
  // 'cancelled' is a user Stop, not an error — mirror the SDK cancel semantics
  // (threads/cancel_generation.ts): keep whatever streamed as a normal success
  // bubble; if nothing renderable streamed, flip status only so the UI renders
  // the clean aborted bubble (status failed + empty text), never the
  // "Something went wrong" error card.
  if (result.status === 'cancelled') {
    const streamed = result.assistantContent;
    if (streamed === undefined || isContentEmpty(streamed)) {
      await markMessageStatus(ctx, turn.assistantMessageId, 'failed');
    } else {
      await patchStreamingMessage(
        ctx,
        turn.assistantMessageId,
        streamed,
        'success',
      );
    }
    await finalizeTurnSideEffects(ctx, turn, turnTokensOf(result));
    return;
  }

  // Zero-output completion (empty-but-200 model response): render an honest
  // failed bubble instead of a success "Agent run completed." — the run did
  // nothing the user can use, and the failed state carries the Try-again
  // affordance. Only for a single-segment turn: a continued turn's empty
  // FINAL segment is normal (earlier segments hold the work) and keeps the
  // fallback below. run_external_agent retries once before this is reached.
  if (
    turn.continuationCount === 0 &&
    isEmptyCompletedTurn(result, turn.permissionMode)
  ) {
    await patchStreamingMessage(
      ctx,
      turn.assistantMessageId,
      EMPTY_TURN_MESSAGE,
      'failed',
    );
    await finalizeTurnSideEffects(ctx, turn, turnTokensOf(result));
    return;
  }

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
  // Plan proposal → approval card (any terminal status except cancelled — a
  // plan captured before a max-turns/error end is still worth reviewing).
  // Best-effort: a card failure must never skip finalize (VK revoke, ledger).
  const plan = resolvePlanText(result, turn.permissionMode);
  if (plan !== null) {
    try {
      await ctx.runMutation(
        internal.approvals.internal_mutations.createPlanApproval,
        {
          organizationId: turn.organizationId,
          threadId: turn.threadId,
          messageId: turn.assistantMessageId,
          agentSlug: turn.agentSlug ?? turn.agentKind,
          modelRef: turn.modelRef,
          plan,
          planSource:
            result.planText !== undefined ? 'exit_plan_mode' : 'final_text',
          ...(turn.userId !== undefined && { requestedBy: turn.userId }),
        },
      );
    } catch (planErr) {
      console.error(
        '[handleTurnOutcome] plan approval create failed:',
        planErr,
      );
    }
  }
  await finalizeTurnSideEffects(ctx, turn, turnTokensOf(result));
}

/**
 * Resolve the plan a terminal turn proposed, if any. An ExitPlanMode capture
 * (result.planText) counts in ANY mode — run_agent already enforced the
 * execute-mode "last tool call" rule, and the in-image plan-gate hook stops
 * the agent right after the call. The finalText fallback applies only to a
 * turn that RAN in plan mode and never reached ExitPlanMode (its final
 * message IS the plan); in execute mode a finalText is just a normal answer.
 */
export function resolvePlanText(
  result: Pick<RunAgentInSessionResult, 'planText' | 'finalText'>,
  permissionMode: 'plan' | 'execute' | undefined,
): string | null {
  if (result.planText !== undefined && result.planText.trim() !== '') {
    return result.planText;
  }
  if (permissionMode === 'plan') {
    const fallback = result.finalText?.trim();
    if (fallback !== undefined && fallback !== '') return fallback;
  }
  return null;
}

/**
 * A terminal 'completed' result that produced literally nothing: no final
 * text, no tool timeline, no plan. Seen when the model API returns an
 * empty-but-200 completion — the CLI treats it as success and exits 0.
 * Shared by the honest-failure rendering (handleTurnOutcome) and the
 * one-shot automatic retry (run_external_agent) so the two can't drift.
 * NOTE: usage tokens are NOT a discriminator — the claude-code result
 * mapping reports 0/0 for every turn (only cost is carried).
 */
export function isEmptyCompletedTurn(
  result: Pick<
    RunAgentInSessionResult,
    'status' | 'finalText' | 'assistantContent' | 'planText'
  >,
  permissionMode: 'plan' | 'execute' | undefined,
): boolean {
  return (
    result.status === 'completed' &&
    (result.finalText ?? '').trim() === '' &&
    isContentEmpty(result.assistantContent) &&
    resolvePlanText(result, permissionMode) === null
  );
}

/** Stored message text for a turn that completed with zero output (see
 * isEmptyCompletedTurn) — rendered as a failed bubble so the Try-again
 * affordance shows. */
export const EMPTY_TURN_MESSAGE =
  'The agent returned no output — the model response came back empty. Please try again.';

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

/** Load + parse a turn checkpoint blob ({lastSeq, agentSessionId, planText,
 * toolNames}) from _storage. Post-S4 the timeline is no longer carried — each
 * segment renders into its own message, so the checkpoint is the resume cursor
 * (+ the plan captured so far and the turn's toolUseId → toolName map). */
export async function loadCheckpoint(
  ctx: ActionCtx,
  storageId: string,
): Promise<{
  lastSeq: number;
  agentSessionId?: string;
  planText?: string;
  toolNames?: Record<string, string>;
  agentResultSeen?: boolean;
  agentIdle?: boolean;
  pendingTaskIds?: string[];
} | null> {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const blob = await ctx.storage.get(storageId as Id<'_storage'>);
  if (!blob) return null;
  try {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return JSON.parse(await blob.text()) as {
      lastSeq: number;
      agentSessionId?: string;
      planText?: string;
      toolNames?: Record<string, string>;
      agentResultSeen?: boolean;
      agentIdle?: boolean;
      pendingTaskIds?: string[];
    };
  } catch (err) {
    console.error('[turn_lifecycle] bad checkpoint blob:', err);
    return null;
  }
}
