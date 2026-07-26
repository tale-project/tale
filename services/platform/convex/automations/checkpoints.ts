/**
 * The durable state of a run, and the pure functions that read it.
 *
 * A run's `checkpoints` field is the whole resume protocol: what each finished
 * node produced, plus a cursor into the node that is only partly done. It is
 * written by the stepper's mutations and read back on re-entry, so it has to be
 * plain JSON and it has to be enough — on resume, the stepper reconstructs the
 * execution scope from this alone and never re-runs a node that already has an
 * entry here. That is what keeps an interrupted run from repeating a send.
 *
 * The skip REASON is recorded, not just the fact of skipping, because the
 * executor's branching rules distinguish them: `elseOf: X` runs exactly when X
 * was skipped by its own `when`, and NOT when X was skipped because something
 * upstream of it was. Collapsing the two would silently flip an else-branch on
 * resume.
 *
 * Kept free of Convex imports so it can be exercised directly.
 */

import type { Effect, NodeTrace } from '../../lib/engine/core/types';

/** Why a node produced no output. */
export type SkipReason =
  /** Its own `when` was falsy — an `elseOf` partner therefore runs. */
  | 'when'
  /** A node it reads from was skipped. */
  | 'upstream'
  /** It is an `elseOf` branch whose partner ran. */
  | 'else'
  /** It failed under `onError: continue`. */
  | 'error';

export interface NodeCheckpoint {
  status: 'ok' | 'skipped';
  reason?: SkipReason;
  output: unknown;
  /** The node's trace entry, recorded when it happened — the finished run's
   * trace is assembled from these, in execution order. */
  trace: NodeTrace;
  /** Effects this node performed, in order. */
  effects: Effect[];
}

/** A file an agent turn produced, as harvested into blob storage. */
export interface AgentTurnFile {
  name: string;
  storageId: string;
  size: number;
  contentType: string;
}

/** The settled result of one workflow agent turn, written into the cursor by
 * the agent host's finalize and consumed by the stepper's next entry. */
export interface AgentTurnResult {
  errored: boolean;
  reason?: string;
  text: string;
  files: AgentTurnFile[];
  status?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costEstimateUsd?: number;
  };
}

/**
 * The in-flight state of an `agent` node: the exec the host kicked, where it
 * runs, when it must be cut, and — once the drive chain settles it — the
 * result the next stepper entry consumes. `input` is the resolved request,
 * kept here so the settle turn records the same trace/effect the kick turn
 * computed instead of re-evaluating templates.
 */
export interface AgentCursor {
  execId: string;
  sessionId: string;
  deadlineAt: number;
  providerSlug: string;
  gatewayModel: string;
  harness: string;
  input: Record<string, unknown>;
  result?: AgentTurnResult;
}

/**
 * Where the stepper is inside a node that is not finished yet: which `forEach`
 * item it is on, how many `repeatUntil` passes that item has had, and the
 * per-item outputs collected so far. Its presence is what lets a poll-style
 * `repeatUntil` suspend the run between passes instead of holding an action
 * open, and what lets a long `forEach` resume mid-array without re-sending the
 * items it already sent. An `agent` node parks its in-flight turn under
 * `agent` the same way.
 */
export interface NodeCursor {
  node: string;
  index: number;
  passes: number;
  outs: unknown[];
  agent?: AgentCursor;
}

export interface RunCheckpoints {
  nodes: Record<string, NodeCheckpoint>;
  cursor?: NodeCursor;
  /**
   * Node executions performed so far, `forEach` items and `repeatUntil` passes
   * included. Durable because the executor's runaway guard has to survive
   * re-entry: a counter that reset every turn would bound nothing.
   */
  executions: number;
}

export const EMPTY_CHECKPOINTS: RunCheckpoints = { nodes: {}, executions: 0 };

/** Narrow a stored `v.any()` checkpoints blob back to its type. Anything
 * unrecognizable is treated as "nothing done yet", which is safe: the run
 * restarts rather than resuming from state it cannot read. */
export function readCheckpoints(value: unknown): RunCheckpoints {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ...EMPTY_CHECKPOINTS, nodes: {} };
  }
  const record: Record<string, unknown> = { ...value };
  const nodes =
    record.nodes !== null &&
    typeof record.nodes === 'object' &&
    !Array.isArray(record.nodes)
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
        (record.nodes as Record<string, NodeCheckpoint>)
      : {};
  const cursor =
    record.cursor !== null &&
    typeof record.cursor === 'object' &&
    !Array.isArray(record.cursor)
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
        (record.cursor as NodeCursor)
      : undefined;
  return {
    nodes,
    ...(cursor !== undefined && { cursor }),
    executions: typeof record.executions === 'number' ? record.executions : 0,
  };
}

/** `nodes.<id>.output` for every finished node — the executor's scope. */
export function outputsFrom(
  checkpoints: RunCheckpoints,
): Record<string, { output: unknown }> {
  const outputs: Record<string, { output: unknown }> = {};
  for (const [id, entry] of Object.entries(checkpoints.nodes)) {
    outputs[id] = { output: entry.output };
  }
  return outputs;
}

/** Nodes whose skipping propagates to everything reading them. */
export function skippedFrom(checkpoints: RunCheckpoints): Set<string> {
  const skipped = new Set<string>();
  for (const [id, entry] of Object.entries(checkpoints.nodes)) {
    if (entry.status === 'skipped') skipped.add(id);
  }
  return skipped;
}

/** Nodes skipped by their OWN `when` — the set `elseOf` branches consult. */
export function whenSkippedFrom(checkpoints: RunCheckpoints): Set<string> {
  const whenSkipped = new Set<string>();
  for (const [id, entry] of Object.entries(checkpoints.nodes)) {
    if (entry.status === 'skipped' && entry.reason === 'when') {
      whenSkipped.add(id);
    }
  }
  return whenSkipped;
}

/** The run's trace, in the order the nodes were reached. */
export function traceFrom(
  checkpoints: RunCheckpoints,
  order: readonly string[],
): NodeTrace[] {
  const trace: NodeTrace[] = [];
  for (const id of order) {
    const entry = checkpoints.nodes[id];
    if (entry) trace.push(entry.trace);
  }
  return trace;
}

/** The run's effects, in the order the nodes performed them. */
export function effectsFrom(
  checkpoints: RunCheckpoints,
  order: readonly string[],
): Effect[] {
  const effects: Effect[] = [];
  for (const id of order) {
    const entry = checkpoints.nodes[id];
    if (entry) effects.push(...entry.effects);
  }
  return effects;
}
