/**
 * Projecting one run onto the canvas.
 *
 * A finished run carries the engine's own `trace` and `effects`; a run still in
 * flight carries only `checkpoints`, which the stepper writes node by node. Both
 * answer the same question — what happened to this node — so both are read here
 * into one per-node view, and the canvas overlay never has to know which of the
 * two it is looking at.
 *
 * Effects are kept as a flat, ordered list as well as per node. An effect is the
 * auditable part of a run: it says what was done, to which connector, with
 * what input. Summarising it away would defeat the point, so the list shows
 * every one, in the order it happened.
 */

import type { FlowShownState } from '@tale/ui/flow/node-status';

import type { RunWaitingFor } from '@/app/lib/backend/contract/automations';
import type { Effect, NodeStatus, NodeTrace } from '@/lib/engine/core/types';

/** How a run ended, or where it is. Mirrors the store's `status` union. */
export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'quarantined'
  | 'success'
  | 'failed'
  | 'cancelled';

const RUN_STATUSES: ReadonlySet<string> = new Set<RunStatus>([
  'queued',
  'running',
  'waiting',
  'quarantined',
  'success',
  'failed',
  'cancelled',
]);

export function readRunStatus(value: unknown): RunStatus {
  return typeof value === 'string' && RUN_STATUSES.has(value)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- membership checked against the union's own set
      (value as RunStatus)
    : 'queued';
}

/** A run is over when nothing further will be written to it. */
export function isRunFinished(status: RunStatus): boolean {
  return status === 'success' || status === 'failed' || status === 'cancelled';
}

const WAITING_KINDS: ReadonlySet<string> = new Set<RunWaitingFor>([
  'approval',
  'ask',
  'in_doubt',
  'agent',
  'room',
  'repeat',
]);

/** The `waitingFor` the read model answers on a parked run, or nothing. */
function readRunWaitingFor(value: unknown): RunWaitingFor | undefined {
  return typeof value === 'string' && WAITING_KINDS.has(value)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- membership checked against the union's own set
      (value as RunWaitingFor)
    : undefined;
}

/**
 * The node a `repeat:<nodeId>` / `agent:<nodeId>` / `room:<nodeId>` /
 * `in_doubt:<nodeId>` park names — the one place the park's detail prefix is
 * read, so the page can say "polling — step {node}" instead of printing the
 * raw `repeat:tick`.
 */
export function readRunParkNode(
  detail: string | null | undefined,
): string | undefined {
  if (typeof detail !== 'string') return undefined;
  const match = /^(?:repeat|agent|room|in_doubt):(.+)$/.exec(detail);
  return match?.[1];
}

/**
 * What a run row says beside its starter: the failure sentence of a failed
 * run, the park of a waiting one, in words — never the raw park string.
 * Returns the i18n key (under `runs.`) and its values, or nothing when the
 * run has no reason to show (a queued, running, succeeded or stopped run).
 */
export function runReasonKey(run: {
  status: unknown;
  detail?: string | null | undefined;
  waitingFor?: unknown;
}):
  | { kind: 'failed'; detail: string }
  | { kind: 'waiting'; key: string; values: Record<string, string> }
  | undefined {
  const status = readRunStatus(run.status);
  if (status === 'failed') {
    return typeof run.detail === 'string' && run.detail !== ''
      ? { kind: 'failed', detail: run.detail }
      : undefined;
  }
  if (status === 'quarantined') {
    return { kind: 'waiting', key: 'runs.quarantine.reason', values: {} };
  }
  if (status !== 'waiting') return undefined;
  const waitingFor = readRunWaitingFor(run.waitingFor);
  if (waitingFor === undefined) return undefined;
  const node = readRunParkNode(run.detail);
  return {
    kind: 'waiting',
    key: `runs.waiting.${waitingFor}`,
    values: node === undefined ? {} : { node },
  };
}

/** What the overlay shows on one node. `running` is the node the stepper is ON
 * right now (a live run's cursor); `waiting` is the node a parked run waits on
 * a person at (an approval, a question, a write that may already have
 * happened); `interrupted` is the node a run was on when its server stopped,
 * before another one took it over; `pending` is a node the run has not
 * reached yet — distinct from the engine's `not_run`, which is a node the run
 * finished without reaching; `stopped` is the node a cancelled run was on when
 * it was stopped — reached, never finished. */
export type NodeRunStatus =
  | NodeStatus
  | 'pending'
  | 'running'
  | 'waiting'
  | 'interrupted'
  | 'stopped';

/**
 * The package's state for a node's status in a run — one icon and colour
 * vocabulary for the canvas, the step list and the badges. A node whose
 * server stopped (`interrupted`) is not being worked on, so it does not
 * spin: it waits to be picked up again, like a node not reached yet.
 */
export function flowNodeState(status: NodeRunStatus): FlowShownState {
  return FLOW_NODE_STATE_OF[status];
}

const FLOW_NODE_STATE_OF: Readonly<Record<NodeRunStatus, FlowShownState>> = {
  ok: 'succeeded',
  error: 'failed',
  skipped: 'skipped',
  not_run: 'not-run',
  stopped: 'stopped',
  running: 'running',
  waiting: 'waiting',
  pending: 'pending',
  interrupted: 'pending',
};

/** What the node a live run's cursor names reads as. */
export type CursorNodeStatus = Extract<
  NodeRunStatus,
  'running' | 'waiting' | 'interrupted'
>;

/** The waits a person ends: the run is not working on its node meanwhile. */
const PERSON_WAITS: ReadonlySet<string> = new Set<RunWaitingFor>([
  'approval',
  'ask',
  'in_doubt',
]);

/**
 * What the node a live run is on is doing: worked on (`running` — a step
 * under way, an agent turn, a poll, a wait for sandbox room), parked for a
 * person (`waiting`), or left by a server that stopped and not picked up yet
 * (`interrupted`). Nothing spins on a node nobody is running.
 */
export function cursorNodeStatus(
  run:
    | { status?: unknown; stalled?: unknown; waitingFor?: unknown }
    | null
    | undefined,
): CursorNodeStatus {
  if (!run) return 'running';
  const status = readRunStatus(run.status);
  if (status === 'quarantined') return 'interrupted';
  if (status === 'running' && run.stalled === true) return 'interrupted';
  if (
    status === 'waiting' &&
    typeof run.waitingFor === 'string' &&
    PERSON_WAITS.has(run.waitingFor)
  ) {
    return 'waiting';
  }
  return 'running';
}

export interface NodeRunView {
  status: NodeRunStatus;
  /** The node's declared type (`agent`, `task.update_status`, …) as the trace
   * recorded it — absent for a node seen only through a checkpoint that
   * predates type recording. Lets a reader tell WHAT a step was, not just how
   * it ended. */
  type?: string;
  /** Present once the node has produced a value. */
  output?: unknown;
  /** The node's resolved input, after template evaluation. */
  input?: unknown;
  error?: string;
  note?: string;
  ms?: number;
  /** Effects this node performed, in execution order. */
  effects: Effect[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTrace(value: unknown): NodeTrace[] {
  if (!Array.isArray(value)) return [];
  const out: NodeTrace[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const node = entry.node;
    const type = entry.type;
    if (typeof node !== 'string' || typeof type !== 'string') continue;
    const status =
      entry.status === 'ok' ||
      entry.status === 'skipped' ||
      entry.status === 'error' ||
      entry.status === 'not_run'
        ? entry.status
        : 'not_run';
    const trace: NodeTrace = { node, type, status };
    if (entry.input !== undefined) trace.input = entry.input;
    if (entry.output !== undefined) trace.output = entry.output;
    if (typeof entry.note === 'string') trace.note = entry.note;
    if (typeof entry.error === 'string') trace.error = entry.error;
    if (typeof entry.ms === 'number') trace.ms = entry.ms;
    out.push(trace);
  }
  return out;
}

/** The run's effects in execution order. */
export function readEffects(value: unknown): Effect[] {
  if (!Array.isArray(value)) return [];
  const out: Effect[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const node = entry.node;
    const connector = entry.connector;
    if (typeof node !== 'string' || typeof connector !== 'string') continue;
    out.push({ node, connector, input: entry.input });
  }
  return out;
}

/** The trace entries the stepper has written so far, read out of the durable
 * checkpoints — of a run that has not finished, or of a stopped one, which
 * keeps its checkpoints and never gets a trace. */
function traceFromCheckpoints(value: unknown): {
  trace: NodeTrace[];
  effects: Effect[];
} {
  const nodes = isRecord(value) && isRecord(value.nodes) ? value.nodes : {};
  const trace: NodeTrace[] = [];
  const effects: Effect[] = [];
  for (const checkpoint of Object.values(nodes)) {
    if (!isRecord(checkpoint)) continue;
    trace.push(...readTrace([checkpoint.trace]));
    effects.push(...readEffects(checkpoint.effects));
  }
  return { trace, effects };
}

/** The node the stepper's cursor names, whatever the run's status. */
function rawCursorNode(run: RunLike): string | null {
  const checkpoints = run.checkpoints;
  if (!isRecord(checkpoints)) return null;
  const cursor = checkpoints.cursor;
  if (!isRecord(cursor)) return null;
  return typeof cursor.node === 'string' && cursor.node !== ''
    ? cursor.node
    : null;
}

/**
 * The step a LIVE run is on, straight from the stepper's own cursor — the only
 * honest answer while a run is in flight. The per-node projection cannot supply
 * it: a live run is read from `checkpoints`, whose keys arrive in whatever order
 * the store serialises them (alphabetical in practice), so "the last one" is a
 * lie. A finished run has no cursor: its ordered `trace` ends at its last step,
 * and a stopped run's stale cursor is read by {@link projectRun} as the node
 * it was stopped on — never as "running now".
 */
export function readRunCursorNode(
  run: RunLike | null | undefined,
): string | null {
  if (!run || isRunFinished(readRunStatus(run.status))) return null;
  return rawCursorNode(run);
}

/**
 * The auto-retry attempt a LIVE run's parked agent turn is on (1-based), or
 * null when the run is held or finished, not parked on an agent turn, or still on
 * its original attempt. The counter lives only in the stepper's cursor, so
 * a terminal run always reads null — its attempt count survives in the
 * failure detail instead.
 */
export function readRunAgentRetry(
  run: RunLike | null | undefined,
): number | null {
  if (!run) return null;
  const status = readRunStatus(run.status);
  if (status === 'quarantined' || isRunFinished(status)) return null;
  const checkpoints = run.checkpoints;
  if (!isRecord(checkpoints)) return null;
  const cursor = checkpoints.cursor;
  if (!isRecord(cursor)) return null;
  const agent = cursor.agent;
  if (!isRecord(agent)) return null;
  return typeof agent.attempt === 'number' && agent.attempt >= 1
    ? agent.attempt
    : null;
}

/** One run as the canvas and the run detail read it. */
export interface RunProjection {
  /** Per-node view, keyed by node id. */
  byNode: Map<string, NodeRunView>;
  /** Every effect the run performed, in execution order. */
  effects: Effect[];
  /** The run's trace entries, in execution order. */
  trace: NodeTrace[];
}

interface RunLike {
  status?: unknown;
  trace?: unknown;
  effects?: unknown;
  checkpoints?: unknown;
}

/**
 * Read one run into its per-node projection. A finished run is read from its
 * `trace`/`effects`; a run without one — live, or stopped, which is finished
 * without ever getting a trace — from the checkpoints written so far, so the
 * overlay fills in node by node while the run is still going and keeps what
 * ran once it is stopped. The node a stopped run was on reads `stopped`.
 */
export function projectRun(run: RunLike | null | undefined): RunProjection {
  if (!run) return { byNode: new Map(), effects: [], trace: [] };
  const status = readRunStatus(run.status);
  const traced = readTrace(run.trace);
  const recorded = readEffects(run.effects);
  const fromCheckpoints =
    traced.length === 0
      ? traceFromCheckpoints(run.checkpoints)
      : { trace: [], effects: [] };
  const trace = traced.length > 0 ? traced : fromCheckpoints.trace;
  const effects = recorded.length > 0 ? recorded : fromCheckpoints.effects;

  const effectsByNode = new Map<string, Effect[]>();
  for (const effect of effects) {
    const bucket = effectsByNode.get(effect.node);
    if (bucket) bucket.push(effect);
    else effectsByNode.set(effect.node, [effect]);
  }

  // Keyed by node, in whatever order the source gave them: a FINISHED run's
  // `trace` is a real ordered array, but a live run's checkpoints arrive as a
  // record whose keys the store serialises alphabetically — so `byNode` order
  // is only meaningful for a finished run. "Where is the run now?" comes from
  // `readRunCursorNode`, never from this map's last key.
  const byNode = new Map<string, NodeRunView>();
  for (const entry of trace) {
    const view: NodeRunView = {
      status: entry.status,
      type: entry.type,
      effects: effectsByNode.get(entry.node) ?? [],
    };
    if (entry.input !== undefined) view.input = entry.input;
    if (entry.output !== undefined) view.output = entry.output;
    if (entry.error !== undefined) view.error = entry.error;
    if (entry.note !== undefined) view.note = entry.note;
    if (entry.ms !== undefined) view.ms = entry.ms;
    byNode.set(entry.node, view);
  }
  // A stop leaves the cursor where the stepper was: that node was reached
  // and never finished — neither "running now" nor "not reached yet". A node
  // the checkpoints already recorded keeps its recorded outcome.
  if (status === 'cancelled') {
    const stoppedOn = rawCursorNode(run);
    if (stoppedOn !== null && !byNode.has(stoppedOn)) {
      byNode.set(stoppedOn, {
        status: 'stopped',
        effects: effectsByNode.get(stoppedOn) ?? [],
      });
    }
  }
  return { byNode, effects, trace };
}

/**
 * The overlay status of every node on the canvas. A node the projection says
 * nothing about is `pending`: the run has not reached it, which is a different
 * fact from the engine's `not_run` (reached the end without running it).
 */
export function nodeStatusMap(
  projection: RunProjection,
  nodeIds: readonly string[],
  /** The node a live run is on — shown as what it is doing there rather than
   * "not reached", which is what it looks like from the checkpoints alone. */
  cursorNode?: string | null,
  /** What that node reads as ({@link cursorNodeStatus}). */
  cursorStatus: CursorNodeStatus = 'running',
): Map<string, NodeRunStatus> {
  return new Map(
    nodeIds.map((id) => {
      const recorded = projection.byNode.get(id)?.status;
      if (recorded !== undefined) return [id, recorded];
      return [id, id === cursorNode ? cursorStatus : 'pending'];
    }),
  );
}
