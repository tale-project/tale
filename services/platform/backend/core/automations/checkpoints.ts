/**
 * The pure functions that read a run's durable state: its progress, whose
 * shape is the walk's (`lib/engine/core/walk/progress.ts`).
 *
 * Kept free of Convex imports so it can be exercised directly.
 */

import type { Effect, NodeTrace } from '../../../lib/engine/core/types';
import type {
  NodeCheckpoint,
  NodeCursor,
  RunCheckpoints,
} from '../../../lib/engine/core/walk/progress';

export type {
  AgentCursor,
  AgentTurnFile,
  AgentTurnResult,
  NodeCheckpoint,
  NodeCursor,
  RunCheckpoints,
} from '../../../lib/engine/core/walk/progress';

const EMPTY_CHECKPOINTS: RunCheckpoints = { nodes: {}, executions: 0 };

/** Narrow a stored checkpoints blob back to its type, leniently: anything
 * unrecognizable reads as "nothing done yet". For readers that only DISPLAY a
 * run's progress — the stepper resumes through {@link parseRunCheckpoints},
 * which refuses what it cannot read instead of starting the run over. */
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Why a stored node entry cannot be resumed from, or null when it can. */
function unreadableNode(id: string, entry: unknown): string | null {
  if (!isPlainObject(entry)) return `node "${id}" is not an object`;
  if (entry.status !== 'ok' && entry.status !== 'skipped') {
    return `node "${id}" has no ok or skipped status`;
  }
  if (!isPlainObject(entry.trace)) return `node "${id}" has no trace`;
  if (!Array.isArray(entry.effects)) return `node "${id}" has no effects list`;
  return null;
}

/** Why a stored cursor cannot be resumed from, or null when it can. */
function unreadableCursor(cursor: unknown): string | null {
  if (!isPlainObject(cursor)) return 'the cursor is not an object';
  if (typeof cursor.node !== 'string') return 'the cursor names no node';
  if (!isCount(cursor.index) || !isCount(cursor.passes)) {
    return 'the cursor has no item index or pass count';
  }
  if (!Array.isArray(cursor.outs)) return 'the cursor has no outputs list';
  if (cursor.agent !== undefined) {
    if (
      !isPlainObject(cursor.agent) ||
      typeof cursor.agent.execId !== 'string' ||
      typeof cursor.agent.sessionId !== 'string'
    ) {
      return "the cursor's agent turn names no exec or session";
    }
  }
  if (cursor.pins !== undefined) {
    if (
      !isPlainObject(cursor.pins) ||
      !Object.values(cursor.pins).every(
        (version) => typeof version === 'number' && Number.isInteger(version),
      )
    ) {
      return "the cursor's subautomation versions are not numbers";
    }
  }
  if (cursor.failed !== undefined) {
    if (!Array.isArray(cursor.failed) || !cursor.failed.every(isCount)) {
      return "the cursor's failed items are not item indexes";
    }
  }
  return null;
}

/**
 * Read a run's stored progress for the stepper, strictly. A run resumes only
 * from progress this engine can read: progress it cannot read is refused
 * with the reason, and the run fails instead of starting over — starting over
 * would run again every step it had already finished, writes included.
 *
 * A run nothing was ever recorded for (no value, or an empty object) reads as
 * nothing done. Keys this engine does not know are kept out of the way, not
 * refused: they are what a later release adds alongside the ones read here.
 */
export function parseRunCheckpoints(
  value: unknown,
): { ok: true; checkpoints: RunCheckpoints } | { ok: false; reason: string } {
  if (value === null || value === undefined) {
    return { ok: true, checkpoints: { nodes: {}, executions: 0 } };
  }
  if (!isPlainObject(value)) {
    return { ok: false, reason: 'the saved progress is not an object' };
  }
  if (Object.keys(value).length === 0) {
    return { ok: true, checkpoints: { nodes: {}, executions: 0 } };
  }
  if (!isPlainObject(value.nodes)) {
    return { ok: false, reason: 'the saved progress lists no steps' };
  }
  for (const [id, entry] of Object.entries(value.nodes)) {
    const reason = unreadableNode(id, entry);
    if (reason !== null) return { ok: false, reason };
  }
  if (value.cursor !== undefined && value.cursor !== null) {
    const reason = unreadableCursor(value.cursor);
    if (reason !== null) return { ok: false, reason };
  }
  if (value.executions !== undefined && !isCount(value.executions)) {
    return { ok: false, reason: 'the execution count is not a number' };
  }
  return {
    ok: true,
    checkpoints: {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every entry was checked above
      nodes: value.nodes as Record<string, NodeCheckpoint>,
      ...(value.cursor !== undefined &&
        value.cursor !== null && {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked above
          cursor: value.cursor as NodeCursor,
        }),
      executions: isCount(value.executions) ? value.executions : 0,
    },
  };
}

/** The agent turn a cursor parks, when it parks one: its node and exec. */
function parkedAgentTurn(
  cursor: unknown,
): { node: unknown; agent: Record<string, unknown> } | null {
  if (!isPlainObject(cursor) || !isPlainObject(cursor.agent)) return null;
  if (typeof cursor.agent.execId !== 'string') return null;
  return { node: cursor.node, agent: cursor.agent };
}

/** Whether a park writes an agent node's cursor. */
export function parksAgentTurn(cursor: unknown): boolean {
  return parkedAgentTurn(cursor) !== null;
}

/** Whether the cursor a park wrote carries its agent turn's settled result:
 * the next walker has something to consume, so nothing need wait — unless
 * the stepper holds the turn's re-kick (`rekickHeldSince`): that park is the
 * wait, and its poll comes back when the hold ends. */
export function parkedAgentSettled(cursor: unknown): boolean {
  const agent = parkedAgentTurn(cursor)?.agent;
  return agent?.result !== undefined && agent.rekickHeldSince === undefined;
}

/**
 * The cursor an agent node's park writes, given the one stored now. The
 * walker parks with the cursor it loaded, and two writers may have moved
 * the stored one on while it was on its way: the turn's settle (the result)
 * and a person's answer to the turn's question (a new exec, or a later
 * deadline while the question waits). Each queued a step that found the run
 * held by this walker and did nothing, so what they wrote is kept:
 *
 * - the stored cursor whole, when the answer moved the turn off the exec this
 *   walker loaded (`retargetedFrom`);
 * - the loaded cursor with the stored result and the later deadline, when
 *   both name the same exec;
 * - the loaded cursor otherwise — a new turn this walker kicked, or a cursor
 *   of another node.
 */
export function mergeParkedAgentCursor(
  stored: unknown,
  incoming: unknown,
): unknown {
  const before = parkedAgentTurn(stored);
  const next = parkedAgentTurn(incoming);
  if (before === null || next === null || before.node !== next.node) {
    return incoming;
  }
  if (before.agent.retargetedFrom === next.agent.execId) return stored;
  if (before.agent.execId !== next.agent.execId) return incoming;
  const storedDeadline = before.agent.deadlineAt;
  const incomingDeadline = next.agent.deadlineAt;
  const agent = {
    ...next.agent,
    ...(next.agent.result === undefined &&
      before.agent.result !== undefined && { result: before.agent.result }),
    ...(typeof storedDeadline === 'number' &&
      (typeof incomingDeadline !== 'number' ||
        storedDeadline > incomingDeadline) && { deadlineAt: storedDeadline }),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `parkedAgentTurn` read it as a plain object
  return { ...(incoming as Record<string, unknown>), agent };
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

/** The run's trace, in the order the nodes were reached. A step a replay
 * took from the run it replays says so in its note. */
export function traceFrom(
  checkpoints: RunCheckpoints,
  order: readonly string[],
): NodeTrace[] {
  const trace: NodeTrace[] = [];
  for (const id of order) {
    const entry = checkpoints.nodes[id];
    if (!entry) continue;
    trace.push(
      entry.reused === undefined
        ? entry.trace
        : { ...entry.trace, note: `reused from run ${entry.reused.runId}` },
    );
  }
  return trace;
}

/** The run's effects, in the order the nodes performed them: what THIS run
 * did — a step a replay took from the run it replays did nothing here. */
export function effectsFrom(
  checkpoints: RunCheckpoints,
  order: readonly string[],
): Effect[] {
  const effects: Effect[] = [];
  for (const id of order) {
    const entry = checkpoints.nodes[id];
    if (entry && entry.reused === undefined) effects.push(...entry.effects);
  }
  return effects;
}
