/**
 * Running a run again — with the same input (`again`), with an input a
 * person edited (`edited`), or from one of its steps (`from`) — and planning
 * what that does: which steps keep what the earlier run produced, which run
 * again, and what running them again sends out a second time.
 *
 * A step the earlier run finished is reused when it lies outside what the
 * chosen step feeds; the chosen step and everything it feeds run again. An
 * `elseOf` branch reads its partner, so it runs again whenever its partner
 * does, and a branch chosen to start from reads its partner's kept result —
 * the pair always decides the way it would have in one run.
 *
 * The new run may execute another version of the automation. Reuse is then
 * refused rather than bent when that version changed a reused step, has it
 * read a step that runs again, or made it depend on the chosen step: what
 * the earlier run kept would no longer be what that version computes.
 */

import type { ReplayKind } from '@tale/shared/automation-replay';
import { stableStringify } from '@tale/ui/data/stable-stringify';

import { refsOf, topoSort } from '../execute/controlflow';
import type { Automation, NodeDef } from '../types';

export type { ReplayKind };

/** Why a fork cannot be planned: the step to start from is missing from one
 * of the two versions (`REPLAY_NODE_UNKNOWN`), or the version the new run
 * executes changed what a reused step would compute
 * (`REPLAY_GRAPH_CHANGED`). */
export type ReplayRefusal = 'REPLAY_NODE_UNKNOWN' | 'REPLAY_GRAPH_CHANGED';

/** The earlier run's progress as the planner reads it: every step it
 * finished, ran or skipped, has an entry under its id. */
export interface ForkCheckpoints {
  readonly nodes: Readonly<Record<string, unknown>>;
}

export type ForkPlan =
  | { ok: true; reuse: string[]; rerun: string[] }
  | { ok: false; code: ReplayRefusal; nodes: string[] };

/** A step as one comparable text: equal for two definitions that hold the
 * same fields, whatever order they were written in. */
export function canonicalNode(n: NodeDef): string {
  return stableStringify(n);
}

/** Who reads whom in a document, both ways; references to steps the
 * document does not have are left out. */
interface Graph {
  ids: Set<string>;
  reads: Map<string, Set<string>>;
  readers: Map<string, Set<string>>;
}

function graphOf(doc: Automation): Graph {
  const ids = new Set(doc.nodes.map((n) => n.id));
  const reads = new Map<string, Set<string>>();
  const readers = new Map<string, Set<string>>();
  for (const id of ids) {
    reads.set(id, new Set());
    readers.set(id, new Set());
  }
  for (const n of doc.nodes) {
    for (const ref of refsOf(n).order) {
      if (ref === n.id || !ids.has(ref)) continue;
      reads.get(n.id)?.add(ref);
      readers.get(ref)?.add(n.id);
    }
  }
  return { ids, reads, readers };
}

/** Every step reached from `id` along `edges`, `id` itself left out. */
function closure(edges: Map<string, Set<string>>, id: string): Set<string> {
  const reached = new Set<string>();
  const pending = [...(edges.get(id) ?? [])];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next === id || reached.has(next)) continue;
    reached.add(next);
    pending.push(...(edges.get(next) ?? []));
  }
  return reached;
}

/**
 * The steps that read `id`, directly or through others: by data, by a
 * condition, or as its `elseOf` branch — every step whose outcome may change
 * when `id` runs again. Empty for a step the document does not have.
 */
export function downstream(doc: Automation, id: string): Set<string> {
  return closure(graphOf(doc).readers, id);
}

/** The document's steps in execution order; in document order should the
 * steps form a cycle, which validation refuses before any run. */
function orderOf(doc: Automation): string[] {
  return (topoSort(doc.nodes) ?? doc.nodes).map((n) => n.id);
}

/**
 * Plan a run of `target` that starts again at `from`, reusing what the run
 * of `source` finished (`checkpoints`) outside `from` and what it feeds.
 * `rerun` lists, in `target`'s execution order, every step of `target` that
 * is not reused — new steps included; `reuse` lists the reused ones in the
 * same order. An entry for a step `source` does not have is not that run's
 * progress, and is not reused.
 */
export function planFork(a: {
  source: Automation;
  target: Automation;
  from: string;
  checkpoints: ForkCheckpoints;
}): ForkPlan {
  const source = graphOf(a.source);
  const target = graphOf(a.target);
  if (!source.ids.has(a.from) || !target.ids.has(a.from)) {
    return { ok: false, code: 'REPLAY_NODE_UNKNOWN', nodes: [a.from] };
  }
  const down = closure(source.readers, a.from).add(a.from);
  const reuse = new Set(
    Object.keys(a.checkpoints.nodes).filter(
      (id) => source.ids.has(id) && !down.has(id),
    ),
  );
  const targetDown = closure(target.readers, a.from).add(a.from);
  const sourceNodes = new Map(a.source.nodes.map((n) => [n.id, n]));
  const targetNodes = new Map(a.target.nodes.map((n) => [n.id, n]));
  const changed = orderOf(a.source).filter((id) => {
    if (!reuse.has(id)) return false;
    const was = sourceNodes.get(id);
    const is = targetNodes.get(id);
    if (was === undefined || is === undefined) return true;
    if (canonicalNode(was) !== canonicalNode(is)) return true;
    if (targetDown.has(id)) return true;
    return [...closure(target.reads, id)].some((up) => !reuse.has(up));
  });
  if (changed.length > 0) {
    return { ok: false, code: 'REPLAY_GRAPH_CHANGED', nodes: changed };
  }
  const order = orderOf(a.target);
  return {
    ok: true,
    reuse: order.filter((id) => reuse.has(id)),
    rerun: order.filter((id) => !reuse.has(id)),
  };
}

/** Which version a replay runs: the source's (`same`), the deployed one,
 * the latest saved one, or a numbered one. */
export type ReplayVersionChoice = 'same' | 'deployed' | 'latest' | number;

/** Why a replay cannot start as asked. */
export type ReplayRefusalCode =
  | ReplayRefusal
  | 'REPLAY_RUN_NOT_FINISHED'
  | 'REPLAY_MODE_MISMATCH'
  | 'REPLAY_PROGRESS_UNREADABLE'
  | 'REPLAY_INPUT_UNAVAILABLE';

/** What running a step again does outside Tale. */
export type ReplayEffect = 'write' | 'read' | 'llm' | 'agent' | 'none';

/** What a replay will do, before it starts: what the confirmation shows. */
export interface ReplayPlan {
  kind: ReplayKind;
  sourceRunId: string;
  version: {
    source: number;
    target: number;
    resolved: 'same' | 'deployed' | 'latest' | 'number';
  };
  mode: 'mock' | 'live';
  /** The version it runs is the deployed one, so it may run live. */
  deployed: boolean;
  /** It may run live: the version is deployed and the caller may start a
   * live run. */
  liveAllowed: boolean;
  /** `from`: the steps whose results it takes from the source run. */
  reuse: Array<{ nodeId: string; status: 'ok' | 'skipped'; reason?: string }>;
  /** The steps it runs, in the order they run. */
  rerun: Array<{
    nodeId: string;
    type: string;
    effect: ReplayEffect;
    connector?: string;
    /** How many items it ran for in the source run, for a step that runs
     * per item. */
    items?: number;
  }>;
  /** Writes it sends out again when it runs live: one per writing step,
   * one per item for a step that ran per item. */
  writesAgain: number;
  /** Model and agent calls it makes again. */
  spendAgain: { llm: number; agent: number };
  refusal?: { code: ReplayRefusalCode; message: string; nodes?: string[] };
}

/** How real a mode is: a fork may not run more real than its source, or
 * outputs a mock run made up would drive real writes. */
const MODE_RANK: Readonly<Record<'mock' | 'live', number>> = {
  mock: 0,
  live: 1,
};

/** Whether a replay of a `source` run may run in `mode`: any mode the
 * caller may start, except a fork more real than its source. */
export function replayModeAllowed(
  kind: ReplayKind,
  source: 'mock' | 'live',
  mode: 'mock' | 'live',
): boolean {
  return kind !== 'from' || MODE_RANK[mode] <= MODE_RANK[source];
}

const TERMINAL = new Set(['success', 'failed', 'cancelled']);

/** A step's progress as a fork reads it: finished, or skipped and why. */
interface ForkEntry {
  status?: unknown;
  reason?: unknown;
}

/**
 * Plan a replay of a run: what it reuses, what it runs again and what that
 * sends out a second time, or why it cannot start as asked. Pure: the host
 * reads the source run, both versions' documents and the source's progress;
 * `checkpoints` is null when that progress cannot be read.
 */
export function planReplay(a: {
  kind: ReplayKind;
  from?: string;
  mode: 'mock' | 'live';
  canStartLive: boolean;
  source: {
    id: string;
    status: string;
    mode: 'mock' | 'live';
    version: number;
    document: Automation;
    checkpoints: { nodes: Readonly<Record<string, ForkEntry>> } | null;
    /** The run's stored input can be run again. */
    inputKnown: boolean;
    /** How many items each step ran for, from its record. */
    items?: ReadonlyMap<string, number>;
  };
  target: {
    version: number;
    resolved: ReplayPlan['version']['resolved'];
    document: Automation;
    deployed: boolean;
  };
  /** What a connector action does, from the catalog. */
  effectOf: (nodeType: string) => 'read' | 'write' | 'unknown';
}): ReplayPlan {
  const plan: ReplayPlan = {
    kind: a.kind,
    sourceRunId: a.source.id,
    version: {
      source: a.source.version,
      target: a.target.version,
      resolved: a.target.resolved,
    },
    mode: a.mode,
    deployed: a.target.deployed,
    liveAllowed: a.target.deployed && a.canStartLive,
    reuse: [],
    rerun: [],
    writesAgain: 0,
    spendAgain: { llm: 0, agent: 0 },
  };
  const refuse = (
    code: ReplayRefusalCode,
    message: string,
    nodes?: string[],
  ): ReplayPlan => ({
    ...plan,
    refusal: { code, message, ...(nodes !== undefined && { nodes }) },
  });
  if (a.kind !== 'edited' && !a.source.inputKnown) {
    return refuse(
      'REPLAY_INPUT_UNAVAILABLE',
      'this run kept no input to run again — run it again with an input',
    );
  }
  let reuse: string[] = [];
  if (a.kind === 'from') {
    const from = a.from ?? '';
    if (!TERMINAL.has(a.source.status)) {
      return refuse(
        'REPLAY_RUN_NOT_FINISHED',
        'a run can be run again from a step once it has finished',
      );
    }
    if (a.source.checkpoints === null) {
      return refuse(
        'REPLAY_PROGRESS_UNREADABLE',
        'what this run finished cannot be read, so no step of it can be reused',
      );
    }
    if (!replayModeAllowed(a.kind, a.source.mode, a.mode)) {
      return refuse(
        'REPLAY_MODE_MISMATCH',
        'a mock run can only be run again from a step as a mock run: its results were made up',
      );
    }
    const fork = planFork({
      source: a.source.document,
      target: a.target.document,
      from,
      checkpoints: a.source.checkpoints,
    });
    if (!fork.ok) {
      return refuse(
        fork.code,
        fork.code === 'REPLAY_NODE_UNKNOWN'
          ? `there is no step "${from}" to run again from in both versions`
          : 'the version to run changed what the reused steps would compute',
        fork.nodes,
      );
    }
    reuse = fork.reuse;
  }
  const reused = new Set(reuse);
  plan.reuse = reuse.map((nodeId) => {
    const entry = a.source.checkpoints?.nodes[nodeId];
    const kept: ReplayPlan['reuse'][number] = {
      nodeId,
      status: entry?.status === 'skipped' ? 'skipped' : 'ok',
    };
    if (kept.status === 'skipped' && typeof entry?.reason === 'string') {
      kept.reason = entry.reason;
    }
    return kept;
  });
  for (const id of orderOf(a.target.document)) {
    if (reused.has(id)) continue;
    const node = a.target.document.nodes.find((n) => n.id === id);
    if (node === undefined) continue;
    const effect = replayEffectOf(node.type, a.effectOf);
    const items = a.source.items?.get(id);
    const times = items ?? 1;
    const separator = node.type.indexOf('.');
    plan.rerun.push({
      nodeId: id,
      type: node.type,
      effect,
      ...(separator > 0 && { connector: node.type.slice(0, separator) }),
      ...(items !== undefined && { items }),
    });
    if (effect === 'write' && a.mode === 'live') plan.writesAgain += times;
    if (effect === 'llm') plan.spendAgain.llm += times;
    if (effect === 'agent') plan.spendAgain.agent += times;
  }
  return plan;
}

/** What running a step of `type` does outside Tale. */
function replayEffectOf(
  type: string,
  effectOf: (nodeType: string) => 'read' | 'write' | 'unknown',
): ReplayEffect {
  if (type === 'llm') return 'llm';
  if (type === 'agent') return 'agent';
  if (!type.includes('.')) return 'none';
  const effect = effectOf(type);
  return effect === 'unknown' ? 'none' : effect;
}
