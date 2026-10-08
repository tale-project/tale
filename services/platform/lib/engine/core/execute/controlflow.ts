/**
 * Declarative control flow: reference extraction for scheduling, stable
 * topological ordering, and the skip rules.
 *
 * Skip semantics authors rely on:
 *  - `when` falsy → node skipped, output null;
 *  - a node whose DATA references point at a skipped node is skipped too
 *    (control references — when/repeatUntil — do not propagate);
 *  - `elseOf: X` runs exactly when X was when-skipped, and is skipped when
 *    X ran.
 */

import { sourcesOf } from '../syntax/sources';
import type { NodeDef } from '../types';

export interface NodeRefs {
  /** All references — these establish execution order. */
  order: Set<string>;
  /** References whose skipping propagates (input/prompt/system/files/code/
   * forEach). */
  data: Set<string>;
}

/**
 * The nodes `n` reads, from the parsed sources (`sourcesOf`): a reference in
 * a comment, a string or through a shadowing local is no reference, and an
 * agent's `files` mapping is data like its prompt. A dynamic read
 * (`nodes[k]`) names no node, so it adds no edge.
 */
export function refsOf(n: NodeDef): NodeRefs {
  const data = new Set<string>();
  const order = new Set<string>();
  for (const source of sourcesOf(n)) {
    for (const unit of source.units) {
      for (const site of unit.refs) {
        if (site.root !== 'nodes' || site.nodeId === undefined) continue;
        order.add(site.nodeId);
        if (source.data) data.add(site.nodeId);
      }
    }
  }
  if (typeof n.elseOf === 'string') order.add(n.elseOf);
  return { order, data };
}

/** Passes a `repeatUntil` node runs at most: `maxRepeats` (5 when unset),
 * never more than 20 — what the executor loops, and what the analysis says a
 * condition that never holds costs. */
export function maxRepeatsOf(n: Pick<NodeDef, 'maxRepeats'>): number {
  return Math.min(n.maxRepeats ?? 5, 20);
}

/** Stable topological order (document order among ready nodes); null on a
 * cycle — validation reports the cycle with its path. */
export function topoSort(nodes: NodeDef[]): NodeDef[] | null {
  const idSet = new Set(nodes.map((n) => n.id));
  const deps = new Map(
    nodes.map((n) => [
      n.id,
      [...refsOf(n).order].filter((r) => idSet.has(r) && r !== n.id),
    ]),
  );
  const done = new Set<string>();
  const sorted: NodeDef[] = [];
  while (sorted.length < nodes.length) {
    const next = nodes.find(
      (n) =>
        !done.has(n.id) && (deps.get(n.id) ?? []).every((d) => done.has(d)),
    );
    if (!next) return null;
    done.add(next.id);
    sorted.push(next);
  }
  return sorted;
}
