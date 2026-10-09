/**
 * Planning a run that starts again from one step: which steps keep what an
 * earlier run produced, and which run again.
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

import { stableStringify } from '@tale/ui/data/stable-stringify';

import { refsOf, topoSort } from '../execute/controlflow';
import type { Automation, NodeDef } from '../types';

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
