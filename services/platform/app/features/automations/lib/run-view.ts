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
 * auditable part of a run: it says what was done, to which integration, with
 * what input. Summarising it away would defeat the point, so the list shows
 * every one, in the order it happened.
 */

import type { Effect, NodeStatus, NodeTrace } from '@/lib/engine/core/types';

/** How a run ended, or where it is. Mirrors the store's `status` union. */
export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'success'
  | 'failed'
  | 'cancelled';

const RUN_STATUSES: ReadonlySet<string> = new Set<RunStatus>([
  'queued',
  'running',
  'waiting',
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

/** What the overlay shows on one node. `running` is the node the stepper is ON
 * right now (a live run's cursor); `pending` is a node the run has not reached
 * yet — distinct from the engine's `not_run`, which is a node the run finished
 * without reaching. */
export type NodeRunStatus = NodeStatus | 'pending' | 'running';

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
    const integration = entry.integration;
    if (typeof node !== 'string' || typeof integration !== 'string') continue;
    out.push({ node, integration, input: entry.input });
  }
  return out;
}

/** The trace entries the stepper has written so far, read out of the durable
 * checkpoints of a run that has not finished. */
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

/**
 * The step a LIVE run is on, straight from the stepper's own cursor — the only
 * honest answer while a run is in flight. The per-node projection cannot supply
 * it: a live run is read from `checkpoints`, whose keys arrive in whatever order
 * the store serialises them (alphabetical in practice), so "the last one" is a
 * lie. A finished run has no cursor; its ordered `trace` ends at its last step.
 */
export function readRunCursorNode(
  run: RunLike | null | undefined,
): string | null {
  if (!run) return null;
  const checkpoints = run.checkpoints;
  if (!isRecord(checkpoints)) return null;
  const cursor = checkpoints.cursor;
  if (!isRecord(cursor)) return null;
  return typeof cursor.node === 'string' && cursor.node !== ''
    ? cursor.node
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
 * `trace`/`effects`; a live one from the checkpoints written so far, so the
 * overlay fills in node by node while the run is still going.
 */
export function projectRun(run: RunLike | null | undefined): RunProjection {
  if (!run) return { byNode: new Map(), effects: [], trace: [] };
  const finished = isRunFinished(readRunStatus(run.status));
  const traced = readTrace(run.trace);
  const recorded = readEffects(run.effects);
  const fromCheckpoints =
    traced.length === 0 && !finished
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
  /** The node a live run is parked on — shown as `running` rather than
   * "not reached", which is what it looks like from the checkpoints alone. */
  cursorNode?: string | null,
): Map<string, NodeRunStatus> {
  return new Map(
    nodeIds.map((id) => {
      const recorded = projection.byNode.get(id)?.status;
      if (recorded !== undefined) return [id, recorded];
      return [id, id === cursorNode ? 'running' : 'pending'];
    }),
  );
}
