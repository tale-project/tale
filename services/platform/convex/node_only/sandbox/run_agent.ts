'use node';

// Progress bridge — runs a coding agent inside a sandbox session and streams
// its normalized events to the reactive progress row.
//
// Ties together the three pieces built for sessions:
//   1. @tale/agent-adapters: buildExec(spec) → the session exec (argv/env/
//      stdin) + a parser for the agent's native stdout stream.
//   2. session_client.sessionExec: runs that exec, streaming stdout deltas.
//   3. upsertSessionOp: throttled writes to `sandboxSessionOps` so any entry
//      point's reactive useQuery renders live progress + final result.
//
// Entry-agnostic on purpose: an entry point (chat tool, workflow node) supplies
// the session id + gateway token + prompt and subscribes to the progress row;
// this action owns the stream→event→row plumbing once, for all of them.

import {
  getAgentAdapter,
  type AgentEvent,
  type AgentSlug,
} from '@tale/agent-adapters';
import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction, type ActionCtx } from '../../_generated/server';
import {
  buildAssistantContent,
  estimateContentBytes,
  MAX_MESSAGE_BYTES,
  type AgentAssistantContent,
} from './agent_message_parts';
import {
  drainSessionExecResilient,
  type ExecCursor,
  type SessionExecResult,
} from './helpers/session_client';

const PROGRESS_FLUSH_MS = 500;
const RECENT_EVENTS_CAP = 20;
// Liveness heartbeat cadence (independent of output) — the recovery watchdog's
// staleness threshold must be a comfortable multiple of this.
const HEARTBEAT_INTERVAL_MS = 20_000;

export interface RunAgentInSessionArgs {
  organizationId: string;
  sessionId: string;
  /** Chat thread this run belongs to — stamped on the op so a per-user
   * sandbox's per-thread resume + live-progress query can scope by thread. */
  threadId?: string;
  /** The turn's generation streamId. When set (with threadId), the liveness
   * heartbeat also bumps the thread's `generationHeartbeatAt` so the UI's
   * generation-stale guard survives runs longer than the threshold; the
   * streamId scopes the bump to THIS turn (a stale action must not keep a
   * newer turn's window open). */
  streamId?: string;
  execId: string;
  agentSlug: 'claude-code' | 'opencode';
  prompt: string;
  model?: string;
  /** Resume handle from a prior run (Claude session_id / OpenCode sessionID). */
  agentSessionId?: string;
  maxTurns?: number;
  browserMcp?: boolean;
  /** Turn permission posture (plan = read-only planning turn, execute =
   * default full access). Threaded to the adapter argv AND used by the plan
   * capture below: in execute mode a captured plan is discarded if any other
   * tool call follows it (the agent kept working — see recordEvents). */
  permissionMode?: 'plan' | 'execute';
  /** Extra system-prompt text appended to the agent CLI's own prompt. */
  systemPromptAppend?: string;
  /** Bifrost gateway root + the session virtual key. */
  gatewayBaseUrl: string;
  gatewayToken: string;
  workdir?: string;
  timeoutMs?: number;
  /** Per-flush durable persistence hook. Called on the same throttle as the
   * live op flush with the timeline-so-far as AI-SDK assistant content, so the
   * caller can patch a streaming chat message — making the persisted message the
   * durable record (survives cancel/timeout/disconnect, not just the live op
   * buffer). Best-effort; failures are swallowed (the op flush is the fallback).
   */
  onTimeline?: (content: AgentAssistantContent) => Promise<void>;
  /** Absolute time (ms) by which THIS action must hand off (it runs under the
   * Convex action ceiling). Reached without a terminal result → the run returns
   * status 'continued' + a checkpoint instead of finishing, and the caller
   * schedules a continuation action that resumes via `resumeFrom`. */
  budgetDeadlineMs?: number;
  /** Resume a turn a prior action handed off: re-attach at `lastSeq` — no new
   * exec is started (the same exec keeps running under the detach-grace). The
   * timeline is NOT carried over: each segment renders into its OWN message (S4
   * segmentation), so a resumed segment starts with an empty timeline. */
  resumeFrom?: {
    lastSeq: number;
    agentSessionId?: string;
    /** Plan captured by an earlier segment (ExitPlanMode) — carried across
     * the seam and still subject to the execute-mode reset rule. */
    planText?: string;
  };
}

export interface RunAgentInSessionResult {
  /** 'completed' | 'failed' | 'cancelled' (terminal) or 'continued' (the action
   * budget elapsed mid-turn → hand off to a continuation action). */
  status: string;
  exitCode: number | null;
  agentSessionId?: string;
  finalText?: string;
  /** Token/cost totals the agent reported in its `result` event — the
   * authoritative per-turn usage (Bifrost v1.4.8 has no per-VK usage endpoint).
   * Absent if the run errored before producing a result. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costEstimateUsd?: number;
  };
  /** The turn's full tool-call timeline as AI-SDK assistant content (reasoning +
   * tool-call/tool-result + final text), for persisting into chat history so a
   * completed turn's tool calls survive (not just the live, capped op buffer).
   * A plain string when the turn had no timeline. */
  assistantContent?: AgentAssistantContent;
  /** Handoff cursor (status==='continued' only): the seq the continuation
   * action re-attaches from. The timeline is NOT carried — each segment renders
   * into its own message (S4). */
  lastSeq?: number;
  /** status==='continued' only: this seam was tripped by a steer delivery —
   * a queued user message was staged into the running exec, so the next
   * segment must open a FRESH message (even if this segment is empty) so the
   * turn's subsequent output renders BELOW that user message. */
  steerSeam?: boolean;
  /** The plan the agent proposed via ExitPlanMode (input.plan — verified
   * present on CLI 2.1.173, alongside planFilePath). In execute mode it is
   * cleared again if any other tool call followed (the agent ignored the
   * denial and kept working — a stale plan must not surface as a pending
   * approval card). Turn-end detection turns this into a plan-approval row. */
  planText?: string;
}

/**
 * Plain-function entry for same-process callers (run_external_agent). A
 * `ctx.runAction` hop is capped at ~5 minutes in self-hosted Convex — the
 * parent gets killed mid-turn while this sub-action keeps streaming, so
 * long agent runs MUST be invoked as a direct import, not via the action
 * RPC. The internalAction wrapper below stays for cross-runtime callers.
 */
export async function runAgentInSessionImpl(
  ctx: ActionCtx,
  args: RunAgentInSessionArgs,
): Promise<RunAgentInSessionResult> {
  const resuming = args.resumeFrom !== undefined;
  const adapter = getAgentAdapter(args.agentSlug as AgentSlug);
  // On resume we re-attach to the still-running exec → no new exec is built.
  const exec = resuming
    ? null
    : adapter.buildExec({
        prompt: args.prompt,
        ...(args.model !== undefined && { model: args.model }),
        ...(args.agentSessionId !== undefined && {
          agentSessionId: args.agentSessionId,
        }),
        ...(args.maxTurns !== undefined && { maxTurns: args.maxTurns }),
        ...(args.browserMcp !== undefined && { browserMcp: args.browserMcp }),
        ...(args.permissionMode !== undefined && {
          permissionMode: args.permissionMode,
        }),
        ...(args.systemPromptAppend !== undefined && {
          systemPromptAppend: args.systemPromptAppend,
        }),
        gateway: { baseUrl: args.gatewayBaseUrl, token: args.gatewayToken },
        workdir: args.workdir ?? '/workspace/repo',
        // Mid-turn steering: keys the per-exec TALE_STEER_DIR the platform
        // stages queued user messages into (claude_code adapter only).
        execId: args.execId,
      });
  // Fresh parser each (continuation) action. The re-attach resumes from lastSeq
  // (at most one line straddling the seam is skipped — harmless). Usage isn't
  // summed from per-message events here (cost comes from the VK budget), so the
  // parser's dedup state resetting across the seam is a no-op.
  const parser = adapter.createParser();

  // Per-SEGMENT progress state. Each continuation renders into its OWN message
  // (S4 segmentation), so a resumed segment starts with an EMPTY timeline — only
  // the cursor + captured session id carry across the handoff.
  let progressText = '';
  const recentEvents: string[] = [];
  const timeline: AgentEvent[] = [];
  // Reconnect cursor: starts at the handoff seq on resume so the re-attach skips
  // already-consumed events. Updated by the drain as new deltas arrive.
  const cursor: ExecCursor = { lastSeq: args.resumeFrom?.lastSeq ?? 0 };
  let capturedSessionId: string | undefined =
    args.resumeFrom?.agentSessionId ?? args.agentSessionId;
  let finalText: string | undefined;
  // Plan proposed via ExitPlanMode. Seeded from the checkpoint on resume so an
  // early segment's capture survives the seam — and stays subject to the
  // execute-mode reset rule below.
  let planText: string | undefined = args.resumeFrom?.planText;
  let usage: RunAgentInSessionResult['usage'];
  let lastFlush = 0;
  // Handoff control (hoisted so flushProgress can trip it): the budget deadline
  // OR the per-message byte budget aborts the drain → the run returns 'continued'
  // and the caller segments (finalizes this message, opens a fresh one).
  const controller = new AbortController();
  let handoff = false;
  // Set when the handoff was tripped by a steer delivery (queued user message
  // staged into this exec) — the continuation must open a fresh message so
  // subsequent output renders below that user message.
  let steerSeam = false;

  const recordEvents = (events: AgentEvent[]): void => {
    for (const e of events) {
      if (e.type === 'text-delta' || e.type === 'text') {
        progressText += e.text;
      } else if (e.type === 'run-started' && e.agentSessionId) {
        capturedSessionId = e.agentSessionId;
      } else if (e.type === 'result') {
        if (e.agentSessionId) capturedSessionId = e.agentSessionId;
        if (e.finalText) finalText = e.finalText;
        if (e.usageTotals) {
          usage = {
            inputTokens: e.usageTotals.inputTokens,
            outputTokens: e.usageTotals.outputTokens,
            ...(e.usageTotals.costEstimateUsd !== undefined && {
              costEstimateUsd: e.usageTotals.costEstimateUsd,
            }),
          };
        }
      } else if (e.type === 'tool-use') {
        if (e.toolName === 'ExitPlanMode') {
          // The proposed plan rides the tool input (input.plan — verified on
          // CLI 2.1.173; the call itself is denied by plan mode / the
          // tale-plan-gate hook, which doesn't affect the input streaming out).
          const plan = planFromToolInput(e.input);
          if (plan !== undefined) planText = plan;
        } else if (args.permissionMode !== 'plan') {
          // Execute-mode reset rule: a plan only counts if ExitPlanMode was
          // the turn's LAST tool call. Verified on 2.1.173: under
          // bypassPermissions the model can shrug off the denial and keep
          // executing — surfacing that stale plan as a pending approval card
          // after the work is already done would be wrong.
          planText = undefined;
        }
      } else if (e.type === 'steer-injected') {
        // Live confirmation that the steer hook injected queued user
        // message(s) into this running turn (only the Stop-hook delivery
        // surfaces in the stream). Best-effort early pill flip — the terminal
        // reconciliation in finalizeTurnSideEffects stays authoritative.
        if (args.threadId !== undefined && e.messageIds.length > 0) {
          void ctx
            .runMutation(internal.threads.message_queue.markConsumed, {
              threadId: args.threadId,
              messageIds: e.messageIds,
            })
            .catch((err: unknown) =>
              console.warn('[run_agent] steer markConsumed failed:', err),
            );
        }
      }
      // Durable timeline: every text + tool-use/tool-result, in order (the
      // pieces buildAssistantContent persists). text-delta is excluded (its
      // coalesced `text` lands at block end).
      if (
        e.type === 'text' ||
        e.type === 'tool-use' ||
        e.type === 'tool-result'
      ) {
        timeline.push(e);
      }
      // Keep a rolling tail of non-delta events for the live UI.
      if (e.type !== 'text-delta') {
        recentEvents.push(JSON.stringify(e));
        if (recentEvents.length > RECENT_EVENTS_CAP) recentEvents.shift();
      }
    }
  };

  const flushProgress = async (force: boolean): Promise<void> => {
    const now = Date.now();
    if (!force && now - lastFlush < PROGRESS_FLUSH_MS) return;
    lastFlush = now;
    await ctx.runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      ...(args.threadId !== undefined && { threadId: args.threadId }),
      execId: args.execId,
      kind: 'agent-run',
      status: 'running',
      progressText: progressText.slice(-8_000),
      recentEvents: [...recentEvents],
      // Heartbeat + resume cursor so the recovery watchdog can tell a live
      // draining action from a dead one, and a continuation knows where to
      // re-attach.
      heartbeatAt: now,
      lastSeq: cursor.lastSeq,
      ...(capturedSessionId !== undefined && {
        agentSessionId: capturedSessionId,
      }),
    });
    // Durable mirror: patch the streaming chat message with the timeline-so-far
    // on the same throttle. This is the record that survives an early end (the
    // op buffer is capped + cleared); best-effort so a transient patch failure
    // never aborts the live run.
    const content = buildAssistantContent(timeline, finalText ?? '');
    if (args.onTimeline) {
      try {
        await args.onTimeline(content);
      } catch (err) {
        console.warn('[run_agent] onTimeline patch failed (continuing):', err);
      }
    }
    // Per-message byte budget (S4 segmentation): a long task accumulates an
    // unbounded number of tool-call parts. Before this segment's serialized
    // content nears Convex's 1 MB doc cap, trip the SAME handoff the budget
    // deadline uses → the drain aborts, the run returns 'continued', and the
    // caller finalizes this message and opens a fresh one for the next segment.
    // The agent's exec keeps running (detach-grace) and `--resume` keeps the
    // conversation continuous; only the rendered message is segmented.
    if (!handoff && estimateContentBytes(content) > MAX_MESSAGE_BYTES) {
      handoff = true;
      controller.abort();
    }
    // Steer seam: a queued user message was just staged into this exec
    // (markDelivered stamped the op row). Trip the same handoff so the next
    // segment's message opens BELOW that user message — without this the
    // reply to the steered message keeps growing the bubble ABOVE it.
    // Consume is exactly-once (mutation-atomic) and best-effort: a failed
    // poll just retries on the next flush.
    if (!handoff && args.threadId !== undefined) {
      try {
        const seam = await ctx.runMutation(
          internal.sandbox.session_mutations.consumeSteerSeamRequest,
          { sessionId: args.sessionId, execId: args.execId },
        );
        if (seam) {
          steerSeam = true;
          handoff = true;
          controller.abort();
        }
      } catch (seamErr) {
        console.warn('[run_agent] steer seam poll failed:', seamErr);
      }
    }
  };

  const callbacks = {
    onStdout: (text: string) => {
      recordEvents(parser.feed(text));
      void flushProgress(false);
    },
    // Agent CLIs put diagnostics on stderr; fold into recent events.
    onStderr: (text: string) => {
      if (text.trim()) {
        recentEvents.push(JSON.stringify({ type: 'stderr', text }));
        if (recentEvents.length > RECENT_EVENTS_CAP) recentEvents.shift();
      }
    },
  };
  const body = {
    execId: args.execId,
    ...(exec && {
      command: exec.argv,
      env: exec.env,
      cwd: exec.cwd,
      ...(exec.stdin !== undefined && {
        stdinBase64: Buffer.from(exec.stdin).toString('base64'),
      }),
    }),
    ...(args.timeoutMs !== undefined && { timeoutMs: args.timeoutMs }),
  };

  // Budget guard: abort the drain when THIS action's window elapses so we hand
  // off (vs being hard-killed at the Convex ceiling with the finally skipped).
  // The `controller`/`handoff` pair is hoisted above (flushProgress also trips
  // it via the per-message byte budget).
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  if (args.budgetDeadlineMs !== undefined) {
    budgetTimer = setTimeout(
      () => {
        handoff = true;
        controller.abort();
      },
      Math.max(0, args.budgetDeadlineMs - Date.now()),
    );
  }

  // Liveness heartbeat: bump the op row on a fixed interval (independent of
  // output) so the recovery watchdog can distinguish a live action from a dead
  // one even during a long, quiet tool call that produces no stdout flush.
  const heartbeatTimer = setInterval(() => {
    void ctx.runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      ...(args.threadId !== undefined && { threadId: args.threadId }),
      execId: args.execId,
      kind: 'agent-run',
      status: 'running',
      heartbeatAt: Date.now(),
      lastSeq: cursor.lastSeq,
    });
    // Same tick, second write: keep the thread-level generation-stale guard
    // open for runs longer than its threshold. Deliberately NOT folded into
    // upsertSessionOp — that mutation is also called by the 500ms progress
    // flush, and patching threadMetadata at that cadence would re-run every
    // thread-meta subscriber 2×/second.
    if (args.threadId !== undefined) {
      const threadId = args.threadId;
      void ctx
        .runMutation(
          internal.threads.internal_mutations.bumpGenerationHeartbeat,
          {
            threadId,
            ...(args.streamId !== undefined && { streamId: args.streamId }),
          },
        )
        .catch((err) => {
          console.warn('[runAgentInSession] generation heartbeat failed:', err);
        });
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Resilient drain: the turn is no longer bound to one HTTP connection — a
  // dropped SSE re-attaches via sinceSeq (same in-memory parser) until the
  // terminal result. An explicit Stop yields a terminal 'cancelled' result, so
  // it returns rather than looping. On resume the first attempt is an attach.
  let result: SessionExecResult;
  try {
    result = await drainSessionExecResilient(
      args.sessionId,
      body,
      controller.signal,
      callbacks,
      {
        cursor,
        ...(resuming && { resumeSinceSeq: args.resumeFrom?.lastSeq ?? 0 }),
      },
    );
  } catch (err) {
    if (budgetTimer) clearTimeout(budgetTimer);
    clearInterval(heartbeatTimer);
    if (handoff) {
      // Action window elapsed mid-turn → hand off. Do NOT parser.end() (the
      // continuation re-attaches mid-line via sinceSeq); persist the latest
      // timeline so the continuation + UI have it, then return the checkpoint.
      await flushProgress(true);
      return {
        status: 'continued',
        exitCode: null,
        ...(capturedSessionId !== undefined && {
          agentSessionId: capturedSessionId,
        }),
        ...(finalText !== undefined && { finalText }),
        ...(planText !== undefined && { planText }),
        ...(usage !== undefined && { usage }),
        assistantContent: buildAssistantContent(timeline, finalText ?? ''),
        lastSeq: cursor.lastSeq,
        // Ternary (not &&): steerSeam is only assigned inside the flush
        // closure, so TS narrows the `let` to its `false` initializer here.
        ...(steerSeam ? { steerSeam: true } : {}),
      };
    }
    throw err;
  }
  if (budgetTimer) clearTimeout(budgetTimer);
  clearInterval(heartbeatTimer);
  recordEvents(parser.end());

  const opStatus =
    result.status === 'completed'
      ? 'completed'
      : result.status === 'cancelled'
        ? 'cancelled'
        : 'failed';
  await ctx.runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
    organizationId: args.organizationId,
    sessionId: args.sessionId,
    ...(args.threadId !== undefined && { threadId: args.threadId }),
    execId: args.execId,
    kind: 'agent-run',
    status: opStatus,
    progressText: progressText.slice(-8_000),
    recentEvents: [...recentEvents],
    heartbeatAt: Date.now(),
    lastSeq: cursor.lastSeq,
    ...(capturedSessionId !== undefined && {
      agentSessionId: capturedSessionId,
    }),
    ...(result.exitCode !== null && { exitCode: result.exitCode }),
  });

  const assistantContent = buildAssistantContent(timeline, finalText ?? '');

  return {
    status: result.status,
    exitCode: result.exitCode,
    ...(capturedSessionId !== undefined && {
      agentSessionId: capturedSessionId,
    }),
    ...(finalText !== undefined && { finalText }),
    ...(planText !== undefined && { planText }),
    ...(usage !== undefined && { usage }),
    assistantContent,
  };
}

/** Narrow an ExitPlanMode tool input to its plan markdown, if present. */
function planFromToolInput(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const plan = (input as { plan?: unknown }).plan;
  return typeof plan === 'string' && plan.trim() !== '' ? plan : undefined;
}

export const runAgentInSession = internalAction({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    execId: v.string(),
    agentSlug: v.union(v.literal('claude-code'), v.literal('opencode')),
    prompt: v.string(),
    model: v.optional(v.string()),
    /** Resume handle from a prior run (Claude session_id / OpenCode sessionID). */
    agentSessionId: v.optional(v.string()),
    maxTurns: v.optional(v.number()),
    browserMcp: v.optional(v.boolean()),
    /** Bifrost gateway root + the session virtual key. */
    gatewayBaseUrl: v.string(),
    gatewayToken: v.string(),
    workdir: v.optional(v.string()),
    timeoutMs: v.optional(v.number()),
  },
  returns: v.object({
    status: v.string(),
    exitCode: v.union(v.number(), v.null()),
    agentSessionId: v.optional(v.string()),
    finalText: v.optional(v.string()),
  }),
  handler: (ctx, args) => runAgentInSessionImpl(ctx, args),
});
