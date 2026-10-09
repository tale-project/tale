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
 * windows. Each window restores an atomic checkpoint of its parser, partial
 * JSONL line, background-task ledger and bounded display projection, then
 * attaches after its acknowledged stream cursor. The daemon retains the
 * unacknowledged bytes on disk, so a worker restart cannot lose accounting or
 * confuse a missing task-start event with a finished background task. Older
 * runtimes without checkpoints keep their seq-0 compatibility path.
 * This module owns the lane-neutral
 * core: exec construction (`buildExternalTurnExec`, with the model window
 * `resolveHarnessTurnContextWindow` reads), the window drain
 * (`drainHarnessWindow`), end classification (`classifyHarnessEnd`), and the
 * bounded event→transcript projection (`HarnessProjection`); each host wraps it
 * with its own token mint, progress sink, and settle.
 */

import { z } from 'zod';

import { resolveEffectiveWindow } from '../../../lib/chat/budget';
import { stagedInstructionsPathForExec } from '../../../lib/harnesses/exec-builder';
import { HarnessProjection } from '../../../lib/harnesses/projection';
import { getHarnessGlue } from '../../../lib/harnesses/registry';
import { type TimelinePart } from '../../../lib/harnesses/timeline';
import {
  isHarnessSlug,
  type HarnessEvent,
  type HarnessExec,
} from '../../../lib/harnesses/types';
import { traceSandboxPhase } from '../../tracing';
import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import { loadHarnesses } from '../lib/providers/load_system_config';
import { resolveModel } from '../lib/providers/resolve_model';
import {
  drainSessionExecResilient,
  ExecReplayGapError,
  ExecStreamProtocolError,
  isSpawnerTransportFailure,
  SessionNotFoundError,
  sessionCancelExec,
  sessionDeleteFiles,
  sessionGetExecCheckpoint,
  sessionPutExecCheckpoint,
  sessionWriteExecStdin,
  type ExecCursor,
  type ExecStreamContact,
  type SessionExecCheckpoint,
  sessionStageFiles,
  type SessionExecBody,
  type SessionExecResult,
} from '../node_only/sandbox/helpers/session_client';
import {
  gatewayRequestTimeoutSeconds,
  gatewayStreamIdleTimeoutSeconds,
} from '../node_only/sandbox/llm_gateway_admin';

/** Session-relative dir every staged skill lands in — the work lanes' org
 * skills and the per-connector skills alike, so the instructions can point
 * at one tree. */
export const SKILLS_DIR = 'workspace/.tale/skills';
/** One drain window; well under the Convex action execution ceiling. */
const DRAIN_WINDOW_MS = 90_000;
/** After the parser sees `turn-ended` with no background task open, how long
 * to keep draining for the exec's natural exit (which carries its exit code)
 * before cutting the window and reaping the exec. A hold-stdin harness
 * (claude-code) exits once its stdin is closed, which the window does at that
 * moment; the cut is the fallback for a process that does not. */
const TURN_ENDED_EXIT_GRACE_MS = 1_500;
/** Floor between two mid-window notifications of the accumulating output —
 * the cadence of the `onText`/`onTimeline` progress sinks, so a host's
 * per-notification write stays off the hot path. */
const STREAM_TEXT_THROTTLE_MS = 500;
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

/** How long a turn waits out a sandbox spawner it cannot reach before its
 * run settles as failed: long enough for a spawner restart, a deploy or a
 * short partition, and at most a third of runnerd's orphan window
 * ({@link EXTERNAL_TURN_DEADLINE_MS}, counted from the turn's last attach),
 * so the exec the turn finds again is still the one it left. */
export const SPAWNER_OUTAGE_BUDGET_MS = Math.min(
  10 * 60_000,
  Math.floor(EXTERNAL_TURN_DEADLINE_MS / 3),
);
/** The pause before the next window of a turn whose spawner is away, so a
 * window that ends at once (its checkpoint read refused) does not chain its
 * successor in a tight loop. */
const SPAWNER_OUTAGE_REDRIVE_MS = 5_000;

/** Whether a window ended in a spawner outage that has outlasted
 * {@link SPAWNER_OUTAGE_BUDGET_MS}: the turn stops waiting and settles. */
export function spawnerOutageOutlasted(
  window: HarnessWindowResult,
  now: number = Date.now(),
): boolean {
  return (
    window.kind === 'running' &&
    window.spawnerOutageSince !== undefined &&
    now - window.spawnerOutageSince >= SPAWNER_OUTAGE_BUDGET_MS
  );
}

/** How long after a `running` window its successor starts: at once while
 * the exec's stream flows, after a pause while the spawner is away. */
export function nextWindowDelayMs(window: HarnessWindowResult): number {
  return window.kind === 'running' && window.spawnerOutageSince !== undefined
    ? SPAWNER_OUTAGE_REDRIVE_MS
    : 0;
}

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
    process.env.SANDBOX_HTTP_API_BASE_URL ?? 'http://backend-api:3005'
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

/** Whether a harness holds its stdin open as a steering channel (the
 * `ndjson-user-message` stdin mode): such a CLI answers turn after turn and
 * exits only on stdin EOF. */
function harnessHoldsStdin(harness: string): boolean {
  if (!isHarnessSlug(harness)) return false;
  const def = loadHarnesses().find((h) => h.slug === harness);
  return def?.exec.stdin.mode === 'ndjson-user-message';
}

/** The session-relative file a harness's subscription credential is staged
 * to (the `staged-file` delivery: Gemini's OAuth credentials under the
 * session HOME), when the harness delivers it that way. */
function stagedSubscriptionPath(harness: string): string | undefined {
  if (!isHarnessSlug(harness)) return undefined;
  const def = loadHarnesses().find((h) => h.slug === harness);
  return def?.subscription?.kind === 'staged-file'
    ? def.subscription.path
    : undefined;
}

/**
 * Remove a harness's staged subscription credential from the session. The
 * file sits in the session HOME every later exec shares — another task's
 * turn, a member-confined run, a connector call — so a member's refresh
 * token must leave with the turn that was handed it, and must not be there
 * for a turn that runs without it. A no-op for a harness that takes its
 * subscription through the environment. Best-effort: a failure is logged,
 * and the next turn of the harness that does not stage the credential
 * removes it again before it starts.
 */
export async function removeStagedSubscription(
  sessionId: string,
  harness: string,
): Promise<void> {
  const path = stagedSubscriptionPath(harness);
  if (path === undefined) return;
  try {
    const removed = await sessionDeleteFiles(sessionId, [path]);
    for (const skipped of removed.skipped) {
      console.warn(
        `[harness-turn] ${sessionId}: the staged subscription credential ${skipped.path} could not be removed: ${skipped.reason}`,
      );
    }
  } catch (err) {
    // A session that is gone took its HOME, and the credential, with it.
    if (err instanceof SessionNotFoundError) return;
    console.warn(
      `[harness-turn] ${sessionId}: removing the staged subscription credential ${path} failed:`,
      err,
    );
  }
}

/**
 * Remove the instructions addendum one exec was staged with (OpenCode's
 * `.runtime/tale/instructions/<execId>.md`) once its turn is over. The file
 * is named for the exec, so no other turn reads it, and a project agent's
 * worker serves turn after turn: without this it keeps one file for every
 * turn it ever ran. A no-op for a harness that passes its instructions
 * another way. Best-effort: a failure is logged, and a file left behind
 * holds only the turn's own instructions.
 */
export async function removeStagedInstructions(
  sessionId: string,
  harness: string,
  execId: string,
): Promise<void> {
  if (!isHarnessSlug(harness)) return;
  const def = loadHarnesses().find((h) => h.slug === harness);
  if (def === undefined) return;
  let path: string | undefined;
  try {
    path = stagedInstructionsPathForExec(def, execId);
  } catch (err) {
    console.warn(
      `[harness-turn] ${sessionId}/${execId}: the staged instructions path of ${harness} could not be derived:`,
      err,
    );
    return;
  }
  if (path === undefined) return;
  try {
    const removed = await sessionDeleteFiles(sessionId, [path]);
    for (const skipped of removed.skipped) {
      console.warn(
        `[harness-turn] ${sessionId}/${execId}: the staged instructions ${skipped.path} could not be removed: ${skipped.reason}`,
      );
    }
  } catch (err) {
    // A session that is gone took the file with it.
    if (err instanceof SessionNotFoundError) return;
    console.warn(
      `[harness-turn] ${sessionId}/${execId}: removing the staged instructions ${path} failed:`,
      err,
    );
  }
}

/** Whether a harness mounts MCP servers — and so the platform bridge every
 * workspace tool rides. A harness whose YAML declares `capabilities.mcp:
 * false` (Pi, Hermes, Cursor) can call none of them, so a tool that exists
 * only on the bridge is neither granted to nor mentioned on its turns. */
export function harnessMountsMcp(harness: string): boolean {
  if (!isHarnessSlug(harness)) return false;
  const def = loadHarnesses().find((h) => h.slug === harness);
  return def?.capabilities.mcp === true;
}

/** Whether the platform continues a previous turn's conversation on this
 * harness — the next kick of a task, an automation node's retry or its
 * answered ask hand the exec the announced handle. A harness whose YAML
 * declares `capabilities.resume: false` (Gemini CLI, whose `--resume`
 * replays every tool result twice) starts every such kick as a FRESH
 * conversation over the preserved workspace instead; the exec builder
 * refuses a handle on it, so the planners must read this first. */
export function harnessResumesConversations(harness: string): boolean {
  if (!isHarnessSlug(harness)) return false;
  const def = loadHarnesses().find((h) => h.slug === harness);
  return def?.capabilities.resume === true;
}

/** How a managed external turn authenticates: the session gateway virtual
 * key, or a redeemed vendor-subscription token the harness's YAML
 * `subscription` section injects (the vendor CLI authenticates directly).
 * A subscription turn still carries a session-scoped `bridgeToken` — the
 * capability bridge, the steering hook, and the managed model pins all ride
 * the managed env shell; only the vendor auth pair is overridden. */
export type ExternalTurnServing =
  | { kind: 'gateway'; token: string }
  | {
      kind: 'subscription';
      secret: string;
      /** The vendor API base the CLI calls — overrides the gateway base var. */
      baseUrl: string;
      /** Broker-selected CLI token channel and vendor account metadata. */
      targetEnvVar?: string;
      accountId?: string;
      /** Session token for the capability bridge (never a gateway VK). */
      bridgeToken: string;
    };

/** Filter broker pools before selection when this CLI needs vendor account
 * metadata: custom provider aliases using the same harness get the same gate. */
export function harnessRequiresSubscriptionAccountId(harness: string): boolean {
  const delivery = loadHarnesses().find(
    (fact) => fact.slug === harness,
  )?.subscription;
  return delivery?.kind === 'env' && delivery.accountIdVar !== undefined;
}

/** The person a session op acts for, as the attribution read answers it —
 * '' when none resolves, the subject its spend cap is evaluated for then. */
function attributedUserId(attribution: unknown): string {
  return typeof attribution === 'object' &&
    attribution !== null &&
    'userId' in attribution &&
    typeof attribution.userId === 'string'
    ? attribution.userId
    : '';
}

/**
 * The effective context window of a managed harness turn's model, in tokens:
 * what `buildExternalTurnExec` hands the harness, so a CLI that does not know
 * a foreign model (Claude Code assumes 200,000 tokens) sizes its conversation
 * to the window the model serves. It means what the chat lane means: the
 * serving connector's catalog entry (`resolveModel`, held to that connector),
 * narrowed by the organization's context limit (`resolveEffectiveWindow`) for
 * the person the turn acts for — the run's starter, whom its spend cap binds.
 *
 * Best-effort by design, never a reason to fail the turn: an entry that
 * cannot be resolved answers `undefined` (the harness keeps its own sizing),
 * and an unreadable context limit leaves the catalog window standing.
 */
export async function resolveHarnessTurnContextWindow(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    /** The serving connector, and the model in its catalog spelling. */
    providerSlug: string;
    modelId: string;
    /** The turn's session op — its attribution names whose context limit
     * applies. */
    sessionId: string;
    execId: string;
    kind: 'task-agent' | 'workflow-agent';
  },
): Promise<number | undefined> {
  let contextWindow: number;
  try {
    const { entry } = await resolveModel(
      ctx,
      args.organizationId,
      args.modelId,
      args.providerSlug,
      true,
    );
    contextWindow = entry.contextWindow;
  } catch (err) {
    console.warn(
      `[harness-turn] ${args.execId}: no catalog window for ${args.providerSlug}/${args.modelId} — the harness sizes its conversation on its own:`,
      err,
    );
    return undefined;
  }
  let governanceMaxContext: number | null = null;
  try {
    const attribution: unknown = await ctx.runQuery(
      internal.sandbox.session_queries.getSessionOpAttribution,
      {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        execId: args.execId,
        kind: args.kind,
      },
    );
    const cap: unknown = await ctx.runQuery(
      internal.governance.queries.getContextCapInternal,
      {
        organizationId: args.organizationId,
        userId: attributedUserId(attribution),
      },
    );
    governanceMaxContext = typeof cap === 'number' ? cap : null;
  } catch (err) {
    console.warn(
      `[harness-turn] ${args.execId}: the organization's context limit could not be read — the catalog window of ${args.providerSlug}/${args.modelId} stands:`,
      err,
    );
  }
  return resolveEffectiveWindow({ contextWindow, governanceMaxContext });
}

/** Build the harness exec for a managed external turn. */
export function buildExternalTurnExec(args: {
  harness: string;
  gatewayModel: string;
  /** The model's effective context window in tokens, when resolved
   * (`resolveHarnessTurnContextWindow`); absent leaves the harness to size
   * its conversation on its own. */
  contextWindow?: number;
  serving: ExternalTurnServing;
  instructions: string;
  prompt: string;
  resume?: string;
  execId: string;
  /** When set, mount the in-image connectors MCP bridge pointed here —
   * only for turns whose agent is equipped with at least one connector. */
  bridgeUrl?: string;
  /** The sandbox's vision lane: the gateway model the in-image vision tools
   * call, and — with `polyfillReads` — the one image reads route through
   * instead of the (text-only) serving model. The turn's own gateway key
   * authenticates the vision calls, so the caller must have included this
   * model in the key's allowed set. */
  vision?: { model: string; polyfillReads: boolean };
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
    ...(args.contextWindow !== undefined
      ? { contextWindow: args.contextWindow }
      : {}),
    // BOTH lanes run the managed env shell — the capability bridge, the
    // vision/steering hooks, and the managed model-pin slots all read the
    // gateway pair. A subscription turn substitutes its session bridge
    // token there (valid for the bridge, never for inference) and lets the
    // harness YAML's `subscription` delivery override the auth pair AFTER
    // the credential env (exec-builder applies it last), so the vendor CLI
    // authenticates directly against `baseUrl` instead of the gateway.
    credential: {
      mode: 'managed',
      gateway: {
        baseUrl: gatewayBaseUrlForSessions(),
        token:
          args.serving.kind === 'gateway'
            ? args.serving.token
            : args.serving.bridgeToken,
        // The gateway's own idle budget: a CLI with a client-side idle
        // watchdog must not give up on (and send again) a request the gateway
        // is still waiting on. Rounded to whole milliseconds for the env.
        streamIdleTimeoutMs: Math.round(
          gatewayStreamIdleTimeoutSeconds() * 1000,
        ),
        // And its request timeout: the same rule for the wait on a whole
        // answer, so the CLI never abandons a request the gateway serves.
        requestTimeoutMs: Math.round(gatewayRequestTimeoutSeconds() * 1000),
      },
    },
    ...(args.serving.kind === 'subscription'
      ? {
          subscription: {
            secret: args.serving.secret,
            baseUrl: args.serving.baseUrl,
            ...(args.serving.targetEnvVar !== undefined
              ? { targetEnvVar: args.serving.targetEnvVar }
              : {}),
            ...(args.serving.accountId !== undefined
              ? { accountId: args.serving.accountId }
              : {}),
          },
        }
      : {}),
    workdir: '/agent/workspace',
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

/** One entry of the op row's live timeline. */
export type HarnessTimelinePart = TimelinePart;

const turnEndSchema = z.object({
  type: z.literal('turn-ended'),
  status: z.enum(['completed', 'error', 'max-turns', 'cancelled']),
  sessionId: z.string().optional(),
  finalText: z.string().optional(),
  durationMs: z.number().optional(),
  usageTotals: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      costEstimateUsd: z.number().optional(),
    })
    .optional(),
  isError: z.boolean().optional(),
  apiErrorStatus: z.number().optional(),
  providerErrorKind: z.literal('model_capacity').optional(),
});
const turnCheckpointSchema = z.object({
  version: z.literal(1),
  harness: z.string(),
  parser: z.unknown(),
  projection: z.unknown(),
  pendingTasks: z.array(z.string().max(1024)).max(4096),
  ended: turnEndSchema.optional(),
  agentSessionId: z.string().optional(),
  outputTokens: z.number(),
  stderrRing: z.string(),
  harnessError: z.string().optional(),
});

/** What one harness window observed — the lane-neutral core result. */
export type HarnessWindowResult =
  | { kind: 'gone' }
  | {
      kind: 'running';
      text: string;
      timeline: HarnessTimelinePart[];
      agentSessionId?: string;
      /** Set while the turn's spawner is out of reach: since when no window
       * has got through to the exec's stream (`spawnerOutageSince` carried
       * in, or this window's first transport failure). Absent once the
       * stream flowed again. */
      spawnerOutageSince?: number;
    }
  | {
      kind: 'terminal';
      text: string;
      /** Display text is bounded; a successful result must use finalText if
       * the display omitted an earlier prefix. */
      textTruncated?: boolean;
      /** Exact bounded fallback when the harness terminal has no finalText. */
      answerText?: string;
      timeline: HarnessTimelinePart[];
      ended?: Extract<HarnessEvent, { type: 'turn-ended' }>;
      execResult?: SessionExecResult;
      exited: boolean;
      agentSessionId?: string;
      /** The last lines the harness wrote to stderr (`harnessOutputTail`),
       * when it wrote any — what a crash names as its cause. */
      stderrTail?: string;
      /** The last failure the harness itself named on its stream (a parser
       * `error` event: Codex `turn.failed`, Hermes `run_end.error`) — what a
       * harness-reported error gives as its reason. */
      harnessError?: string;
      /** The output tokens the window's `usage` reports add up to; absent
       * reads as none. */
      outputTokens?: number;
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
  /** Throttled bounded text-tail callback (at most ~2/s), for live display. */
  onText?: (text: string) => void;
  /** Throttled transcript-so-far callback (same cadence as `onText`), in the
   * op row's `liveTimeline` shape. The chat lane renders its transcript from
   * the persisted message; a run has no message, so its lane persists this
   * onto the session op and the run views read it back. */
  onTimeline?: (parts: HarnessTimelinePart[]) => void;
  /** Called once on a start window, after staging and just before the exec
   * launches — the moment "queued" stops being true. */
  onStarted?: () => Promise<void>;
  /** The drain window length — `DRAIN_WINDOW_MS` unless a test shortens it. */
  windowMs?: number;
  /**
   * Ends the window early, the way its elapsing does: the exec keeps
   * running and the window answers `running`, so its caller hands the turn
   * to a next window — a stopping server passes it so another process
   * drains the turn on. Only a re-attach window takes it: aborting a start
   * window before its exec launched would lose the start.
   */
  signal?: AbortSignal;
  /** The outage the window before ended in (its result's
   * `spawnerOutageSince`), so an outage that outlasts one window is measured
   * from its start. */
  spawnerOutageSince?: number;
}): Promise<HarnessWindowResult> {
  const glue = getHarnessGlue(
    isHarnessSlug(args.harness) ? args.harness : 'claude-code',
    loadHarnesses(),
  );
  const parser = glue.createParser();
  const projection = new HarnessProjection();
  const cursor: ExecCursor = { lastSeq: 0 };
  let ended: Extract<HarnessEvent, { type: 'turn-ended' }> | undefined;
  let agentSessionId: string | undefined;
  let outputTokens = 0;

  // A hold-stdin harness (claude-code) lingers after its reply waiting for
  // more input, so its process exit can be a whole window away from the
  // `turn-ended` event that actually ends the turn. Once the turn has ended
  // with no background task open, the window closes that stdin — the CLI's
  // own way to finish: it writes its transcript and exits with its real exit
  // code, which the drain then reports. The grace bounds the wait for that
  // exit (and for a close-stdin harness's own); when it elapses the drain is
  // cut and the exec reaped, so a process that ignores the EOF cannot hold
  // the turn open.
  let replayComplete = args.start !== undefined;
  const turnEndedCut = new AbortController();
  let turnEndedGrace: ReturnType<typeof setTimeout> | undefined;
  const holdsStdin = harnessHoldsStdin(args.harness);
  let stdinClosed = false;
  const closeHeldStdin = () => {
    if (!holdsStdin || stdinClosed) return;
    stdinClosed = true;
    void Promise.resolve()
      .then(() =>
        sessionWriteExecStdin(args.sessionId, args.execId, { eof: true }),
      )
      .then(
        (wrote) => {
          // STDIN_CLOSED: an earlier window already sent it; NOT_FOUND: the
          // exec is gone. Neither leaves anything for the grace cut to miss.
          if (
            !wrote.ok &&
            wrote.reason !== 'STDIN_CLOSED' &&
            wrote.reason !== 'NOT_FOUND'
          ) {
            console.warn(
              `[harness-window] ${args.execId}: stdin EOF refused (${wrote.reason ?? 'unknown'}); the grace cut reaps the exec`,
            );
          }
        },
        (err: unknown) =>
          console.warn(
            `[harness-window] ${args.execId}: stdin EOF failed; the grace cut reaps the exec:`,
            err,
          ),
      );
  };

  // The background-task ledger (`types.ts` contract): a harness that
  // launched background work reports `task-started`/`task-settled` pairs,
  // and a `turn-ended` whose ledger is still open is a LINGERING turn — the
  // main reply is in, but a deliverable may still be being written. The turn
  // is done only when the reply is in AND the ledger is empty; the checkpoint
  // carries that ledger across windows independently of display retention.
  const pendingTasks = new Set<string>();
  const armTurnEndedCut = () => {
    if (!replayComplete || turnEndedGrace !== undefined) return;
    turnEndedGrace = setTimeout(
      () => turnEndedCut.abort(),
      TURN_ENDED_EXIT_GRACE_MS,
    );
    closeHeldStdin();
  };
  const disarmTurnEndedCut = () => {
    if (turnEndedGrace === undefined) return;
    clearTimeout(turnEndedGrace);
    turnEndedGrace = undefined;
  };

  let lastNotifiedText = '';
  let lastNotifiedEventCount = 0;
  let lastNotifyAt = 0;
  const notifyTextSoFar = () => {
    if (!replayComplete) return;
    if (args.onText === undefined && args.onTimeline === undefined) return;
    const now = Date.now();
    if (now - lastNotifyAt < STREAM_TEXT_THROTTLE_MS) return;
    // The text notifies only when non-empty and changed; the transcript
    // advances on tool activity even when no new text arrived (a tool-heavy
    // stretch emits none), so the timeline tracks parsed events instead of
    // riding the text guard — behind it, a run's live log stalls until the
    // agent's next text block and then floods the whole backlog at once.
    const text = projection.text;
    const textAdvanced = text !== '' && text !== lastNotifiedText;
    const timelineAdvanced =
      args.onTimeline !== undefined &&
      projection.revision > lastNotifiedEventCount;
    if (!textAdvanced && !timelineAdvanced) return;
    lastNotifyAt = now;
    if (textAdvanced) {
      lastNotifiedText = text;
      args.onText?.(text);
    }
    if (timelineAdvanced) {
      lastNotifiedEventCount = projection.revision;
      args.onTimeline?.(projection.timeline());
    }
  };

  // The harness's stderr is not the protocol (no event ever rides it), but
  // it is where a CLI says why it could not start — a config it refuses, a
  // path it cannot find. The last few KB are kept so a crash can name its
  // cause; before this they were streamed and dropped, and every startup
  // failure read "exited unexpectedly (exit code 1)" with nothing to act on
  // (2026-09-26 evaluation, C-08).
  let stderrRing = '';
  const onStderr = (chunk: string) => {
    stderrRing = (stderrRing + chunk).slice(-STDERR_RING_CHARS);
    maybeCheckpoint();
  };

  // The harness's own account of a failure. Before this the `error` events
  // were pushed and never read: a Codex turn the provider refused settled
  // with the agent's last narration sentence as its reason (2026-09-26).
  let harnessError: string | undefined;
  const restoreCheckpoint = (checkpoint: SessionExecCheckpoint) => {
    const state = turnCheckpointSchema.parse(checkpoint.state);
    if (state.harness !== args.harness)
      throw new Error('sandbox exec checkpoint belongs to another harness');
    parser.restore(state.parser);
    projection.restore(state.projection);
    cursor.lastSeq = checkpoint.seq;
    pendingTasks.clear();
    for (const id of state.pendingTasks) pendingTasks.add(id);
    ended = state.ended;
    agentSessionId = state.agentSessionId;
    outputTokens = state.outputTokens;
    stderrRing = state.stderrRing;
    harnessError = state.harnessError;
    lastNotifiedEventCount = -1;
  };
  // A spawner that restarts, crashes or is cut off for a while is not a
  // verdict on the turn: runnerd keeps its exec running in the session
  // container. The drain rides such an outage out within the window, and the
  // window ends `running` with the outage's start, so its host chains the
  // next window, which resumes from the checkpoint, and bounds the outage.
  let outageSince = args.spawnerOutageSince;
  const contact: ExecStreamContact = {
    onAttached: () => {
      outageSince = undefined;
    },
    onLost: () => {
      outageSince ??= Date.now();
    },
  };
  if (args.start === undefined) {
    let checkpoint: SessionExecCheckpoint | null;
    try {
      checkpoint = await sessionGetExecCheckpoint(args.sessionId, args.execId);
    } catch (error) {
      if (!isSpawnerTransportFailure(error)) throw error;
      console.warn(
        `[harness-window] ${args.execId}: the spawner did not answer the checkpoint read; the turn waits for it:`,
        error instanceof Error ? error.message : String(error),
      );
      return {
        kind: 'running',
        text: '',
        timeline: [],
        spawnerOutageSince: outageSince ?? Date.now(),
      };
    }
    if (checkpoint !== null) restoreCheckpoint(checkpoint);
  }
  let lastCheckpointAt = Date.now();
  let pendingCheckpoint: SessionExecCheckpoint | undefined;
  let checkpointWrite: Promise<void> | undefined;
  const writeCheckpoints = async () => {
    while (pendingCheckpoint !== undefined) {
      const checkpoint = pendingCheckpoint;
      pendingCheckpoint = undefined;
      try {
        await sessionPutExecCheckpoint(args.sessionId, args.execId, checkpoint);
      } catch (error) {
        // Never acknowledge on failure. The daemon retains the unacknowledged
        // spool so another worker can resume the last successful checkpoint.
        console.warn('[harness-window] checkpoint write failed:', error);
      }
    }
    checkpointWrite = undefined;
  };
  const flushCheckpoints = async () => {
    for (;;) {
      const active = checkpointWrite;
      if (active === undefined) return;
      await active;
    }
  };
  const maybeCheckpoint = (force = false) => {
    if (
      cursor.lastSeq === 0 ||
      (!force && Date.now() - lastCheckpointAt < 5_000)
    )
      return;
    lastCheckpointAt = Date.now();
    pendingCheckpoint = {
      seq: cursor.lastSeq,
      state: {
        version: 1,
        harness: args.harness,
        parser: parser.snapshot(),
        projection: projection.snapshot(),
        pendingTasks: [...pendingTasks],
        ended,
        agentSessionId,
        outputTokens,
        stderrRing,
        harnessError,
      },
    };
    checkpointWrite ??= Promise.resolve().then(writeCheckpoints);
  };
  let outputFailure: { error: unknown } | undefined;
  const acceptEvent = (e: HarnessEvent) => {
    projection.accept(e);
    if (e.type === 'turn-started' && e.sessionId !== undefined)
      agentSessionId = e.sessionId;
    if (e.type === 'usage') outputTokens += e.outputTokens;
    if (e.type === 'error') {
      harnessError = e.message;
    } else if (e.type === 'task-started') {
      if (
        e.taskId.length > 1024 ||
        (pendingTasks.size >= 4096 && !pendingTasks.has(e.taskId))
      ) {
        throw new Error(
          'Harness background-task ledger exceeds its safety budget',
        );
      }
      pendingTasks.add(e.taskId);
      // A task launched inside the grace (reply in, cut armed) reopens the
      // ledger — the cut must wait for it.
      disarmTurnEndedCut();
    } else if (e.type === 'task-settled') {
      pendingTasks.delete(e.taskId);
    } else if (e.type === 'turn-ended') {
      ended = e;
      agentSessionId ??= e.sessionId;
    }
    if (ended !== undefined && pendingTasks.size === 0) armTurnEndedCut();
  };
  const consumeStdout = (chunk: string) => {
    for (const e of parser.feed(chunk)) acceptEvent(e);
    notifyTextSoFar();
    maybeCheckpoint();
  };

  const onStdout = (chunk: string) => {
    try {
      consumeStdout(chunk);
    } catch (error) {
      outputFailure = { error };
      throw error;
    }
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

  // A turn that runs without the subscription must not find an earlier
  // turn's staged credential in the session HOME (its settle's removal is
  // best-effort): take it out before this exec can read it.
  if (args.start !== undefined) {
    const credentialPath = stagedSubscriptionPath(args.harness);
    if (
      credentialPath !== undefined &&
      !(args.start.stagedFiles ?? []).some(
        (file) => file.path === credentialPath,
      )
    ) {
      await removeStagedSubscription(args.sessionId, args.harness);
    }
  }

  // On the start window we STAGE the exec's input files, then start it; drain
  // windows restore parser state and continue after its acknowledged cursor.
  // An old runtime without checkpoints retains the seq-0 compatibility lane.
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

  const windowSignal = AbortSignal.timeout(args.windowMs ?? DRAIN_WINDOW_MS);
  const drainSignal = AbortSignal.any([
    windowSignal,
    turnEndedCut.signal,
    ...(args.signal !== undefined ? [args.signal] : []),
  ]);
  if (ended !== undefined && pendingTasks.size === 0) armTurnEndedCut();
  let exited = false;
  let execResult: SessionExecResult | undefined;
  let unresolvedReplayGap: ExecReplayGapError | undefined;
  try {
    let resumeDrain = args.start === undefined;
    for (;;) {
      try {
        execResult = await traceSandboxPhase('execute', () =>
          drainSessionExecResilient(
            args.sessionId,
            body,
            drainSignal,
            {
              onStdout,
              onStderr,
              onReplayStarted: () => {
                replayComplete = false;
                disarmTurnEndedCut();
              },
              onReplayComplete: () => {
                replayComplete = true;
                notifyTextSoFar();
                if (ended !== undefined && pendingTasks.size === 0)
                  armTurnEndedCut();
              },
            },
            {
              cursor,
              contact,
              ...(resumeDrain ? { resumeSinceSeq: cursor.lastSeq } : {}),
            },
          ),
        );
        break;
      } catch (error) {
        if (!(error instanceof ExecReplayGapError)) throw error;
        unresolvedReplayGap = error;
        if (drainSignal.aborted) throw error;
        // A recovering sibling can commit and prune after our checkpoint
        // read but before attach. Adopt its newer atomic snapshot, never
        // restart the exec or parse a suffix without its missing prefix.
        const newer = await sessionGetExecCheckpoint(
          args.sessionId,
          args.execId,
        );
        // Merely advancing is insufficient: the snapshot must account for
        // every missing event, even if the end grace expires during its GET.
        // An invalid/old gap without a verifiable range fails closed.
        if (
          newer === null ||
          newer.seq <= cursor.lastSeq ||
          error.toSeq === undefined ||
          newer.seq < error.toSeq
        )
          throw error;
        disarmTurnEndedCut();
        pendingCheckpoint = undefined;
        restoreCheckpoint(newer);
        unresolvedReplayGap = undefined;
        if (ended !== undefined && pendingTasks.size === 0) armTurnEndedCut();
        resumeDrain = true;
      }
    }
    exited = true;
    if (unreplayableExecResult(execResult)) {
      // A refused stream does not prove that its process has stopped. Never
      // leave an agent writing after losing the ledger that fences its end.
      await sessionCancelExec(args.sessionId, args.execId).catch((err) =>
        console.warn('[harness-window] replay-gap reap failed:', err),
      );
    }
  } catch (err) {
    // A deadline/grace can fire while recovery awaits I/O. It cannot turn a
    // known missing prefix or rejected parser record into a successful end.
    if (outputFailure !== undefined) throw outputFailure.error;
    if (unresolvedReplayGap !== undefined) throw unresolvedReplayGap;
    if (err instanceof SessionNotFoundError) return { kind: 'gone' };
    if (err instanceof ExecStreamProtocolError) {
      await sessionCancelExec(args.sessionId, args.execId).catch((cancelErr) =>
        console.warn('[harness-window] invalid-stream reap failed:', cancelErr),
      );
      throw err;
    }
    if (!drainSignal.aborted) throw err;
    // Window elapsed with the exec still live, or the turn ended under a
    // lingering exec — either way not a drain failure.
  } finally {
    disarmTurnEndedCut();
    await flushCheckpoints();
  }
  // `end()` is the parser's EOF: the process has exited and whatever it
  // buffered is final — a family that HOLDS a result until the stream ends
  // (pi's retry hold) finalizes it here. A window that merely elapsed under a
  // live exec is not an EOF: flushing it would turn a mid-tool assistant stop
  // into a completed turn and cut the process under it. The checkpoint keeps
  // the parser's unfinished line and held result for the next window.
  const replayGap = unreplayableExecResult(execResult);
  if (exited && !replayGap) {
    for (const e of parser.end()) acceptEvent(e);
    disarmTurnEndedCut();
  }

  // A partial historical prefix cannot replace the persisted transcript or
  // supply a trustworthy final result/accounting total after replay fails.
  const text = replayGap ? '' : projection.text;
  const timeline = replayGap ? [] : projection.timeline();
  if (replayGap) ended = undefined;
  // Reply in, background ledger still open: the harness is still working
  // (a deliverable may be mid-write) — keep draining, never reap.
  const lingeringOnTasks =
    !exited && ended !== undefined && pendingTasks.size > 0;
  const terminal =
    exited || (replayComplete && ended !== undefined && !lingeringOnTasks);
  if (!terminal) {
    maybeCheckpoint(true);
    await flushCheckpoints();
    if (lingeringOnTasks) {
      console.warn(
        `[harness-window] ${args.execId}: turn ended with ${pendingTasks.size} background task(s) still running — draining on`,
      );
    }
    return {
      kind: 'running',
      text,
      timeline,
      ...(agentSessionId !== undefined ? { agentSessionId } : {}),
      ...(outageSince !== undefined ? { spawnerOutageSince: outageSince } : {}),
    };
  }

  // A harness that lingers after its turn (held-open stdin it did not exit
  // on) has ended the turn but not the process — reap it so it can't hold
  // the session.
  if (!exited && ended !== undefined) {
    await sessionCancelExec(args.sessionId, args.execId).catch((err) =>
      console.warn('[harness-window] linger reap failed:', err),
    );
  }

  const stderrTail = harnessOutputTail(stderrRing);
  return {
    kind: 'terminal',
    text,
    textTruncated: projection.textTruncated,
    answerText: replayGap ? '' : projection.answer,
    timeline,
    ...(ended !== undefined ? { ended } : {}),
    ...(execResult !== undefined ? { execResult } : {}),
    exited,
    ...(agentSessionId !== undefined ? { agentSessionId } : {}),
    ...(stderrTail !== '' ? { stderrTail } : {}),
    ...(harnessError !== undefined ? { harnessError } : {}),
    ...(!replayGap ? { outputTokens } : {}),
  };
}

/** Older spawners return protocol failures as result records; the current
 * transport raises ExecStreamProtocolError for their named error events. */
function unreplayableExecResult(
  result: SessionExecResult | undefined,
): boolean {
  return (
    result?.errorCode === 'OUTPUT_GAP' ||
    result?.errorCode === 'REPLAY_GAP' ||
    result?.errorCode === 'REPLAY_UNAVAILABLE' ||
    result?.errorCode === 'OUTPUT_LIMIT'
  );
}

/** How much of the harness's stderr a window keeps. */
const STDERR_RING_CHARS = 4_096;
/** How much of it a crash reason quotes. */
const STDERR_TAIL_CHARS = 600;

/**
 * The last lines of a harness's stderr, fit for a run's failure reason:
 * terminal escapes and control characters out, whitespace folded, anything
 * shaped like a bearer token or an API key redacted (a CLI echoing its
 * config must never put a credential on a run row), cut to the tail.
 */
export function harnessOutputTail(stderr: string): string {
  const plain = stderr
    // oxlint-disable-next-line no-control-regex -- terminal escapes are exactly what is stripped here
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // oxlint-disable-next-line no-control-regex -- control characters other than whitespace
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\b(?:Bearer\s+)?(?:sk-|key-)[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > STDERR_TAIL_CHARS
    ? `…${plain.slice(-STDERR_TAIL_CHARS)}`
    : plain;
}

/** The exec result code the sandbox ends a hung exec with: it printed
 * nothing and its processes used under 1% of one CPU for the whole stall
 * window (`services/sandbox/src/wire.ts`). */
const EXEC_STALLED_CODE = 'EXEC_STALLED';

/** The reason a turn settles failed with when the sandbox ended its harness
 * as stalled. */
export const STALLED_TURN_REASON =
  "The agent stopped making progress: it printed nothing and used almost no CPU for the sandbox's stall window (45 minutes unless the operator changed it), so the sandbox ended it.";

/** The reason a turn settles failed with when its model answered nothing. */
export const EMPTY_ANSWER_REASON =
  'The model returned an empty answer, so the agent did nothing this turn.';

/** What `classifyHarnessEnd` reads of a terminal window. */
type HarnessEndWindow = Pick<
  Extract<HarnessWindowResult, { kind: 'terminal' }>,
  | 'ended'
  | 'execResult'
  | 'exited'
  | 'text'
  | 'textTruncated'
  | 'answerText'
  | 'timeline'
  | 'outputTokens'
  | 'stderrTail'
  | 'harnessError'
>;

function hasWords(text: string | undefined): boolean {
  return text !== undefined && text.trim() !== '';
}

/**
 * Whether a completed turn got nothing at all from its model — the answer a
 * serving cluster that fails mid-prefill can give as an empty 200 (observed
 * live: Claude Code ended the turn cleanly without writing an assistant
 * message, and the settle read that as a deliberate no-op). Anything the
 * window saw the model produce is an answer: text (streamed, or only on the
 * end), a tool call, or output tokens, from the window's usage reports or
 * the end's own totals. The tokens are what counts a turn that only reasoned
 * (no timeline part shows reasoning), and for a harness whose end reports
 * the whole turn they also cover reasoning absent from the timeline.
 */
function isEmptyAnswer(
  window: HarnessEndWindow,
  ended: Extract<HarnessEvent, { type: 'turn-ended' }>,
): boolean {
  if (ended.status !== 'completed') return false;
  const answered =
    hasWords(window.answerText) ||
    hasWords(window.text) ||
    hasWords(ended.finalText) ||
    window.timeline.some((part) => part.type !== 'text' || hasWords(part.text));
  const spentTokens =
    (window.outputTokens ?? 0) > 0 ||
    (ended.usageTotals?.outputTokens ?? 0) > 0;
  return !answered && !spentTokens;
}

/**
 * A turn-terminating API error that means the turn's money is gone, not
 * that the provider hiccuped: the gateway's virtual-key budget refusal
 * (`402 budget_exceeded` — the key was minted at what the org's spend cap
 * had left) or a vendor's own payment refusal (OpenRouter answers 402 on
 * exhausted credits). A retry is refused the same way — and a RESUMED retry
 * replays the whole transcript into a key sized from the same balance, so
 * every re-kick died on its second call — hence both lanes settle it as
 * `budget_exceeded`, which their retry gates never re-kick.
 */
export function isSpendRefusal(
  ended: { apiErrorStatus?: number } | undefined,
): boolean {
  return ended?.apiErrorStatus === 402;
}

/** The settle reason for a spend refusal: names the cause (the harness's
 * own last words only quote the gateway's 402 line) and keeps that line as
 * the detail. */
export function spendRefusalReason(finalText: string | undefined): string {
  const detail = finalText?.trim() ?? '';
  const MAX = 300;
  const tail = detail.length <= MAX ? detail : `… ${detail.slice(-MAX)}`;
  return `the turn's spend allowance was exhausted (API status 402)${
    tail === '' ? '' : `: ${tail}`
  }`;
}

/** How a terminal window classifies: the agent's own `turn-ended.isError`
 * wins when it exists (with the failure the harness named, when it named
 * one); an exit without `turn-ended` is a crash by definition, with the
 * exec's own error carried as the reason; and a turn that completed with
 * nothing from its model is an empty answer. */
export function classifyHarnessEnd(window: HarnessEndWindow): {
  errored: boolean;
  /** Why the turn failed: the failure the harness named on its stream
   * (`harnessError`), or — when the platform, not the harness, says so — a
   * crash or an empty answer. A harness that only FLAGS the error (Claude
   * Code's `is_error` result) gets none: its own final words are the
   * reason. */
  reason?: string;
  /** A completed turn with nothing from its model (`isEmptyAnswer`). */
  emptyAnswer: boolean;
} {
  const { ended, execResult } = window;
  if (unreplayableExecResult(execResult)) {
    return {
      errored: true,
      emptyAnswer: false,
      reason:
        'The sandbox could not replay the complete agent output. Retry the run to continue from the preserved workspace.',
    };
  }
  if (ended === undefined) {
    if (!window.exited) return { errored: false, emptyAnswer: false };
    const crashed =
      execResult?.errorMessage !== undefined && execResult.errorMessage !== ''
        ? `The harness stopped: ${execResult.errorMessage}`
        : `The harness exited unexpectedly${
            typeof execResult?.exitCode === 'number'
              ? ` (exit code ${execResult.exitCode})`
              : ''
          } without completing the turn.`;
    // The harness's own last words are the only lead a crash leaves.
    const reason =
      window.stderrTail !== undefined && window.stderrTail !== ''
        ? `${crashed} Last output: ${window.stderrTail}`
        : crashed;
    return { errored: true, reason, emptyAnswer: false };
  }
  if (ended.isError === true) {
    const named = window.harnessError?.trim() ?? '';
    if (named === '') return { errored: true, emptyAnswer: false };
    // The run row is a status row, not a log store — the head carries the
    // provider's sentence, a long tail is the payload it quoted.
    const MAX = 500;
    return {
      errored: true,
      reason: named.length <= MAX ? named : `${named.slice(0, MAX)} …`,
      emptyAnswer: false,
    };
  }
  if (
    window.textTruncated === true &&
    !hasWords(ended.finalText) &&
    !hasWords(window.answerText)
  ) {
    return {
      errored: true,
      reason:
        'The harness did not provide its complete final answer; the available progress text is truncated.',
      emptyAnswer: false,
    };
  }
  if (isEmptyAnswer(window, ended)) {
    return { errored: true, reason: EMPTY_ANSWER_REASON, emptyAnswer: true };
  }
  return { errored: false, emptyAnswer: false };
}

/**
 * Whether the sandbox, not the harness, ended a terminal window's exec, with
 * the reason such a turn settles with. Read beside {@link classifyHarnessEnd},
 * whose crash reading it refines: `stalled` when runnerd ended the exec
 * because it printed nothing and its processes used under 1% of one CPU for
 * the whole stall window (`EXEC_STALLED`). A hang an immediate retry would
 * most likely meet again, so each host settles it with a code of its own.
 * Nothing while the exec still runs, and nothing when the harness ended its
 * turn itself: its own end stands.
 */
export function sandboxEndOf(
  window: HarnessEndWindow,
): { failure: 'stalled'; reason: string } | undefined {
  if (window.ended !== undefined || !window.exited) return undefined;
  if (window.execResult?.errorCode !== EXEC_STALLED_CODE) return undefined;
  // What it printed last is what it hung on.
  const tail = window.stderrTail ?? '';
  return {
    failure: 'stalled',
    reason:
      tail !== ''
        ? `${STALLED_TURN_REASON} Last output: ${tail}`
        : STALLED_TURN_REASON,
  };
}
