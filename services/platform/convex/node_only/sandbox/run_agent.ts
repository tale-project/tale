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
import { sessionExec } from './helpers/session_client';

const PROGRESS_FLUSH_MS = 500;
const RECENT_EVENTS_CAP = 20;

export interface RunAgentInSessionArgs {
  organizationId: string;
  sessionId: string;
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
}

export interface RunAgentInSessionResult {
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
  const adapter = getAgentAdapter(args.agentSlug as AgentSlug);
  const exec = adapter.buildExec({
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
  const parser = adapter.createParser();

  // Accumulated progress state.
  let progressText = '';
  const recentEvents: string[] = [];
  let capturedSessionId: string | undefined = args.agentSessionId;
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
      // Keep a rolling tail of non-delta events for the UI.
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
      execId: args.execId,
      kind: 'agent-run',
      status: 'running',
      progressText: progressText.slice(-8_000),
      recentEvents: [...recentEvents],
      ...(capturedSessionId !== undefined && {
        agentSessionId: capturedSessionId,
      }),
    });
  };

  const controller = new AbortController();
  const result = await sessionExec(
    args.sessionId,
    {
      execId: args.execId,
      command: exec.argv,
      env: exec.env,
      cwd: exec.cwd,
      ...(exec.stdin !== undefined && {
        stdinBase64: Buffer.from(exec.stdin).toString('base64'),
      }),
      ...(args.timeoutMs !== undefined && { timeoutMs: args.timeoutMs }),
    },
    controller.signal,
    {
      onStdout: (text) => {
        recordEvents(parser.feed(text));
        void flushProgress(false);
      },
      // Agent CLIs put diagnostics on stderr; fold into recent events.
      onStderr: (text) => {
        if (text.trim()) {
          recentEvents.push(JSON.stringify({ type: 'stderr', text }));
          if (recentEvents.length > RECENT_EVENTS_CAP) recentEvents.shift();
        }
      },
    },
  );
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
    execId: args.execId,
    kind: 'agent-run',
    status: opStatus,
    progressText: progressText.slice(-8_000),
    recentEvents: [...recentEvents],
    ...(capturedSessionId !== undefined && {
      agentSessionId: capturedSessionId,
    }),
    ...(result.exitCode !== null && { exitCode: result.exitCode }),
  });

  return {
    status: result.status,
    exitCode: result.exitCode,
    ...(capturedSessionId !== undefined && {
      agentSessionId: capturedSessionId,
    }),
    ...(finalText !== undefined && { finalText }),
    ...(usage !== undefined && { usage }),
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
