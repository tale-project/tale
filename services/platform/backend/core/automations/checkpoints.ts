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

import type { Effect, NodeTrace } from '../../../lib/engine/core/types';

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
  /** Producer-side classification of an errored settle (a
   * `WorkflowAgentFailureCode`), read by the stepper's auto-retry gate.
   * Absent on results settled before the field existed — that reads as
   * retryable by design. */
  failureCode?: string;
  /** HTTP status of a turn-terminating API error the harness reported
   * (429, 401, …), carried for display — never branched on for retry. */
  apiErrorStatus?: number;
  /** The harness's conversation handle of an errored turn, when it had
   * announced one — the auto-retry resumes that conversation over the
   * preserved workspace instead of starting the node's reasoning again. */
  agentSessionId?: string;
  /** The answered question a delivery refused before it launched was to
   * bring to the conversation `agentSessionId` names (no sandbox room for
   * the answered-ask resume): the re-kick resumes that conversation with
   * the answer. */
  undeliveredAskId?: string;
  /** No retry can start before this, epoch ms: the start met a
   * subscription broker whose every account was cooling down after a rate
   * limit, and this is when the first one is back — or found no sandbox
   * room, and this is when the refusal's retry hint has passed. */
  retryAtMs?: number;
  /** The retry hint of a start refused for want of sandbox room, ms: the
   * delay of the waiting node's next start grows from it
   * (`sandboxRoomRetryAtMs`). */
  retryAfterMs?: number;
  /** The refusal named the start's place in the spawner's first-come line
   * for host room: the next start comes back at the hint itself. */
  roomQueued?: boolean;
  text: string;
  files: AgentTurnFile[];
  /** Outputs the harvest could not bring back (over a cap, unreadable,
   * storage rejection) — carried so the node output names every dropped
   * deliverable instead of silently omitting it. */
  harvestSkipped?: Array<{ path: string; reason: string }>;
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
  /** The exec's model string: the gateway ref on the gateway lane, the
   * vendor-native catalog id on the subscription lane. */
  gatewayModel: string;
  harness: string;
  input: Record<string, unknown>;
  /** How many auto-retries preceded this attempt (0 = the original kick).
   * The counter lives here — not on the run row — so it dies with the node
   * execution and `finishRun`'s cursor drop. */
  attempt?: number;
  /** Stamped by `stampAgentTurnLaunch` once the start action's mint
   * succeeds. Absent ⇒ the attempt never actually ran; the retry gate then
   * counts ZERO executed time, never a long run. */
  launchedAt?: number;
  /** sha256 of the subscription-broker token this attempt was minted on
   * (absent on the gateway lane), so a retry can rotate away from it. */
  brokerTokenHash?: string;
  /** Broker-token hashes burned by prior failed attempts of this node
   * execution, carried so the re-kick's mint can exclude them (softly — an
   * exhausted pool falls back to every account). A free credential rotation
   * adds none: its account holds a fresh token. */
  burnedBrokerTokenHashes?: string[];
  /** Credential rotations in a row that preceded this attempt — the broker
   * refreshing the account under a turn (`credential_rotated`). The first
   * `CREDENTIAL_ROTATION_FREE_RETRIES` resume for free; absent = none. */
  credentialRotations?: number;
  /** The conversation this attempt resumed — the failed attempt's harness
   * session handle — so the record says the retry continued, not restarted. */
  resumedFrom?: string;
  /** Why the conversation it resumed was cut, carried so a retry of a start
   * that never launched resumes it with the same words. */
  resumeReason?: string;
  /** The answered question this attempt delivers to the conversation it
   * resumed (`resumedFrom`), carried for the same retry: a delivery that
   * never launched has not given the conversation its answer yet. */
  resumeAskId?: string;
  /** This attempt retries one that ended on a 429 — the rate limit that
   * cooled its broker pool — so a start of it refused while the pool cools
   * down spends no attempt (`planWorkflowAgentRetry`). */
  retriedRateLimit?: boolean;
  /** When this node began waiting for sandbox room: the first start of a
   * streak refused for want of it (`sandbox_capacity`). Re-kicks while it
   * waits spend no execution of the run's guard; the wait itself ends after
   * `SANDBOX_ROOM_MAX_WAIT_MS`, or with a start that launches — a stamp
   * older than `launchedAt` belongs to a wait that is over
   * (`planWorkflowAgentRetry`). */
  waitingForRoomSince?: number;
  /** The refusals in a row of that wait: the next start's delay grows with
   * them (`sandboxRoomRetryAtMs`). */
  roomRefusals?: number;
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
  /**
   * The version of every automation a `subautomation` node walks, fixed the
   * first time the node runs: keyed by the chain of node ids without items
   * (`batch`, `batch/inner`). A resumed node walks these versions even when a
   * newer one was deployed in between, so one run never mixes two versions of
   * the same child. Absent on a node that walks no subautomation.
   */
  pins?: Record<string, number>;
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
