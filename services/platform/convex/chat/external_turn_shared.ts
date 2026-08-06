'use node';

/**
 * The shared harness-turn library for the WORK lanes — automation `agent`
 * nodes (`automations/agent_host.ts`) and project-agent task runs
 * (`tasks/agent_run_host.ts`). Chat itself no longer runs harness turns
 * (#2877 made chat plain-conversation-only); the file keeps its historical
 * path because those hosts import it here.
 *
 * A harness turn runs a coding-harness CLI (Claude Code, Codex, …) inside a
 * sandbox session. The exec runs UNDER runnerd, independent of any single
 * Convex action: it is started once and then DRAINED in short self-chaining
 * windows (a Convex action cannot be held open for a long turn — a cold or
 * slow turn would outlive its execution window and be killed mid-run). Each
 * window re-attaches to the running exec from the START of runnerd's
 * byte-identical replay buffer and re-parses the full output-so-far —
 * re-parsing from the start (rather than carrying a per-delta cursor across
 * windows) keeps a JSONL line that straddles a window boundary from being
 * stranded by the fresh per-window parser. This module owns the lane-neutral
 * core: exec construction (`buildExternalTurnExec`), the window drain
 * (`drainHarnessWindow`), end classification (`classifyHarnessEnd`), and the
 * event→transcript projection (`timelineFromEvents`); each host wraps it
 * with its own token mint, progress sink, and settle.
 */

import { getHarnessGlue } from '../../lib/harnesses/registry';
import {
  boundTimelineParts,
  type TimelinePart,
} from '../../lib/harnesses/timeline';
import {
  isHarnessSlug,
  type HarnessEvent,
  type HarnessExec,
} from '../../lib/harnesses/types';
import { loadHarnesses } from '../lib/providers/load_system_config';
import {
  drainSessionExecResilient,
  SessionNotFoundError,
  sessionCancelExec,
  sessionStageFiles,
  type SessionExecBody,
  type SessionExecResult,
} from '../node_only/sandbox/helpers/session_client';

/** Session-relative dir every staged skill lands in — the work lanes' org
 * skills and the per-connector skills alike, so the instructions can point
 * at one tree. */
export const SKILLS_DIR = 'workspace/.tale/skills';
/** One drain window; well under the Convex action execution ceiling. */
export const DRAIN_WINDOW_MS = 90_000;
/** After the parser sees `turn-ended`, how long to keep draining for the
 * exec's natural exit (which carries a close-stdin harness's exit code)
 * before cutting the window. A hold-stdin harness (claude-code) never exits
 * on its own — without the cut, every reply would sit out the full window. */
export const TURN_ENDED_EXIT_GRACE_MS = 1_500;
/** Floor between two mid-window notifications of the accumulating output —
 * the cadence of the `onText`/`onTimeline` progress sinks, so a host's
 * per-notification write stays off the hot path. */
export const STREAM_TEXT_THROTTLE_MS = 250;
/** The `timeoutMs` handed to a harness exec. NOT a turn deadline: runnerd's
 * timer is a SLIDING orphan window (re-armed on every drain attach, see the
 * daemon's exec manager), not an absolute cap — an exec whose drainer keeps
 * chaining windows runs unbounded by it; it only reaps an exec whose drain
 * chain died. The work lanes' absolute cap is `agentWorkTurnDeadlineMs` in
 * `sandbox/agent_deadline.ts`. */
const EXTERNAL_TURN_DEADLINE_MS = (() => {
  const configured = Number(process.env.TALE_EXTERNAL_TURN_DEADLINE_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : 30 * 60_000;
})();

/** The gateway base URL as a session's CONTAINER reaches it (sandbox network
 * alias, never the host address). */
function gatewayBaseUrlForSessions(): string {
  const url =
    process.env.EXTERNAL_AGENT_GATEWAY_URL ?? 'http://sandbox-llm-gateway:8080';
  return url.replace(/\/$/, '');
}

/** The connectors-bridge base URL as a session's CONTAINER reaches it — the
 * platform HTTP-actions origin over the sandbox network alias (same contract
 * as the staging callback), plus the bridge's route prefix. */
export function connectorsBridgeUrlForSessions(): string {
  const origin = (
    process.env.SANDBOX_HTTP_API_BASE_URL ?? 'http://convex:3211'
  ).replace(/\/$/, '');
  return `${origin}/api/connectors`;
}

/** Whether a harness can run in the MANAGED lane (V1's only path): it must be
 * a known slug AND declare `credentialPolicy.managed`. A byo-only harness
 * (e.g. Cursor) can't route through the session gateway, so a managed turn on
 * it would build an inert exec that hangs to the deadline — refuse it up
 * front instead. */
export function isManagedHarness(harness: string): boolean {
  if (!isHarnessSlug(harness)) return false;
  const def = loadHarnesses().find((h) => h.slug === harness);
  return def?.credentialPolicy.managed === true;
}

/** How a managed external turn authenticates: the session gateway virtual
 * key, or a redeemed vendor-subscription token the harness's YAML
 * `subscription` section injects (the vendor CLI authenticates directly). */
export type ExternalTurnServing =
  | { kind: 'gateway'; token: string }
  | { kind: 'subscription'; secret: string; baseUrl?: string };

/** Build the harness exec for a managed external turn. */
export function buildExternalTurnExec(args: {
  harness: string;
  gatewayModel: string;
  serving: ExternalTurnServing;
  instructions: string;
  prompt: string;
  resume?: string;
  execId: string;
  /** When set, mount the in-image connectors MCP bridge pointed here —
   * only for turns whose agent is equipped with at least one connector. */
  bridgeUrl?: string;
  /** Arm the vision polyfill: images the harness reads route to this gateway
   * model instead of the (text-only) serving model. The turn's own gateway
   * key authenticates the vision calls, so the caller must have included
   * this model in the key's allowed set. */
  vision?: { model: string };
  /** Extra per-exec env under the harness's own (the Tier-2 broker's git
   * credential + author identity) — the harness env wins on collision, so a
   * connector token can never shadow a credential/config key the harness
   * itself needs. */
  extraEnv?: Record<string, string>;
}): HarnessExec {
  if (!isHarnessSlug(args.harness)) {
    throw new Error(`Unknown harness "${args.harness}".`);
  }
  const glue = getHarnessGlue(args.harness, loadHarnesses());
  const exec = glue.buildExec({
    prompt: args.prompt,
    model: args.gatewayModel,
    // A subscription turn runs the byo credential shape with an EMPTY env —
    // the harness YAML's `subscription` delivery injects the token (and it
    // deliberately overrides the same-named gateway vars), so the vendor CLI
    // authenticates directly instead of riding the session gateway.
    credential:
      args.serving.kind === 'gateway'
        ? {
            mode: 'managed',
            gateway: {
              baseUrl: gatewayBaseUrlForSessions(),
              token: args.serving.token,
            },
          }
        : { mode: 'byo', env: {} },
    ...(args.serving.kind === 'subscription'
      ? {
          subscription: {
            secret: args.serving.secret,
            ...(args.serving.baseUrl !== undefined
              ? { baseUrl: args.serving.baseUrl }
              : {}),
          },
        }
      : {}),
    workdir: '/user/workspace',
    ...(args.resume !== undefined ? { resume: args.resume } : {}),
    posture: 'act',
    ...(args.instructions !== '' ? { instructions: args.instructions } : {}),
    ...(args.bridgeUrl !== undefined
      ? { mcp: { bridgeUrl: args.bridgeUrl } }
      : {}),
    ...(args.vision !== undefined ? { vision: args.vision } : {}),
    execId: args.execId,
  });
  if (args.extraEnv === undefined) return exec;
  return { ...exec, env: { ...args.extraEnv, ...exec.env } };
}

/** Text produced so far: the streamed deltas concatenated, or the complete
 * text blocks when a harness emits those instead of deltas. */
function textFromEvents(events: readonly HarnessEvent[]): string {
  const deltas = events
    .filter(
      (e): e is Extract<HarnessEvent, { type: 'text-delta' }> =>
        e.type === 'text-delta',
    )
    .map((e) => e.text)
    .join('');
  if (deltas !== '') return deltas;
  return events
    .filter(
      (e): e is Extract<HarnessEvent, { type: 'text' }> => e.type === 'text',
    )
    .map((e) => e.text)
    .join('\n\n');
}

/** One entry of the op row's `liveTimeline` — the AI-SDK UI-part shape the
 * run views render. Canonically `TimelinePart`; the alias keeps this module's
 * historical name for its many importers. */
export type HarnessTimelinePart = TimelinePart;

/** Per-entry payload cap — a tool that reads a whole file must not push a
 * multi-megabyte input into a reactive query. */
const TIMELINE_VALUE_CHARS = 2000;
/** Per-text-block cap, applied to the TAIL: a long reasoning block matters
 * for its latest lines, and the op row is a status row, not a log store. */
const TIMELINE_TEXT_CHARS = 4000;

function clampTimelineValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value);
  if (json === undefined) return undefined;
  return json.length <= TIMELINE_VALUE_CHARS
    ? value
    : `${json.slice(0, TIMELINE_VALUE_CHARS)}…`;
}

/**
 * The harness event stream projected onto the op row's transcript shape:
 * assistant text blocks plus each tool call with its result state. Tool
 * results fold into their call (keyed by `toolUseId`) so one tool shows as
 * one entry that moves from `input-available` to `output-available`/`error`.
 */
export function timelineFromEvents(
  events: readonly HarnessEvent[],
): HarnessTimelinePart[] {
  // A harness that streams deltas ALSO emits the finished block for the same
  // words (claude-code does), so consuming both would print every sentence
  // twice. Same rule as `textFromEvents`: deltas win when there are any.
  const streamsDeltas = events.some((event) => event.type === 'text-delta');
  const textKind = streamsDeltas ? 'text-delta' : 'text';
  const parts: HarnessTimelinePart[] = [];
  const byToolCall = new Map<string, HarnessTimelinePart>();
  let text = '';
  const flushText = () => {
    if (text === '') return;
    parts.push({
      type: 'text',
      text:
        text.length <= TIMELINE_TEXT_CHARS
          ? text
          : `…${text.slice(-TIMELINE_TEXT_CHARS)}`,
    });
    text = '';
  };
  for (const event of events) {
    if (event.type === 'text-delta' || event.type === 'text') {
      if (event.type !== textKind) continue;
      text +=
        event.type === 'text' && text !== '' ? `\n\n${event.text}` : event.text;
      continue;
    }
    if (event.type === 'tool-use') {
      flushText();
      const part: HarnessTimelinePart = {
        type: `tool-${event.toolName}`,
        state: 'input-available',
        toolCallId: event.toolUseId,
        ...(clampTimelineValue(event.input) !== undefined
          ? { input: clampTimelineValue(event.input) }
          : {}),
      };
      byToolCall.set(event.toolUseId, part);
      parts.push(part);
      continue;
    }
    if (event.type === 'tool-result') {
      const part = byToolCall.get(event.toolUseId);
      if (!part) continue;
      part.state = event.isError === true ? 'output-error' : 'output-available';
      const output = clampTimelineValue(event.output);
      if (event.isError === true) {
        part.errorText =
          typeof output === 'string' ? output : JSON.stringify(output);
      } else if (output !== undefined) {
        part.output = output;
      }
    }
  }
  flushText();
  return boundTimelineParts(parts);
}

function lastTurnEnded(
  events: readonly HarnessEvent[],
): Extract<HarnessEvent, { type: 'turn-ended' }> | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e !== undefined && e.type === 'turn-ended') return e;
  }
  return undefined;
}

/** The harness's OWN conversation id, announced on `turn-started` (or, for
 * harnesses that only stamp it at the end, `turn-ended`). Every drain window
 * replays the ring from seq 0, so any window past the announcement sees it.
 * This is the `--resume` handle a restart needs — the lanes persist it on
 * the op row so a mid-run restart can continue the same conversation. */
function harnessSessionIdFromEvents(
  events: readonly HarnessEvent[],
): string | undefined {
  for (const e of events) {
    if (e.type === 'turn-started' && e.sessionId !== undefined) {
      return e.sessionId;
    }
    if (e.type === 'turn-ended' && e.sessionId !== undefined) {
      return e.sessionId;
    }
  }
  return undefined;
}

/** What one harness window observed — the lane-neutral core result. */
export type HarnessWindowResult =
  | { kind: 'gone' }
  | {
      kind: 'running';
      text: string;
      timeline: HarnessTimelinePart[];
      agentSessionId?: string;
    }
  | {
      kind: 'terminal';
      text: string;
      timeline: HarnessTimelinePart[];
      ended?: Extract<HarnessEvent, { type: 'turn-ended' }>;
      execResult?: SessionExecResult;
      exited: boolean;
      agentSessionId?: string;
    };

/**
 * The lane-neutral window core: start or re-attach to a harness exec, drain
 * one window, and report what it saw. Owns the parser, the `turn-ended` grace
 * cut, staged-input staging on the start window, and the linger reap — but
 * knows nothing about threads, messages, or runs. The automation agent host
 * and the task-agent run host each wrap it with their own progress sink and
 * settle.
 */
export async function drainHarnessWindow(args: {
  sessionId: string;
  execId: string;
  harness: string;
  start?: HarnessExec;
  /** Throttled full-text-so-far callback (at most ~1/s), for live display. */
  onText?: (text: string) => void;
  /** Throttled transcript-so-far callback (same cadence as `onText`), in the
   * op row's `liveTimeline` shape. The chat lane renders its transcript from
   * the persisted message; a run has no message, so its lane persists this
   * onto the session op and the run views read it back. */
  onTimeline?: (parts: HarnessTimelinePart[]) => void;
  /** Called once on a start window, after staging and just before the exec
   * launches — the moment "queued" stops being true. */
  onStarted?: () => Promise<void>;
}): Promise<HarnessWindowResult> {
  const glue = getHarnessGlue(
    isHarnessSlug(args.harness) ? args.harness : 'claude-code',
    loadHarnesses(),
  );
  const parser = glue.createParser();
  const events: HarnessEvent[] = [];

  // A hold-stdin harness (claude-code) lingers after its reply waiting for
  // more input, so its process exit can be a whole window away from the
  // `turn-ended` event that actually ends the turn. Cut the drain shortly
  // after the parser sees `turn-ended`; the grace lets a harness that DOES
  // exit deliver its terminal result (and exit code) first.
  const turnEndedCut = new AbortController();
  let turnEndedGrace: ReturnType<typeof setTimeout> | undefined;

  let lastNotifiedText = '';
  let lastNotifiedEventCount = 0;
  let lastNotifyAt = 0;
  const notifyTextSoFar = () => {
    if (args.onText === undefined && args.onTimeline === undefined) return;
    const now = Date.now();
    if (now - lastNotifyAt < STREAM_TEXT_THROTTLE_MS) return;
    // The text notifies only when non-empty and changed; the transcript
    // advances on tool activity even when no new text arrived (a tool-heavy
    // stretch emits none), so the timeline tracks parsed events instead of
    // riding the text guard — behind it, a run's live log stalls until the
    // agent's next text block and then floods the whole backlog at once.
    const text = textFromEvents(events);
    const textAdvanced = text !== '' && text !== lastNotifiedText;
    const timelineAdvanced =
      args.onTimeline !== undefined && events.length > lastNotifiedEventCount;
    if (!textAdvanced && !timelineAdvanced) return;
    lastNotifyAt = now;
    if (textAdvanced) {
      lastNotifiedText = text;
      args.onText?.(text);
    }
    if (timelineAdvanced) {
      lastNotifiedEventCount = events.length;
      args.onTimeline?.(timelineFromEvents(events));
    }
  };

  const onStdout = (chunk: string) => {
    for (const e of parser.feed(chunk)) {
      events.push(e);
      if (e.type === 'turn-ended' && turnEndedGrace === undefined) {
        turnEndedGrace = setTimeout(
          () => turnEndedCut.abort(),
          TURN_ENDED_EXIT_GRACE_MS,
        );
      }
    }
    notifyTextSoFar();
  };

  const body: SessionExecBody = args.start
    ? {
        execId: args.execId,
        command: args.start.argv,
        cwd: args.start.cwd,
        env: args.start.env,
        ...(args.start.stdin !== undefined
          ? {
              stdinBase64: Buffer.from(args.start.stdin, 'utf8').toString(
                'base64',
              ),
            }
          : {}),
        ...(args.start.stdinMode !== undefined
          ? { stdinMode: args.start.stdinMode }
          : {}),
        collectOutput: false,
        timeoutMs: EXTERNAL_TURN_DEADLINE_MS,
      }
    : {
        execId: args.execId,
        collectOutput: false,
        timeoutMs: EXTERNAL_TURN_DEADLINE_MS,
      };

  // On the start window we STAGE the exec's input files, then start it; drain
  // windows attach from the ring-buffer start (resumeSinceSeq 0).
  if (
    args.start?.stagedFiles !== undefined &&
    args.start.stagedFiles.length > 0
  ) {
    const staged = await sessionStageFiles(
      args.sessionId,
      args.start.stagedFiles.map((file) => ({
        path: file.path,
        contentBase64: Buffer.from(file.content, 'utf8').toString('base64'),
      })),
    );
    if (staged.skipped.length > 0) {
      throw new Error(
        `staging exec inputs failed: ${staged.skipped.map((s) => s.path).join(', ')}`,
      );
    }
  }

  if (args.start !== undefined && args.onStarted !== undefined) {
    await args.onStarted();
  }

  const windowSignal = AbortSignal.timeout(DRAIN_WINDOW_MS);
  const drainSignal = AbortSignal.any([windowSignal, turnEndedCut.signal]);
  let exited = false;
  let execResult: SessionExecResult | undefined;
  try {
    execResult = await drainSessionExecResilient(
      args.sessionId,
      body,
      drainSignal,
      { onStdout },
      args.start ? {} : { resumeSinceSeq: 0 },
    );
    exited = true;
  } catch (err) {
    if (err instanceof SessionNotFoundError) return { kind: 'gone' };
    if (!drainSignal.aborted) throw err;
    // Window elapsed with the exec still live, or the turn ended under a
    // lingering exec — either way not a drain failure.
  } finally {
    if (turnEndedGrace !== undefined) clearTimeout(turnEndedGrace);
  }
  for (const e of parser.end()) events.push(e);

  const text = textFromEvents(events);
  const timeline = timelineFromEvents(events);
  const ended = lastTurnEnded(events);
  const agentSessionId = harnessSessionIdFromEvents(events);
  const terminal = exited || ended !== undefined;
  if (!terminal) {
    return {
      kind: 'running',
      text,
      timeline,
      ...(agentSessionId !== undefined ? { agentSessionId } : {}),
    };
  }

  // A harness that lingers after its turn (held-open stdin) has ended the turn
  // but not the process — reap it so it can't hold the session.
  if (!exited && ended !== undefined) {
    await sessionCancelExec(args.sessionId, args.execId).catch((err) =>
      console.warn('[harness-window] linger reap failed:', err),
    );
  }

  return {
    kind: 'terminal',
    text,
    timeline,
    ...(ended !== undefined ? { ended } : {}),
    ...(execResult !== undefined ? { execResult } : {}),
    exited,
    ...(agentSessionId !== undefined ? { agentSessionId } : {}),
  };
}

/** How a terminal window classifies: the agent's own `turn-ended.isError`
 * wins when it exists; an exit without `turn-ended` is a crash by
 * definition, with the exec's own error carried as the reason. */
export function classifyHarnessEnd(result: {
  ended?: Extract<HarnessEvent, { type: 'turn-ended' }>;
  execResult?: SessionExecResult;
  exited: boolean;
}): { errored: boolean; crashReason?: string } {
  const crashedNoResult = result.ended === undefined && result.exited;
  const errored =
    result.ended !== undefined
      ? result.ended.isError === true
      : crashedNoResult;
  const crashReason = crashedNoResult
    ? result.execResult?.errorMessage !== undefined &&
      result.execResult.errorMessage !== ''
      ? `The harness stopped: ${result.execResult.errorMessage}`
      : `The harness exited unexpectedly${
          typeof result.execResult?.exitCode === 'number'
            ? ` (exit code ${result.execResult.exitCode})`
            : ''
        } without completing the turn.`
    : undefined;
  return { errored, ...(crashReason !== undefined ? { crashReason } : {}) };
}
