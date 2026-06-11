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
  execId: string;
  agentSlug: 'claude-code' | 'opencode';
  prompt: string;
  model?: string;
  /** Resume handle from a prior run (Claude session_id / OpenCode sessionID). */
  agentSessionId?: string;
  maxTurns?: number;
  browserMcp?: boolean;
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
  /** Resume a turn a prior action handed off: re-attach at `lastSeq` with the
   * timeline rebuilt so far — no new exec is started (the same exec keeps
   * running in the sandbox under the detach-grace). */
  resumeFrom?: {
    timeline: AgentEvent[];
    lastSeq: number;
    agentSessionId?: string;
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
  /** Handoff checkpoint (status==='continued' only): the accumulated timeline +
   * the resume cursor the continuation action re-attaches from. */
  timeline?: AgentEvent[];
  lastSeq?: number;
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
        ...(args.systemPromptAppend !== undefined && {
          systemPromptAppend: args.systemPromptAppend,
        }),
        gateway: { baseUrl: args.gatewayBaseUrl, token: args.gatewayToken },
        workdir: args.workdir ?? '/workspace/repo',
      });
  // Fresh parser each (continuation) action. Re-feeding isn't needed: the prior
  // timeline is restored below and the re-attach resumes from lastSeq (at most
  // one line straddling the seam is skipped — harmless). Usage isn't summed
  // from per-message events here (cost comes from the VK budget), so the
  // parser's dedup state resetting across the seam is a no-op.
  const parser = adapter.createParser();

  // Accumulated progress state (restored from the handoff checkpoint on resume).
  let progressText = '';
  const recentEvents: string[] = [];
  const timeline: AgentEvent[] = args.resumeFrom
    ? [...args.resumeFrom.timeline]
    : [];
  // Reconnect cursor: starts at the handoff seq on resume so the re-attach skips
  // already-consumed events. Updated by the drain as new deltas arrive.
  const cursor: ExecCursor = { lastSeq: args.resumeFrom?.lastSeq ?? 0 };
  let capturedSessionId: string | undefined =
    args.resumeFrom?.agentSessionId ?? args.agentSessionId;
  let finalText: string | undefined;
  let usage: RunAgentInSessionResult['usage'];
  let lastFlush = 0;

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
    if (args.onTimeline) {
      try {
        await args.onTimeline(buildAssistantContent(timeline, finalText ?? ''));
      } catch (err) {
        console.warn('[run_agent] onTimeline patch failed (continuing):', err);
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
  const controller = new AbortController();
  let handoff = false;
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
        ...(usage !== undefined && { usage }),
        assistantContent: buildAssistantContent(timeline, finalText ?? ''),
        timeline,
        lastSeq: cursor.lastSeq,
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
    ...(usage !== undefined && { usage }),
    assistantContent,
  };
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
