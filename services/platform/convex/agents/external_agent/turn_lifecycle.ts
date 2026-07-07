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
//    finalize; 'running' (non-terminal handoff) ⇒ checkpoint to _storage +
//    schedule the continuation action (the cross-30-min-ceiling handoff).

import { saveMessage } from '@convex-dev/agent';

import { components, internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import type { AgentAssistantContent } from '../../node_only/sandbox/agent_message_parts';
import { sessionListFiles } from '../../node_only/sandbox/helpers/session_client';
import {
  getVirtualKeySpendCents,
  revokeVirtualKey,
} from '../../node_only/sandbox/llm_gateway_admin';
import type { RunAgentInSessionResult } from '../../node_only/sandbox/run_agent';
import {
  matchConsumedSteerFiles,
  steerDirFor,
} from '../../node_only/sandbox/steer_files';

/** Observability-only: log a heartbeat every this-many handoffs on a long run.
 * There is NO continuation CAP — an unbounded (week/month) task is a legitimate
 * sequence of handoffs (~480s each), and a fixed ceiling would be a proactive
 * kill (violates the I/O-conduit invariant). The real bounds are the agent
 * finishing, a user Stop, and the exec's sliding orphan deadline. */
const CONTINUATION_LOG_EVERY = 100;

/** Everything the lifecycle needs to finalize or continue a turn — carried in
 * action args and mirrored onto the op row so the recovery path has it too. */
export interface TurnContext {
  organizationId: string;
  sessionId: string;
  execId: string;
  threadId: string;
  agentKind:
    | 'claude-code'
    | 'cursor'
    | 'opencode'
    | 'hermes'
    | 'gemini'
    | 'codex'
    | 'openclaw';
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
  /** Turn interaction posture (autonomous = no human in the loop). Fixed at
   * exec start and carried across continuations; the terminal card suppression
   * below reads it. Orthogonal to permissionMode. */
  interactionMode?: 'interactive' | 'autonomous';
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
 * we only want to flip the status). An optional `errorText` is written to the
 * message's `error` field so a genuinely-failed turn surfaces a real reason in
 * the UI (threadMeta.failedErrors) instead of a content-free "Something went
 * wrong" — the diagnosability fix (C5). */
export async function markMessageStatus(
  ctx: ActionCtx,
  messageId: string,
  status: 'success' | 'failed',
  errorText?: string,
): Promise<void> {
  await ctx.runMutation(components.agent.messages.updateMessage, {
    messageId,
    patch: {
      status,
      ...(status === 'failed' && errorText !== undefined
        ? { error: errorText }
        : {}),
    },
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
      // The gateway aggregates per-VK spend asynchronously (~seconds); poll briefly.
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
      // Mirror the same polled spend onto the op row so the management page's
      // cumulative Spend column reflects this turn — the seam writes only cover
      // multi-segment turns; a single-segment turn lands its spend here. Same
      // `> 0` guard as the ledger write above (never stamp a misleading $0.00
      // before the gateway has aggregated). Own try/catch so a stamp failure can't
      // block the VK revoke below.
      const finalSpendCents = costCents ?? 0;
      if (finalSpendCents > 0) {
        try {
          await ctx.runMutation(
            internal.sandbox.session_mutations.recordSessionOpSpend,
            {
              sessionId: turn.sessionId,
              execId: turn.execId,
              spentCents: finalSpendCents,
            },
          );
        } catch (spendErr) {
          console.warn('[finalizeTurn] op spend stamp failed:', spendErr);
        }
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
 * 'running' (a non-terminal handoff) ⇒ persist the timeline checkpoint to
 * _storage, stamp the op, and schedule the continuation action that re-attaches
 * and resumes.
 */
export async function handleTurnOutcome(
  ctx: ActionCtx,
  turn: TurnContext,
  result: RunAgentInSessionResult,
): Promise<void> {
  if (result.status === 'running') {
    // No continuation cap — a long run is an unbounded sequence of handoffs.
    // Just log a heartbeat occasionally so a genuine runaway bug is still
    // visible in the logs (the VK budget + the exec's sliding deadline bound
    // cost regardless).
    if (
      turn.continuationCount > 0 &&
      turn.continuationCount % CONTINUATION_LOG_EVERY === 0
    ) {
      console.warn(
        `[handleTurnOutcome] long run: ${turn.continuationCount} handoffs (exec ${turn.execId}, thread ${turn.threadId})`,
      );
    }

    // Refresh the session lifetime each seam (idempotent activity bump) so a
    // multi-day turn's session is never expired by the platform reaper while —
    // or right after — it runs. resumeStoppedSession is safe on an already-
    // active row (a harmless lastActivityAt + expiresAt refresh).
    await ctx
      .runMutation(internal.sandbox.session_mutations.resumeStoppedSession, {
        organizationId: turn.organizationId,
        sessionId: turn.sessionId,
      })
      .catch((err) =>
        console.warn(
          '[handleTurnOutcome] session lifetime refresh failed:',
          err,
        ),
      );

    // Poll the turn's VK for cumulative in-task spend, for the management page's
    // live Spend column (stamped on the op below). Per the I/O-conduit principle
    // (decision 1) the platform NEVER kills on budget: the VK's own max_limit
    // (sized to the org rolling-remaining at mint) enforces the cap AT THE
    // GATEWAY — when the agent exhausts it, its model calls 402 and it handles
    // that itself; we do not cancel the exec or pause the turn. So we just poll
    // + continue handing off. (Per-seam budget REFRESH — raising the live VK's
    // limit as the rolling window refills — is a separate enhancement; the exec
    // holds one key for its life, so it can't be re-minted mid-run.)
    let spentCents: number | undefined;
    if (turn.userId && turn.mintedKeyId) {
      try {
        const polled = await getVirtualKeySpendCents(turn.mintedKeyId);
        if (polled !== null) spentCents = polled;
      } catch (spendErr) {
        console.warn('[handleTurnOutcome] VK spend poll failed:', spendErr);
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
      // childToolUseId → immediate parentToolUseId across the turn, so a post-
      // seam segment can fold a pre-seam sub-agent's later result under its
      // top-level Task ancestor (mirrors toolNames).
      ...(result.toolUseParents !== undefined && {
        toolUseParents: result.toolUseParents,
      }),
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
        ...(turn.interactionMode !== undefined && {
          interactionMode: turn.interactionMode,
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
  // affordance. Only for a single-segment turn: a resumed (multi-segment) turn's
  // empty FINAL segment is normal (earlier segments hold the work) and keeps the
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

  // A terminal API error (401/403/429/5xx) is laundered by Claude Code into a
  // `completed` result carrying `is_error:true` (see isRetryableExecutionError /
  // the parse.ts subtype mapping). Treat it as FAILED so the chat never renders
  // a blown-up turn as a success bubble. No throw here — the chat turn has no
  // workflow-step retry, so surfacing the error in a failed bubble is the right
  // shape (the task/sandbox path throws + retries instead).
  const errored = result.isError === true;
  const finalText =
    result.finalText ??
    (errored
      ? agentErrorMessage(result.apiErrorStatus)
      : result.status === 'completed'
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
    result.status === 'completed' && !errored ? 'success' : 'failed',
  );
  // Plan proposal → approval card (any terminal status except cancelled — a
  // plan captured before a max-turns/error end is still worth reviewing).
  // Best-effort: a card failure must never skip finalize (VK revoke, ledger).
  // Autonomous turns have no human to approve: the plan still lands in the
  // finalized message above (patchStreamingMessage), but no blocking card.
  const plan = resolvePlanText(result, turn.permissionMode);
  if (plan !== null && turn.interactionMode !== 'autonomous') {
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
    'status' | 'finalText' | 'assistantContent' | 'planText' | 'isError'
  >,
  permissionMode: 'plan' | 'execute' | undefined,
): boolean {
  // A terminal API error is NOT an "empty" turn — it's a failure with a cause.
  // Excluding it here stops the one-shot empty-retry (run_external_agent) from
  // re-running a blank 401 against the same dead token, and routes it to the
  // failed-bubble rendering in handleTurnOutcome instead.
  if (result.isError === true) return false;
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

/** Stored message text for a turn that ended on a terminal API error (the
 * laundered-401 case) but left no usable final text — a blank error bubble
 * would read as "nothing happened". Server-authored (not i18n) like
 * EMPTY_TURN_MESSAGE; rendered as a failed bubble with the status code when the
 * gateway surfaced one. */
export function agentErrorMessage(apiErrorStatus: number | undefined): string {
  return apiErrorStatus !== undefined
    ? `The agent stopped on an API error (status ${apiErrorStatus}). Please try again.`
    : 'The agent stopped on an API error. Please try again.';
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

/** A resumed segment that produced no renderable content — reuse its message
 * across the seam rather than sealing an empty bubble. */
function isContentEmpty(content: AgentAssistantContent | undefined): boolean {
  if (content === undefined) return true;
  return typeof content === 'string'
    ? content.trim().length === 0
    : content.length === 0;
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
  toolUseParents?: Record<string, string>;
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
      toolUseParents?: Record<string, string>;
      agentResultSeen?: boolean;
      agentIdle?: boolean;
      pendingTaskIds?: string[];
    };
  } catch (err) {
    console.error('[turn_lifecycle] bad checkpoint blob:', err);
    return null;
  }
}
