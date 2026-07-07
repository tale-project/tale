'use node';

// Progress bridge — runs a coding agent inside a sandbox session and streams
// its normalized events to the reactive progress row.
//
// Ties together the three pieces built for sessions:
//   1. @/lib/agent-adapters: buildExec(spec) → the session exec (argv/env/
//      stdin) + a parser for the agent's native stdout stream.
//   2. session_client.sessionExec: runs that exec, streaming stdout deltas.
//   3. upsertSessionOp: throttled writes to `sandboxSessionOps` so any entry
//      point's reactive useQuery renders live progress + final result.
//
// Entry-agnostic on purpose: an entry point (chat tool, workflow node) supplies
// the session id + gateway token + prompt and subscribes to the progress row;
// this action owns the stream→event→row plumbing once, for all of them.

import { v } from 'convex/values';

import { buildSteerStdinPayload } from '../../../lib/agent-adapters/claude-code/stdin';
import { getAgentCapabilities } from '../../../lib/agent-adapters/credential-policy';
import type {
  AgentEvent,
  AgentResultStatus,
} from '../../../lib/agent-adapters/events';
import { getAgentAdapter } from '../../../lib/agent-adapters/registry';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { internalAction, type ActionCtx } from '../../_generated/server';
import {
  buildAssistantContent,
  buildUiPartsFromTimeline,
  capAccumulatedLiveParts,
  estimateContentBytes,
  MAX_MESSAGE_BYTES,
  type AgentAssistantContent,
  type UiTimelinePart,
} from './agent_message_parts';
import {
  authRetryFromEvent,
  errorTextFromEvent,
  looksLikeApiError,
} from './api_error_detection';
import {
  drainSessionExecResilient,
  sessionCancelExec,
  sessionListFiles,
  sessionStageFiles,
  sessionWriteExecStdin,
  type ExecCursor,
  type SessionExecResult,
} from './helpers/session_client';
import { idleCloseDecision, quietIdleDecision } from './quiet_idle';
import {
  matchConsumedSteerFiles,
  steerDirFor,
  steerFileName,
} from './steer_files';

const PROGRESS_FLUSH_MS = 500;
// Upper bound on the cross-seam toolUseId→name / child→parent maps, so an
// unbounded run can't grow them (or the checkpoint blob that carries them)
// without limit. Generous — only ancient straddling results lose their name.
const TOOL_MAP_CAP = 2_000;
// Consumption-poll cadence while steer message(s) are delivered-but-unconsumed
// (PostToolUse injections leave no stream signal — only consumed.* markers).
// A tool-result in the stream bypasses this throttle: the hook fires at that
// boundary, so polling right then catches the consumption within one listing
// round-trip instead of up to a full interval later.
const STEER_POLL_INTERVAL_MS = 2_000;
// Liveness heartbeat cadence (independent of output) — the recovery watchdog's
// staleness threshold must be a comfortable multiple of this.
const HEARTBEAT_INTERVAL_MS = 20_000;
// Hard-deadline grace past `budgetDeadlineMs`: the budget guard's AbortSignal is
// best-effort (the SSE read / reconnect backoff may not unblock promptly), so a
// watchdog races the drain against `budgetDeadlineMs + this` and FORCES the
// handoff if the drain wedges — guaranteeing the action returns + checkpoints
// before the platform's wall-clock cap hard-kills it (a hard kill bypasses
// teardown + leaks the session). Sized above the worst-case clean abort-settle
// (a flushProgress's ~30s sessionListFiles) so it never fires on a healthy drain.
const HANDOFF_HARD_GRACE_MS = 45_000;
// Linger-loop cadence (claude-code stdin-hold): after the per-turn agent
// result, the process stays alive on its held-open stdin. The loop delivers
// queued steer messages via stdin (the CLI processes idle-state stdin
// messages within seconds — verified 2.1.173) and sends EOF once nothing is
// pending: no background tasks (ledger balanced), no queued/delivered rows.
const LINGER_TICK_MS = 2_000;
// Post-EOF watchdog: the CLI normally exits well under a second after stdin
// EOF (≤7s observed while abandoning background tasks). A process still alive
// past this is wedged — reap it and report the agent's own result status.
const STDIN_EOF_GRACE_MS = Number(
  process.env.EXTERNAL_AGENT_STDIN_EOF_GRACE_MS ?? 30_000,
);
// Quiet-idle debounce: how long the MAIN loop must stay silent (background
// task_* traffic aside) after a completed text block, with background tasks
// pending and no tool results outstanding, before the drain treats the exec
// as lingering. Needed because `local_workflow` background tasks gate the
// per-turn result until they settle (verified 2.1.173) — unlike `local_bash`,
// which lets the result through immediately.
const QUIET_IDLE_MS = Number(process.env.EXTERNAL_AGENT_QUIET_IDLE_MS ?? 5_000);
// Idle-close grace (autonomous runs): how long the main loop must stay silent
// AFTER the per-turn result — model idle, no sub-agent/blocking-read in flight —
// before the drain closes stdin even though the background ledger still shows
// pending tasks. A background task can finish without ever emitting a terminal
// task_notification/task_updated (Claude Code #14049), which would otherwise pin
// a finished run open until its wall-clock budget. Closing then matches headless
// `-p` (stdin closes after the final result; the CLI reaps stragglers). Longer
// than QUIET_IDLE_MS so a genuine background auto-wake (which resets the silence
// clock) is never cut off.
const IDLE_EOF_GRACE_MS = Number(
  process.env.EXTERNAL_AGENT_IDLE_EOF_MS ?? 60_000,
);
// Stalled-turn watchdog (claude-code stdin-hold). A mid-stream API failure — the
// gateway injecting an error into the open SSE (e.g. the gateway's stream-idle abort),
// a connection drop, an upstream 5xx — surfaces in the CLI's stream as an
// "API Error" and ends the turn WITHOUT a terminal `result` and WITHOUT exiting
// (the CLI keeps its held-open stdin, waiting for the next message; Claude Code
// does not auto-retry a mid-stream failure). The linger loop's EOF is gated on the
// result, so nothing closes the wedged process — it would loop empty handoffs for
// the whole wall-clock budget, then mis-report a timeout. When the stream has
// surfaced such an error AND no result has arrived AND nothing is in flight (no
// background tasks / sub-agents / blocking reads / main tools — so this never
// fires while a long tool runs), wait this grace for a recovery that can't come,
// then force-close and report a mechanical error so the step's retry runs fresh.
const STALLED_AFTER_API_ERROR_MS = Number(
  process.env.EXTERNAL_AGENT_STALLED_AFTER_API_ERROR_MS ?? 20_000,
);

/**
 * HTTP statuses on a live `api_retry` event that mean "retrying the SAME
 * credential cannot help" — auth failures (expired/revoked key). Claude Code
 * still burns its full SSE-reconnect budget (max_retries=10, backoff growing to
 * tens of seconds) on these, so once we see one past the first attempt we
 * SIGTERM the exec early: it fails fast instead of storming for minutes, and a
 * token-source rotation can swap credentials inside the action window. Rate
 * limits (429/529) are NOT early-aborted — they can self-heal on retry and the
 * terminal result already arrives fast. Keep in lockstep with
 * `ROTATABLE_API_STATUS` (agent_run_outcome.ts): a status aborted here but not
 * rotatable there pays the abort cost yet never swaps credentials. */
const AUTH_ABORT_STATUSES: ReadonlySet<number> = new Set([401, 403]);
/** Let one transient retry self-heal; abort from the second attempt on. */
const AUTH_ABORT_MIN_ATTEMPT = 2;

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
  agentSlug: 'claude-code' | 'cursor' | 'hermes' | 'gemini';
  prompt: string;
  model?: string;
  /** Managed only: gateway model id of the model-level fallback (catalog
   * `fallbackModelId`); forwarded to the adapter's fallback wiring. */
  fallbackModel?: string;
  /** Resume handle from a prior run (Claude session_id / Cursor chat id). */
  agentSessionId?: string;
  maxTurns?: number;
  browserMcp?: boolean;
  /** Live browser view (read-only mirror). When true the adapter attaches
   * Playwright MCP to the session's externally-launched headed Chromium over
   * CDP instead of self-launching headless. Gated by the platform's
   * SANDBOX_BROWSER_VIEW operator flag (see run_external_agent), which MUST be
   * set together with the spawner's SANDBOX_BROWSER_VIEW (a deployment-level
   * decision — the spawner is what actually launches the headed browser). */
  browserCdp?: boolean;
  /** Turn permission posture (plan = read-only planning turn, execute =
   * default full access). Threaded to the adapter argv AND used by the plan
   * capture below: in execute mode a captured plan is discarded if any other
   * tool call follows it (the agent kept working — see recordEvents). */
  permissionMode?: 'plan' | 'execute';
  /** Turn interaction posture (interactive = human in the loop, default;
   * autonomous = unsupervised). Threaded to the adapter spec AND used here to
   * skip mid-turn steering / the human-control card for autonomous runs.
   * Independent of permissionMode. */
  interactionMode?: 'interactive' | 'autonomous';
  /** Extra system-prompt text appended to the agent CLI's own prompt. */
  systemPromptAppend?: string;
  /** Credential mode (default 'managed'). 'byo' skips the gateway entirely. */
  authMode?: 'managed' | 'byo';
  /** Managed only: opt into the runtime's native web tools (WebSearch/WebFetch),
   * lifting the governed deny. Absent/false keeps the governed default; BYO is
   * native regardless. */
  nativeWebTools?: boolean;
  /** LLM gateway root + the session virtual key. Present for managed runs;
   * omitted for byo (the agent uses user-injected session credentials). */
  gatewayBaseUrl?: string;
  gatewayToken?: string;
  /** Platform base URL for the integration-dispatch bridge (/api/integrations). */
  integrationsBaseUrl?: string;
  /** Managed only: auto-inject the vision MCP bridge so a text-only agent can
   * read images via the gateway's vision model. Set by the caller when the run
   * is managed AND the agent's own model lacks vision; requires the gateway +
   * `visionModel`. */
  visionTool?: boolean;
  /** Gateway model id the vision bridge calls. Present iff `visionTool`; the
   * session VK is scoped to allow it alongside the agent's own model. */
  visionModel?: string;
  workdir?: string;
  /** Absolute dirs outside `workdir` the agent must read (e.g. /user/uploads
   * for chat attachments). Threaded to the adapter as `--add-dir` grants. */
  additionalDirs?: string[];
  timeoutMs?: number;
  /** Per-flush durable persistence hook. Called on the same throttle as the
   * live op flush with the timeline-so-far as AI-SDK assistant content, so the
   * caller can patch a streaming chat message — making the persisted message the
   * durable record (survives cancel/timeout/disconnect, not just the live op
   * buffer). Best-effort; failures are swallowed (the op flush is the fallback).
   */
  onTimeline?: (content: AgentAssistantContent) => Promise<void>;
  /** Workflow-run steps have no chat message to render their live timeline from,
   * so when set the throttled flush also stamps a bounded UI-part transcript onto
   * the op (`liveTimeline`) for the run view to read. The chat path leaves this
   * off (it renders from the persisted message via `onTimeline`). */
  captureLiveTimeline?: boolean;
  /** Absolute time (ms) by which THIS action must hand off (it runs under the
   * Convex action ceiling). Reached without a terminal result → the run returns
   * status 'running' (a non-terminal handoff) + a checkpoint instead of
   * finishing, and the caller schedules a continuation action that resumes via
   * `resumeFrom` by re-attaching to the still-running exec. */
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
    /** toolUseId → toolName for every tool-use seen by earlier segments, so a
     * result landing after the seam still renders under its real tool name. */
    toolNames?: Record<string, string>;
    /** childToolUseId → immediate parentToolUseId for sub-agent tool-uses seen
     * by earlier segments, so a sub-agent tool-result landing after the seam
     * still folds under its top-level Task ancestor (mirrors toolNames). */
    toolUseParents?: Record<string, string>;
    /** stdin-hold lifecycle carried across the seam: whether the per-turn
     * agent result already streamed pre-seam, whether the model was idle at
     * the seam, and which background tasks were still pending. Without these
     * a continuation could EOF a process whose pending tasks it never saw
     * start (the re-attach replays only events after lastSeq). */
    agentResultSeen?: boolean;
    agentIdle?: boolean;
    pendingTaskIds?: string[];
    /** Whether an earlier segment's stream surfaced a terminal API/stream error
     * (stalled-turn watchdog) — seeded so a wedge that straddles the seam is
     * still force-closed on resume rather than looping empty handoffs. */
    apiErrorSeen?: boolean;
    /** The op's cross-segment live transcript SO FAR (prior segments' UI parts),
     * seeded only on the workflow run path (`captureLiveTimeline`). The per-segment
     * timeline resets to empty on resume; this carries the accumulated window so a
     * refresh after a seam — or an idle segment that emits nothing — still shows the
     * prior work instead of blanking the op. Read from the op (the single store),
     * not the bounded checkpoint table. */
    liveTimelineParts?: UiTimelinePart[];
  };
}

export interface RunAgentInSessionResult {
  /** 'completed' | 'failed' | 'cancelled' (terminal) or 'running' (a non-terminal
   * handoff: the action budget elapsed mid-turn, the exec keeps running, and a
   * continuation action re-attaches to it). */
  status: 'completed' | 'failed' | 'cancelled' | 'running';
  exitCode: number | null;
  agentSessionId?: string;
  finalText?: string;
  /** Token/cost totals the agent reported in its `result` event — the
   * authoritative per-turn usage (the gateway core v1.4.8 has no per-VK usage endpoint).
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
  /** Handoff cursor (status==='running' only): the seq the continuation
   * action re-attaches from. The timeline is NOT carried — each segment renders
   * into its own message (S4). */
  lastSeq?: number;
  /** status==='running' only: toolUseId → toolName for every tool-use this
   * turn has seen so far, checkpointed so a continuation segment can name the
   * orphan results of pre-seam tool calls. */
  toolNames?: Record<string, string>;
  /** status==='running' only: childToolUseId → immediate parentToolUseId for
   * every sub-agent tool-use this turn has seen, checkpointed so a continuation
   * segment can fold a pre-seam sub-agent's later result under its Task. */
  toolUseParents?: Record<string, string>;
  /** status==='running' only: this seam was tripped by an OBSERVED steer
   * injection — the in-sandbox hook delivered queued user message(s) into the
   * running turn (Stop-hook stream sentinel, or consumed.* markers found by
   * the dir poll). The next segment must open a FRESH message (even if this
   * segment is empty) so the turn's subsequent output renders BELOW that
   * user message. */
  steerSeam?: boolean;
  /** The plan the agent proposed via ExitPlanMode (input.plan — verified
   * present on CLI 2.1.173, alongside planFilePath). In execute mode it is
   * cleared again if any other tool call followed (the agent ignored the
   * denial and kept working — a stale plan must not surface as a pending
   * approval card). Turn-end detection turns this into a plan-approval row. */
  planText?: string;
  /** status==='running' only — stdin-hold lifecycle for the checkpoint (see
   * resumeFrom): result-seen flag, idle flag, and the unbalanced background-
   * task ledger at the seam. */
  agentResultSeen?: boolean;
  agentIdle?: boolean;
  pendingTaskIds?: string[];
  /** status==='running' only: an earlier segment's stream surfaced a terminal
   * API/stream error (stalled-turn watchdog), checkpointed so a wedge that
   * straddles the seam is still force-closed on resume. */
  apiErrorSeen?: boolean;
  /** The agent's OWN self-reported terminal verdict from its stream-json `result`
   * event (`'error'` = error_during_execution / API-auth/connection failure),
   * distinct from `status` (the process-exit verdict). `undefined` ⇒ no result
   * event was ever seen (the run died before reporting). The sandbox-step caller
   * keys its retryable-execution-error classification on THIS, not the process
   * exit code — Claude Code can exit 0 while reporting `error` (e.g. a 401). */
  agentResultStatus?: AgentResultStatus;
  /** From the terminal `result` event: the agent reported a turn-terminating
   * API error (`is_error`), and the numeric HTTP status (`api_error_status`,
   * e.g. 429/401; absent for a mid-stream malformed-200). The token-source
   * rotation loop classifies on these to decide whether to swap credential. */
  isError?: boolean;
  apiErrorStatus?: number;
  /** Why the drain returned. `'auth-abort'` = the live `api_retry` stream
   * showed a rotatable status (401/429/529) and the drain bailed EARLY rather
   * than awaiting the ~10-retry storm; `authAbortStatus` carries that status.
   * The rotation loop treats this like a terminal rotatable error. */
  terminationReason?: 'auth-abort';
  authAbortStatus?: number;
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
  const adapter = getAgentAdapter(args.agentSlug);
  // On resume we re-attach to the still-running exec → no new exec is built.
  const exec = resuming
    ? null
    : adapter.buildExec({
        prompt: args.prompt,
        ...(args.model !== undefined && { model: args.model }),
        ...(args.fallbackModel !== undefined && {
          fallbackModel: args.fallbackModel,
        }),
        ...(args.agentSessionId !== undefined && {
          agentSessionId: args.agentSessionId,
        }),
        ...(args.maxTurns !== undefined && { maxTurns: args.maxTurns }),
        ...(args.browserMcp !== undefined && { browserMcp: args.browserMcp }),
        ...(args.browserCdp !== undefined && { browserCdp: args.browserCdp }),
        ...(args.permissionMode !== undefined && {
          permissionMode: args.permissionMode,
        }),
        ...(args.interactionMode !== undefined && {
          interactionMode: args.interactionMode,
        }),
        ...(args.systemPromptAppend !== undefined && {
          systemPromptAppend: args.systemPromptAppend,
        }),
        ...(args.authMode !== undefined && { authMode: args.authMode }),
        ...(args.nativeWebTools !== undefined && {
          nativeWebTools: args.nativeWebTools,
        }),
        ...(args.gatewayBaseUrl !== undefined &&
          args.gatewayToken !== undefined && {
            gateway: {
              baseUrl: args.gatewayBaseUrl,
              token: args.gatewayToken,
            },
          }),
        ...(args.integrationsBaseUrl !== undefined && {
          integrationsBaseUrl: args.integrationsBaseUrl,
        }),
        ...(args.visionTool !== undefined && { visionTool: args.visionTool }),
        ...(args.visionModel !== undefined && {
          visionModel: args.visionModel,
        }),
        ...(args.additionalDirs !== undefined &&
          args.additionalDirs.length > 0 && {
            additionalDirs: args.additionalDirs,
          }),
        workdir: args.workdir ?? '/user/workspace',
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
  // The currently-OPEN main-agent text block, accumulated from `text-delta`
  // partials and threaded into the streaming flush so a long answer reveals as
  // it streams (and a mid-write Stop keeps it). Cleared when the block's `text`
  // event lands (it is then in `timeline`). Main-level only — sub-agent text
  // stays folded. Per-segment, like the rest of this progress state.
  let liveText = '';
  const timeline: AgentEvent[] = [];
  // Prior segments' op transcript (workflow run only). The op accumulates across
  // the segment seam; this seeds that accumulation so each flush writes
  // prior + THIS segment, and an idle/empty segment keeps the prior window
  // rather than blanking it. Empty on a fresh run.
  const priorTimelineParts: UiTimelinePart[] =
    args.resumeFrom?.liveTimelineParts ?? [];
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
  // When the agent last emitted ANY stream event. Stays frozen while the CLI
  // idles (e.g. waiting on an in-session background task) even though the
  // heartbeat keeps bumping — the UI uses the gap to label the tail honestly.
  // No resume seed needed: upsertSessionOp only patches defined fields, so a
  // silent continuation segment leaves the row's pre-seam value in place.
  let lastEventAt: number | undefined;
  // Every toolUseId → toolName this TURN has seen, seeded from the checkpoint
  // on resume. Unlike the per-segment timeline this map crosses seams, so a
  // result landing segments after its use still renders under its real name.
  const toolNames = new Map<string, string>(
    Object.entries(args.resumeFrom?.toolNames ?? {}),
  );
  // childToolUseId → immediate parentToolUseId for every sub-agent tool-use this
  // TURN has seen, seeded from the checkpoint on resume. Lets buildAssistantContent
  // fold a sub-agent result landing segments after its use under the right Task.
  const toolUseParents = new Map<string, string>(
    Object.entries(args.resumeFrom?.toolUseParents ?? {}),
  );
  // Handoff control (hoisted so flushProgress can trip it): the budget deadline
  // OR the per-message byte budget aborts the drain → the run returns 'running'
  // and the caller segments (finalizes this message, opens a fresh one).
  const controller = new AbortController();
  let handoff = false;
  // Set when the handoff was tripped by an OBSERVED steer injection (the
  // in-sandbox hook delivered queued user message(s) into the running turn) —
  // the continuation must open a fresh message so subsequent output renders
  // below that user message. Detection is dual: the Stop-hook path surfaces
  // in-stream as a steer-injected event; the PostToolUse path only leaves
  // consumed.* markers, watched by the flush's throttled dir poll.
  let steerSeam = false;
  // Steer-detection state. Trips are gated on markConsumed flipping > 0 rows
  // (delivered-only scan ⇒ a replayed sentinel or a second detector finds 0),
  // which makes the seam exactly-once across continuation replays and the
  // marker+sentinel double signal a Stop-hook consumption leaves behind.
  let steerSeamTripped = false;
  let sawSteerInjected = false;
  let steerPollNow = false;
  // 0 ⇒ a continuation's first flush polls immediately — that's also what
  // catches a sentinel that straddled the re-attach boundary.
  let lastSteerPoll = 0;
  let drainActive = true;

  // --- stdin-hold lifecycle (claude-code) -----------------------------------
  // In stream-json input mode the CLI emits a per-turn `result` and keeps
  // running until stdin EOF, so the drain owns the close decision. After the
  // result the process is LINGERING: alive, model idle, kept open for pending
  // background tasks (whose completion re-invokes the model) and for steer
  // messages (idle-state stdin lines are processed within seconds — verified
  // 2.1.173). EOF is sent only when the bg ledger is balanced AND no steer
  // rows are queued/in flight — EOF ABANDONS still-running background tasks.
  const stdinHold =
    getAgentCapabilities(args.agentSlug).processLifecycle === 'stdin-hold';
  const pendingTasks = new Set<string>(args.resumeFrom?.pendingTaskIds ?? []);
  let agentResultSeen = args.resumeFrom?.agentResultSeen === true;
  let agentResultStatus: AgentResultStatus | undefined;
  // Stalled-turn watchdog (see STALLED_AFTER_API_ERROR_MS). apiErrorSeen is seeded
  // from the checkpoint so an error surfaced in an earlier segment that then wedged
  // across the seam is still caught on resume. apiErrorText carries the surfaced
  // message into the thrown step error so the failure is diagnosable. segmentStartedAt
  // anchors the grace on resume, when lastEventAt has no value yet.
  let apiErrorSeen = args.resumeFrom?.apiErrorSeen === true;
  let apiErrorText: string | undefined;
  let turnStalled = false;
  // Token-source rotation signal: a live api_retry showed an auth status
  // (401/403) past the first attempt → kill early (the storm can't recover).
  // authAborted flips once the linger tick has issued the kill.
  let authAbortStatus: number | undefined;
  let authAborted = false;
  // Terminal `result` API-error fields (Claude Code leaves subtype:'success'
  // even on an errored result), surfaced so a caller can rotate credentials.
  let resultIsError: boolean | undefined;
  let resultApiErrorStatus: number | undefined;
  const segmentStartedAt = Date.now();
  // Model idle: the per-turn result arrived, OR quiet-idle — background tasks
  // pending and the main loop has gone silent after a completed text block
  // (a `local_workflow` task gates the result until it settles, so waiting
  // for one would re-create the very blind spot this exists to fix).
  // Mirrored to the op row (agentIdleAt) so steer_delivery knows to leave
  // rows for the linger loop.
  let agentIdle = args.resumeFrom?.agentIdle === true;
  let agentIdleDirty = false;
  let eofSent = false;
  let platformReap = false;
  let eofWatchdog: ReturnType<typeof setTimeout> | undefined;
  let lingerBusy = false;
  // Quiet-idle inputs: when the MAIN loop last produced anything (background
  // task_* and sub-agent traffic excluded — see lastMainActivityAt). The
  // quiet-idle decision keys on this silence plus the inflight-tool sets
  // (quietIdleDecision) and no longer reads lastMainEventWasText. That flag now
  // serves ONLY the stdin-confirm path below: the next completed text/result
  // after a stdin delivery is the consumption evidence. On resume it seeds TRUE
  // because a continuation re-attaching into a quiet wait replays no main-loop
  // events to re-derive it — a wrong TRUE merely queues at the CLI's next
  // boundary (lossless), a wrong FALSE would drop a delivery's confirmation.
  let lastMainActivityAt = Date.now();
  let lastMainEventWasText = args.resumeFrom !== undefined;
  const inflightToolUses = new Set<string>();
  // Main-level Task spawns still running (a subset of inflightToolUses). When
  // non-empty with no other main tool in flight, the main loop is blocked
  // delegating to sub-agents — a deliverable-idle posture for stdin steering,
  // exactly like a background-task wait (sub-agents just don't emit task_*).
  const inflightSubAgents = new Set<string>();
  // Blocking task-read tools still running (a subset of inflightToolUses).
  // TaskOutput with block=true parks the main loop on a background task; when
  // the only main-level tools in flight are these, the agent issued a blocking
  // read and is waiting — the same deliverable-idle posture as a background-task
  // wait, but the blocker is an inflight tool rather than an empty set.
  const inflightWaitTools = new Set<string>();
  // Unconfirmed stdin steer rows may exist whenever we delivered (set below)
  // or resumed mid-turn (a prior segment may have delivered) — the next
  // completed text/result is the consumption evidence (a steered exchange
  // during a workflow wait produces NO result of its own; verified 2.1.173).
  let awaitingStdinConfirm = args.resumeFrom !== undefined;

  /** Background-task chatter: ledger events plus raw system task_* passthrough
   * (task_progress heartbeats etc). Everything else — text, tools, thinking
   * tokens, api_retry — counts as main-loop activity for quiet-idle. */
  const isBackgroundTraffic = (e: AgentEvent): boolean => {
    if (e.type === 'task-started' || e.type === 'task-settled') return true;
    if (e.type !== 'raw') return false;
    const p = e.payload;
    if (typeof p !== 'object' || p === null || !('subtype' in p)) return false;
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const subtype = (p as { subtype?: unknown }).subtype;
    return typeof subtype === 'string' && subtype.startsWith('task_');
  };

  /** Sub-agent (Agent/Task) chatter: text/tool/usage emitted INSIDE a sub-agent
   * carry the parent Task's tool_use id. It must not count as main-loop
   * activity — during a delegation the main loop is quiet while sub-agents
   * stream, and treating their output as activity masks that idleness, so the
   * steer never delivers until the whole batch returns. */
  const isSubAgentTraffic = (e: AgentEvent): boolean =>
    'parentToolUseId' in e && Boolean(e.parentToolUseId);

  const tripSteerSeam = (): void => {
    // drainActive guards a stray late trip (e.g. a sentinel parsed out of
    // parser.end() after a terminal result) from aborting a finished drain.
    if (steerSeamTripped || !drainActive) return;
    steerSeamTripped = true;
    steerSeam = true;
    if (!handoff) {
      handoff = true;
      controller.abort();
    }
  };

  const setAgentIdle = (idle: boolean): void => {
    if (agentIdle === idle) return;
    agentIdle = idle;
    agentIdleDirty = true;
  };

  /** Close the held-open stdin (the process exits ~instantly) and arm the
   * reap watchdog. Refusals are benign: a legacy close-mode exec exits on its
   * own; NOT_FOUND means it already did. */
  const sendEof = async (): Promise<void> => {
    if (eofSent || !drainActive) return;
    eofSent = true;
    try {
      const res = await sessionWriteExecStdin(args.sessionId, args.execId, {
        eof: true,
      });
      if (!res.ok) {
        console.warn(
          `[run_agent] stdin EOF refused (${res.reason ?? 'unknown'}) for exec ${args.execId}`,
        );
        return;
      }
    } catch (err) {
      console.warn('[run_agent] stdin EOF failed (will retry):', err);
      eofSent = false;
      return;
    }
    eofWatchdog = setTimeout(() => {
      if (!drainActive) return;
      platformReap = true;
      console.warn(
        `[run_agent] exec ${args.execId} still alive ${STDIN_EOF_GRACE_MS}ms after stdin EOF — reaping`,
      );
      void sessionCancelExec(args.sessionId, args.execId).catch(
        (err: unknown) =>
          console.warn('[run_agent] post-EOF reap failed:', err),
      );
    }, STDIN_EOF_GRACE_MS);
  };

  /** Push steer rows into the lingering process's stdin as ONE combined user
   * message and seal the current segment immediately: nothing more is coming
   * for it (the model is idle), and the steered turn's output must render in
   * a FRESH message below the user bubble. File-channel rows (staged just
   * before the result landed — no boundary ever fired for them) are
   * tombstoned first so the in-image hook can't double-inject them at the
   * steered turn's first tool boundary. */
  const deliverViaStdin = async (
    queuedRows: Array<{
      queueId: Id<'chatMessageQueue'>;
      messageId: string;
      text: string;
      createdAt: number;
    }>,
    fileRows: Array<{
      queueId: Id<'chatMessageQueue'>;
      messageId: string;
      text: string;
      createdAt: number;
    }>,
    threadId: string,
  ): Promise<void> => {
    // Dedup across the two sets. `queuedRows` (listQueuedForDelivery) and the
    // `fileRows` derived from listDeliveredForExec are read in a non-atomic
    // Promise.all, so a concurrent file-channel deliverSteerMessages that flips
    // a row queued→delivered BETWEEN the two snapshots lands the same row in
    // both. The fileRows entry already carries that message into the stdin
    // payload below and owns its file-channel bookkeeping, so drop it from the
    // queued set — otherwise the same steer line is injected into the model's
    // stdin (and marked delivered) twice.
    const fileMessageIds = new Set(fileRows.map((r) => r.messageId));
    const queued = queuedRows.filter((r) => !fileMessageIds.has(r.messageId));
    if (fileRows.length > 0) {
      // Tombstone = same path, empty text. The hook consumes empty-text files
      // silently (marker only, no injection); reconciliation ignores markers
      // for stdin-channel rows. Failure → retry next tick, nothing delivered.
      const dir = steerDirFor(args.execId);
      await sessionStageFiles(
        args.sessionId,
        fileRows.map((row) => ({
          path: `${dir}/${steerFileName(row.createdAt, row.messageId)}`,
          contentBase64: Buffer.from(
            JSON.stringify({
              messageId: row.messageId,
              text: '',
              createdAt: row.createdAt,
            }),
            'utf8',
          ).toString('base64'),
        })),
      );
    }
    const rows = [...fileRows, ...queued].sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    const line = buildSteerStdinPayload(rows);
    const res = await sessionWriteExecStdin(args.sessionId, args.execId, {
      dataBase64: Buffer.from(line, 'utf8').toString('base64'),
    });
    if (!res.ok) {
      // STDIN_CLOSED ⇒ legacy close-mode exec (pre-deploy image): its hook
      // path still works, so hand the queued rows back to the file stager.
      console.warn(
        `[run_agent] steer stdin write refused (${res.reason ?? 'unknown'}); falling back to file staging`,
      );
      if (queued.length > 0) {
        await ctx.scheduler.runAfter(
          0,
          internal.node_only.sandbox.steer_delivery.deliverSteerMessages,
          { threadId },
        );
      }
      return;
    }
    if (queued.length > 0) {
      await ctx.runMutation(internal.threads.message_queue.markDelivered, {
        threadId,
        queueIds: queued.map((r) => r.queueId),
        execId: args.execId,
        channel: 'stdin',
      });
    }
    if (fileRows.length > 0) {
      await ctx.runMutation(
        internal.threads.message_queue.markStdinRedelivered,
        { threadId, queueIds: fileRows.map((r) => r.queueId) },
      );
    }
    // The next completed text/result is the consumption evidence (a steered
    // exchange during a workflow wait produces no result of its own).
    awaitingStdinConfirm = true;
    // Seal NOW (not at consumption): the steered response starts streaming
    // within seconds and must land in the continuation's fresh message below
    // the user bubble, not append to this finished segment above it.
    tripSteerSeam();
  };

  /** One linger evaluation. Armed by the per-turn agent result OR by pending
   * background tasks (a `local_workflow` task gates the result until it
   * settles — verified 2.1.173 — so waiting for one would blind this loop for
   * exactly the workflow case it exists for). Delivers pending steer messages
   * via stdin while the model idles, re-routes rows to the file stager when a
   * background-task turn resumed activity, and sends EOF once the result is
   * in and nothing is pending. Re-armed by the interval below — failures just
   * wait for the next tick. */
  const lingerTick = async (): Promise<void> => {
    if (!stdinHold || !drainActive || handoff || eofSent || lingerBusy) return;
    // Token-rotation early-abort: a live api_retry surfaced a non-recoverable
    // auth status (401/403). SIGTERM the storming exec NOW rather than waiting
    // out the ~10-retry backoff tail, mark a mechanical error, and let the
    // terminal return tag terminationReason:'auth-abort' so the orchestrator
    // can rotate to another token. Not a steer/budget handoff — we kill the
    // exec (no re-attach), so this never reaches the running-handoff path.
    if (authAbortStatus !== undefined && !authAborted && !agentResultSeen) {
      authAborted = true;
      agentResultStatus = 'error';
      console.warn(
        `[run_agent] auth api_retry (status=${authAbortStatus}) — early-killing exec ${args.execId} for token rotation`,
      );
      await sessionCancelExec(args.sessionId, args.execId).catch((e) =>
        console.warn(`[run_agent] sessionCancelExec (auth-abort) failed:`, e),
      );
      return;
    }
    // Stalled-turn watchdog: the stream surfaced a terminal API/stream error, no
    // result has arrived, and NOTHING is in flight (no background tasks / sub-agents
    // / blocking reads / main tools — `inflightToolUses` is the superset, so a
    // long-running tool never trips this). The CLI is wedged on its held-open stdin
    // waiting for a recovery that won't come (a mid-stream failure isn't auto-retried).
    // Past the grace, force-close and mark a mechanical error so the step retries
    // fresh instead of looping empty handoffs to the wall-clock budget. lastEventAt is
    // undefined on a fresh resume, so anchor the grace on the segment start then.
    if (
      apiErrorSeen &&
      !agentResultSeen &&
      pendingTasks.size === 0 &&
      inflightToolUses.size === 0 &&
      Date.now() - (lastEventAt ?? segmentStartedAt) >
        STALLED_AFTER_API_ERROR_MS
    ) {
      turnStalled = true;
      agentResultStatus = 'error';
      console.warn(
        `[run_agent] turn stalled after API error, no result — force-closing exec ${args.execId}: ${apiErrorText ?? '(no detail)'}`,
      );
      await sendEof();
      return;
    }
    if (
      !agentResultSeen &&
      pendingTasks.size === 0 &&
      inflightSubAgents.size === 0 &&
      inflightWaitTools.size === 0
    )
      return;
    lingerBusy = true;
    try {
      // Quiet-idle transition: the main loop has gone silent (background task_*
      // and sub-agent chatter are excluded from lastMainActivityAt) while
      // parked on background work — a pending task with no main tool in flight,
      // a blocking task-read (TaskOutput), or sub-agent delegation. quietIdle-
      // Decision distinguishes the three; all are the same deliverable-idle
      // posture. Stdin messages ARE processed here (~5s round-trip mid-workflow
      // / mid-TaskOutput-wait, verified 2.1.173), so flag the exec idle and let
      // the delivery branch below take over. The op-row flush is forced — no
      // stdout flows here to carry it — and makes steer_delivery leave future
      // enqueues to this loop too.
      if (
        quietIdleDecision({
          agentIdle,
          agentResultSeen,
          pendingTasks: pendingTasks.size,
          inflightToolUses: inflightToolUses.size,
          inflightSubAgents: inflightSubAgents.size,
          inflightWaitTools: inflightWaitTools.size,
          lastMainActivityAt,
          now: Date.now(),
          quietIdleMs: QUIET_IDLE_MS,
        }) !== 'none'
      ) {
        setAgentIdle(true);
        await flushProgress(true);
      }
      if (
        args.threadId === undefined ||
        args.interactionMode === 'autonomous'
      ) {
        // No thread, or autonomous (no human in the loop) ⇒ no mid-turn
        // steering; just close once background work drains. An autonomous run
        // still carries a threadId (for the transcript), so the mode check is
        // what gates steering, not just the missing-thread case.
        // Close when the ledger is balanced OR — for a finished run whose
        // background tasks never reported terminal (Claude Code #14049) — once
        // the model has stayed idle past the grace with no real work in flight.
        if (
          agentResultSeen &&
          (pendingTasks.size === 0 ||
            idleCloseDecision({
              agentResultSeen,
              agentIdle,
              inflightSubAgents: inflightSubAgents.size,
              inflightWaitTools: inflightWaitTools.size,
              lastMainActivityAt,
              now: Date.now(),
              idleEofMs: IDLE_EOF_GRACE_MS,
            }))
        )
          await sendEof();
        return;
      }
      const threadId = args.threadId;
      const wasIdle = agentIdle;
      const [queuedRows, deliveredRows] = await Promise.all([
        ctx.runQuery(internal.threads.message_queue.listQueuedForDelivery, {
          threadId,
        }),
        ctx.runQuery(internal.threads.message_queue.listDeliveredForExec, {
          threadId,
          execId: args.execId,
        }),
      ]);
      if (!drainActive || handoff || eofSent) return;
      const fileRows = deliveredRows.filter((r) => r.channel === 'file');
      if (wasIdle && (queuedRows.length > 0 || fileRows.length > 0)) {
        await deliverViaStdin(queuedRows, fileRows, threadId);
        return;
      }
      if (!wasIdle) {
        // A background-task turn resumed activity — active turns steer via
        // the proven file+hook path.
        if (queuedRows.length > 0) {
          await ctx.scheduler.runAfter(
            0,
            internal.node_only.sandbox.steer_delivery.deliverSteerMessages,
            { threadId },
          );
        }
        return;
      }
      // Idle with stdin rows still awaiting their confirmation evidence.
      if (deliveredRows.length > 0) return;
      // EOF stays gated on the result: in the workflow case it arrives after
      // the task settles and the model wraps up — never close before it.
      if (agentResultSeen && pendingTasks.size === 0) await sendEof();
    } catch (err) {
      console.warn('[run_agent] linger tick failed (will retry):', err);
    } finally {
      lingerBusy = false;
    }
  };

  /** Confirm stdin-delivered steer rows. Trigger = the first completed
   * text/result after delivery (awaitingStdinConfirm): in idle delivery the
   * very next main-loop output IS the steered exchange, so its completed text
   * means the content reached the transcript (--resume carries it) — and a
   * workflow-wait exchange emits no result of its own, so text must count.
   * A background-task turn racing the delivery can confirm one block early —
   * the CLI's FIFO still consumes the line moments later; only a process
   * death inside that sub-second window could lose it (same at-least-once
   * posture as the hook's crash-mid-consume window). No seam trip here — the
   * seam already happened at delivery. */
  const confirmStdinDelivered = (): void => {
    if (args.threadId === undefined) return;
    const threadId = args.threadId;
    void (async () => {
      try {
        const delivered = await ctx.runQuery(
          internal.threads.message_queue.listDeliveredForExec,
          { threadId, execId: args.execId },
        );
        const stdinIds = delivered
          .filter((r) => r.channel === 'stdin')
          .map((r) => r.messageId);
        if (stdinIds.length === 0) return;
        await ctx.runMutation(internal.threads.message_queue.markConsumed, {
          threadId,
          messageIds: stdinIds,
        });
      } catch (err) {
        console.warn('[run_agent] stdin steer confirmation failed:', err);
      }
    })();
  };

  const recordEvents = (events: AgentEvent[]): void => {
    if (events.length > 0) lastEventAt = Date.now();
    const injectedIds: string[] = [];
    for (const e of events) {
      // Stalled-turn watchdog input: arm on a surfaced terminal API/stream error
      // so the linger loop can force-close a turn the CLI left wedged without a
      // result (see STALLED_AFTER_API_ERROR_MS).
      if (!apiErrorSeen) {
        const errText = errorTextFromEvent(e);
        if (errText && looksLikeApiError(errText)) {
          apiErrorSeen = true;
          apiErrorText = errText.slice(0, 500);
        }
      }
      // Early-abort signal: a live api_retry with a non-recoverable auth status
      // past the first attempt. Captured here (numbers only — no token can
      // leak); the linger tick issues the actual SIGTERM.
      if (authAbortStatus === undefined) {
        const authRetry = authRetryFromEvent(e);
        if (
          authRetry &&
          authRetry.attempt >= AUTH_ABORT_MIN_ATTEMPT &&
          AUTH_ABORT_STATUSES.has(authRetry.errorStatus)
        ) {
          authAbortStatus = authRetry.errorStatus;
          if (stdinHold) void lingerTick();
        }
      }
      // stdin-hold lifecycle: any MAIN-loop activity ends the idle state; a
      // result (re-)enters it (quiet-idle re-enters it from the linger loop).
      // Background task_* chatter must not look like activity — during a
      // workflow wait it is the ONLY traffic, and it must not mask idleness.
      if (stdinHold && !isBackgroundTraffic(e) && !isSubAgentTraffic(e)) {
        lastMainActivityAt = Date.now();
        setAgentIdle(false);
        lastMainEventWasText = e.type === 'text' || e.type === 'result';
        if (awaitingStdinConfirm && lastMainEventWasText) {
          // The steered exchange answered (completed text) or the turn
          // resolved (result) — flip the delivered-stdin rows to consumed.
          awaitingStdinConfirm = false;
          confirmStdinDelivered();
        }
      }
      if (e.type === 'task-started') {
        pendingTasks.add(e.taskId);
      } else if (e.type === 'task-settled') {
        pendingTasks.delete(e.taskId);
        // A settle with the model already idle can be the last blocker — let
        // the linger loop's immediate check decide (it may EOF).
        if (stdinHold && agentResultSeen) void lingerTick();
      } else if (e.type === 'tool-use' && e.toolUseId && !e.parentToolUseId) {
        // Track MAIN-level tool uses only — the quiet-idle guards reason about
        // the main loop, and a sub-agent's own inflight tools (parentToolUseId
        // set) must not count as the main loop being busy. A main-level Task
        // tool-use IS a sub-agent spawn; a main-level TaskOutput (block=true)
        // is a blocking task-read the model parks on.
        inflightToolUses.add(e.toolUseId);
        if (e.toolName === 'Task') inflightSubAgents.add(e.toolUseId);
        else if (e.toolName === 'TaskOutput')
          inflightWaitTools.add(e.toolUseId);
      } else if (e.type === 'tool-result' && e.toolUseId) {
        // Sub-agent internal results carry parentToolUseId and were never added
        // — delete is a harmless no-op for ids we don't track.
        inflightToolUses.delete(e.toolUseId);
        inflightSubAgents.delete(e.toolUseId);
        inflightWaitTools.delete(e.toolUseId);
      }
      if (e.type === 'text-delta' || e.type === 'text') {
        progressText += e.text;
        // Track the open MAIN-agent block for incremental reveal. A `text`
        // event is the coalesced complete block (pushed to `timeline` below),
        // so clear the live buffer when it lands to avoid double-counting; a
        // delta extends the open block. Sub-agent text (parentToolUseId set)
        // stays folded and never enters the main message body.
        if (!e.parentToolUseId) {
          liveText = e.type === 'text' ? '' : liveText + e.text;
        }
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
        agentResultSeen = true;
        agentResultStatus = e.status;
        if (e.isError !== undefined) resultIsError = e.isError;
        if (e.apiErrorStatus !== undefined) {
          resultApiErrorStatus = e.apiErrorStatus;
        }
        setAgentIdle(true);
        // Stdin confirmation rides the awaiting flag (handled above); here
        // only the close evaluation needs to run.
        if (stdinHold) void lingerTick();
      } else if (e.type === 'tool-use') {
        if (e.toolUseId && e.toolName) toolNames.set(e.toolUseId, e.toolName);
        if (e.toolUseId && e.parentToolUseId) {
          toolUseParents.set(e.toolUseId, e.parentToolUseId);
        }
        // Bound these cross-seam maps so an UNBOUNDED run (a month of tool
        // calls, carried in every checkpoint) can't grow them without limit.
        // Map preserves insertion order → evict the oldest. A dropped entry
        // only costs a straddling tool-result its name ("Tool" fallback) —
        // acceptable lossy persistence for very old calls (decision 4).
        capMap(toolNames, TOOL_MAP_CAP);
        capMap(toolUseParents, TOOL_MAP_CAP);
        if (e.toolName === 'ExitPlanMode') {
          // The proposed plan rides the tool input (input.plan — verified on
          // CLI 2.1.173; the call itself is denied by plan mode / the
          // tale-plan-gate hook, which doesn't affect the input streaming out).
          const plan = planFromToolInput(e.input);
          if (plan !== undefined) planText = plan;
        } else if (args.permissionMode !== 'plan') {
          // Execute-mode reset rule: a plan only counts if its tool was the
          // turn's LAST tool call. Verified on 2.1.173: under bypassPermissions
          // the model can shrug off the denial/stop and keep executing —
          // surfacing a stale plan after the work already continued would be wrong.
          planText = undefined;
        }
      } else if (e.type === 'steer-injected') {
        // Live confirmation that the steer hook injected queued user
        // message(s) into this running turn (only the Stop-hook delivery
        // surfaces in the stream; PostToolUse injections are caught by the
        // flush's consumed.* dir poll). Collected per batch — consumption +
        // seam trip happen at batch end, below.
        injectedIds.push(...e.messageIds);
      } else if (e.type === 'tool-result') {
        // A tool boundary just passed — exactly where the PostToolUse steer
        // hook fires. Let the next flush poll the steer dir immediately
        // instead of waiting out the poll throttle.
        steerPollNow = true;
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
    }
    // Steer seam at the ACTUAL injection point (Stop-hook path). Deferred to
    // batch end: cursor.lastSeq already covers this whole chunk (seq advances
    // per stdout chunk before parser.feed), so the batch must be fully
    // recorded before the abort — same-chunk events after the sentinel stay
    // in this pre-injection segment, which the model round-trip between
    // injection and response makes practically empty. The trip is gated on
    // markConsumed flipping > 0 rows, so a sentinel replayed across a
    // re-attach (or the dir poll winning the same consumption) can't seam
    // twice; a flip that loses the staging race (rows not yet 'delivered')
    // is picked up by the next dir poll instead.
    if (injectedIds.length > 0 && args.threadId !== undefined) {
      const threadId = args.threadId;
      sawSteerInjected = true;
      void ctx
        .runMutation(internal.threads.message_queue.markConsumed, {
          threadId,
          messageIds: injectedIds,
        })
        .then((flipped) => {
          if (flipped > 0) tripSteerSeam();
        })
        .catch((err: unknown) =>
          console.warn('[run_agent] steer markConsumed failed:', err),
        );
    }
  };

  const flushProgress = async (force: boolean): Promise<void> => {
    const now = Date.now();
    if (!force && now - lastFlush < PROGRESS_FLUSH_MS) return;
    lastFlush = now;
    // Lingering flag for steer_delivery: reset the dirty bit before the await
    // (optimistic — a failed flush re-marks on the next transition or is
    // simply retried by the next flush carrying the same value).
    const sendIdle = agentIdleDirty;
    agentIdleDirty = false;
    // A workflow-run step has no chat message, so stamp a bounded UI-part
    // transcript on the op for the run view (chat renders from its message).
    const liveTimeline = args.captureLiveTimeline
      ? capAccumulatedLiveParts(
          priorTimelineParts,
          buildUiPartsFromTimeline(
            timeline,
            finalText ?? '',
            toolNames,
            toolUseParents,
            liveText,
          ),
        )
      : undefined;
    await ctx.runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      ...(args.threadId !== undefined && { threadId: args.threadId }),
      execId: args.execId,
      kind: 'agent-run',
      status: 'running',
      progressText: progressText.slice(-8_000),
      ...(liveTimeline !== undefined && { liveTimeline }),
      // Heartbeat + resume cursor so the recovery watchdog can tell a live
      // draining action from a dead one, and a continuation knows where to
      // re-attach.
      heartbeatAt: now,
      ...(lastEventAt !== undefined && { lastEventAt }),
      lastSeq: cursor.lastSeq,
      ...(sendIdle && { agentIdle }),
      ...(capturedSessionId !== undefined && {
        agentSessionId: capturedSessionId,
      }),
    });
    // Durable mirror: patch the streaming chat message with the timeline-so-far
    // on the same throttle. This is the record that survives an early end (the
    // op buffer is capped + cleared); best-effort so a transient patch failure
    // never aborts the live run.
    const content = buildAssistantContent(
      timeline,
      finalText ?? '',
      toolNames,
      toolUseParents,
      liveText,
    );
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
    // deadline uses → the drain aborts, the run returns 'running', and the
    // caller finalizes this message and opens a fresh one for the next segment.
    // The agent's exec keeps running (detach-grace) and `--resume` keeps the
    // conversation continuous; only the rendered message is segmented.
    if (!handoff && estimateContentBytes(content) > MAX_MESSAGE_BYTES) {
      handoff = true;
      controller.abort();
    }
    // Steer seam at the ACTUAL injection point (PostToolUse path — that
    // injection never reaches stdout; only the hook's consumed.* renames are
    // observable). The delivered queue rows themselves are the pending
    // signal: while any exist, watch the steer dir (throttled — a tool-result
    // bypasses the throttle since that's the boundary the hook fires at) and
    // seal only on observed consumption. Sealing at staging time stranded the
    // rest of the current answer below the steered user message. Stop-hook
    // injections are caught earlier, in-stream, by recordEvents. The !handoff
    // guard also keeps the forced flush in the handoff path from blocking on
    // a (up to 30s) directory listing.
    if (
      !handoff &&
      !steerSeamTripped &&
      args.threadId !== undefined &&
      args.agentSlug === 'claude-code' &&
      (steerPollNow || now - lastSteerPoll >= STEER_POLL_INTERVAL_MS)
    ) {
      // Reset before the awaits so an overlapping flush doesn't double-poll.
      steerPollNow = false;
      lastSteerPoll = now;
      const threadId = args.threadId;
      try {
        const delivered = await ctx.runQuery(
          internal.threads.message_queue.listDeliveredForExec,
          { threadId, execId: args.execId },
        );
        // Marker evidence only applies to file-channel rows: a stdin row's
        // tombstoned file also grows a consumed.* marker, but that says
        // nothing about the stdin push — and must not trip a spurious seam
        // mid-steered-turn. stdin rows are confirmed by the next result.
        const fileDelivered = delivered.filter((r) => r.channel === 'file');
        if (fileDelivered.length > 0) {
          // A null listing means the dir (or session) is gone ⇒ treat as
          // nothing consumed; never infer session death here — the drain's
          // own attach surfaces that and feeds the existing self-heal.
          const entries = await sessionListFiles(
            args.sessionId,
            steerDirFor(args.execId),
          );
          const consumedIds = matchConsumedSteerFiles(fileDelivered, entries);
          if (consumedIds.length > 0) {
            const flipped = await ctx.runMutation(
              internal.threads.message_queue.markConsumed,
              { threadId, messageIds: consumedIds },
            );
            if (flipped > 0) tripSteerSeam();
          }
        }
      } catch (seamErr) {
        // Transport error: the rows stay 'delivered', so pending isn't lost —
        // retry on a later flush. Never fatal to the drain.
        console.warn('[run_agent] steer consumption poll failed:', seamErr);
      }
    }
  };

  const callbacks = {
    onStdout: (text: string) => {
      recordEvents(parser.feed(text));
      void flushProgress(false);
    },
    // Agent CLIs put diagnostics on stderr; surface them to the action logs.
    // (The live UI renders tool/reasoning rows from the persisted message, not
    // from a separate op buffer, so stderr no longer feeds the timeline.)
    onStderr: (text: string) => {
      if (text.trim()) {
        console.warn(`[run_agent] agent stderr: ${text}`);
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
      // 'hold' keeps the child's stdin open for the linger loop's steer
      // pushes + EOF close — omitting this spawns close-mode and every
      // stdin write comes back STDIN_CLOSED (the silent-fallback trap that
      // shipped the feature dark on first deploy).
      ...(exec.stdinMode !== undefined && { stdinMode: exec.stdinMode }),
      // Stream-only: the agent's output is consumed live off the SSE; the
      // spawner's terminal stdout buffer is unused here. Collecting it would
      // grow the spawner unboundedly for a long turn AND, once past runnerd's
      // 5 MB cap, silently cut the live stream dark mid-run (the blackout bug).
      collectOutput: false,
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

  // Linger loop (claude-code stdin-hold): inert until the per-turn agent
  // result, then delivers steer messages via stdin / sends EOF when drained.
  // Interval (vs one-shot) because it is also the retry path for transient
  // query/transport failures and the pickup path for rows enqueued while the
  // process lingers on background tasks.
  const lingerTimer = stdinHold
    ? setInterval(() => {
        void lingerTick();
      }, LINGER_TICK_MS)
    : undefined;

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
      ...(lastEventAt !== undefined && { lastEventAt }),
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
  // Hard-deadline watchdog (see HANDOFF_HARD_GRACE_MS): the AbortSignal handed to
  // the drain is best-effort, so RACE the drain against `budgetDeadlineMs + grace`.
  // If the drain wedges past the soft abort, the watchdog forces the handoff and
  // rejects INTO the existing handoff-return path below — guaranteeing this action
  // returns + checkpoints before the platform hard-kills it. The abandoned drain
  // is harmless: the next segment re-attaches from cursor.lastSeq.
  const drainPromise = drainSessionExecResilient(
    args.sessionId,
    body,
    controller.signal,
    callbacks,
    {
      cursor,
      ...(resuming && { resumeSinceSeq: args.resumeFrom?.lastSeq ?? 0 }),
    },
  );
  let hardDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let guardedDrain: Promise<SessionExecResult>;
  if (args.budgetDeadlineMs === undefined) {
    guardedDrain = drainPromise;
  } else {
    const hardDeadlineAtMs = args.budgetDeadlineMs + HANDOFF_HARD_GRACE_MS;
    // Swallow a LATE drain rejection (settling after the deadline already won the
    // race) so an abandoned drain never surfaces as an unhandledRejection.
    void drainPromise.catch(() => {});
    const deadline = new Promise<never>((_resolve, reject) => {
      hardDeadlineTimer = setTimeout(
        () => {
          if (!handoff) {
            handoff = true;
            controller.abort();
          }
          console.warn(
            `[run_agent] hard-deadline watchdog forced handoff — drain did not honor the abort in time (execId=${args.execId})`,
          );
          reject(new Error('hard-deadline-handoff'));
        },
        Math.max(0, hardDeadlineAtMs - Date.now()),
      );
    });
    guardedDrain = Promise.race([drainPromise, deadline]);
  }
  try {
    result = await guardedDrain;
  } catch (err) {
    if (hardDeadlineTimer) clearTimeout(hardDeadlineTimer);
    drainActive = false;
    if (budgetTimer) clearTimeout(budgetTimer);
    if (lingerTimer) clearInterval(lingerTimer);
    if (eofWatchdog) clearTimeout(eofWatchdog);
    clearInterval(heartbeatTimer);
    if (handoff) {
      // Action window elapsed mid-turn → hand off. Do NOT parser.end() (the
      // continuation re-attaches mid-line via sinceSeq); persist the latest
      // timeline so the continuation + UI have it, then return the checkpoint.
      await flushProgress(true);
      if (sawSteerInjected && !steerSeam) {
        // Injection observed but a non-steer handoff won the race to abort
        // and markConsumed hadn't confirmed yet. Usually self-corrects at the
        // top of the continuation (replayed sentinel → rows still delivered);
        // logged so the rare empty-segment misplacement is traceable.
        console.warn(
          `[run_agent] steer injection observed but handoff returned without steerSeam (execId=${args.execId})`,
        );
      }
      return {
        status: 'running',
        exitCode: null,
        ...(capturedSessionId !== undefined && {
          agentSessionId: capturedSessionId,
        }),
        ...(finalText !== undefined && { finalText }),
        ...(planText !== undefined && { planText }),
        ...(usage !== undefined && { usage }),
        assistantContent: buildAssistantContent(
          timeline,
          finalText ?? '',
          toolNames,
          toolUseParents,
        ),
        lastSeq: cursor.lastSeq,
        toolNames: Object.fromEntries(toolNames),
        toolUseParents: Object.fromEntries(toolUseParents),
        // Ternary (not &&): steerSeam is only assigned inside the flush
        // closure, so TS narrows the `let` to its `false` initializer here.
        ...(steerSeam ? { steerSeam: true } : {}),
        // stdin-hold lifecycle for the continuation (see resumeFrom).
        ...(agentResultSeen ? { agentResultSeen: true } : {}),
        ...(agentIdle ? { agentIdle: true } : {}),
        ...(pendingTasks.size > 0 && { pendingTaskIds: [...pendingTasks] }),
        ...(apiErrorSeen ? { apiErrorSeen: true } : {}),
      };
    }
    throw err;
  }
  if (hardDeadlineTimer) clearTimeout(hardDeadlineTimer);
  drainActive = false;
  if (budgetTimer) clearTimeout(budgetTimer);
  if (lingerTimer) clearInterval(lingerTimer);
  if (eofWatchdog) clearTimeout(eofWatchdog);
  clearInterval(heartbeatTimer);
  // A sentinel surfacing only here (parser.end after the terminal result)
  // still flips the pill via the batch-end markConsumed task, but its
  // tripSteerSeam is inert (drainActive=false) — a finished drain must not
  // be aborted.
  recordEvents(parser.end());
  if (sawSteerInjected && !steerSeam) {
    // The injection landed close enough to the turn's natural end that the
    // terminal result won the race against the seam abort. Ordering above
    // the steered message may be off for this one turn; rows reconcile
    // normally. Observability only — never retro-split persisted content.
    console.warn(
      `[run_agent] steer injection observed but the turn reached a terminal result before the seam (execId=${args.execId})`,
    );
  }

  // Post-EOF reap: the cancel was OURS (a wedged process after stdin EOF),
  // not a user Stop — report the agent's own result, which already streamed.
  if (platformReap && result.status === 'cancelled') {
    result = {
      ...result,
      status: agentResultStatus === 'completed' ? 'completed' : 'failed',
    };
  }

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
    heartbeatAt: Date.now(),
    lastSeq: cursor.lastSeq,
    ...(capturedSessionId !== undefined && {
      agentSessionId: capturedSessionId,
    }),
    ...(result.exitCode !== null && { exitCode: result.exitCode }),
  });

  const assistantContent = buildAssistantContent(
    timeline,
    finalText ?? '',
    toolNames,
    toolUseParents,
    // Include the open block so a mid-write Stop (terminal 'cancelled') keeps
    // the partial answer. On a clean end it is '' (the block's `text` event
    // already cleared it), so terminal content is byte-identical to before.
    liveText,
  );
  // Stalled-turn force-close emits no `result`, so finalText is unset; surface the
  // captured API/stream error so the sandbox step's thrown error names the cause
  // (the timeline already renders it, so this isn't fed into assistantContent).
  const terminalFinalText =
    finalText ?? (turnStalled ? apiErrorText : undefined);

  return {
    status: result.status,
    exitCode: result.exitCode,
    ...(capturedSessionId !== undefined && {
      agentSessionId: capturedSessionId,
    }),
    ...(terminalFinalText !== undefined && { finalText: terminalFinalText }),
    ...(planText !== undefined && { planText }),
    ...(usage !== undefined && { usage }),
    ...(agentResultStatus !== undefined && { agentResultStatus }),
    ...(resultIsError !== undefined && { isError: resultIsError }),
    ...(resultApiErrorStatus !== undefined && {
      apiErrorStatus: resultApiErrorStatus,
    }),
    // Ternary (not &&): authAborted/authAbortStatus are assigned only inside the
    // recordEvents/lingerTick closures, so TS narrows the `let`s to their
    // initializers here (same as steerSeam above) — `&&` would spread `false`.
    ...(authAborted ? { terminationReason: 'auth-abort' as const } : {}),
    ...(authAborted && authAbortStatus !== undefined
      ? { authAbortStatus }
      : {}),
    assistantContent,
  };
}

/** Evict oldest entries (insertion order) so a Map stays within `cap`. */
function capMap(map: Map<string, string>, cap: number): void {
  while (map.size > cap) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
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
    agentSlug: v.union(
      v.literal('claude-code'),
      v.literal('cursor'),
      v.literal('hermes'),
      v.literal('gemini'),
    ),
    prompt: v.string(),
    model: v.optional(v.string()),
    /** Resume handle from a prior run (Claude session_id / Cursor chat id). */
    agentSessionId: v.optional(v.string()),
    maxTurns: v.optional(v.number()),
    browserMcp: v.optional(v.boolean()),
    authMode: v.optional(v.union(v.literal('managed'), v.literal('byo'))),
    nativeWebTools: v.optional(v.boolean()),
    /** LLM gateway root + the session virtual key. Present for managed
     * runs; omitted for byo. */
    gatewayBaseUrl: v.optional(v.string()),
    gatewayToken: v.optional(v.string()),
    integrationsBaseUrl: v.optional(v.string()),
    visionTool: v.optional(v.boolean()),
    visionModel: v.optional(v.string()),
    workdir: v.optional(v.string()),
    timeoutMs: v.optional(v.number()),
  },
  returns: v.object({
    status: v.union(
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
      v.literal('running'),
    ),
    exitCode: v.union(v.number(), v.null()),
    agentSessionId: v.optional(v.string()),
    finalText: v.optional(v.string()),
    agentResultStatus: v.optional(
      v.union(
        v.literal('completed'),
        v.literal('error'),
        v.literal('max-turns'),
        v.literal('cancelled'),
      ),
    ),
  }),
  handler: (ctx, args) => runAgentInSessionImpl(ctx, args),
});
