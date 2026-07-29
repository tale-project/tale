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

import { refsInSource, templateExprsIn } from '../template';
import type { NodeDef } from '../types';

export interface NodeRefs {
  /** All references — these establish execution order. */
  order: Set<string>;
  /** References whose skipping propagates (input/prompt/system/code/forEach). */
  data: Set<string>;
}

export function refsOf(n: NodeDef): NodeRefs {
  const data = new Set<string>();
  const order = new Set<string>();
  const add = (src: string, controlOnly: boolean) => {
    for (const r of refsInSource(src)) {
      order.add(r);
      if (!controlOnly) data.add(r);
    }
  };
  for (const e of templateExprsIn(n.input)) add(e, false);
  for (const f of ['prompt', 'system'] as const) {
    const v = n[f];
    if (typeof v === 'string') {
      for (const e of templateExprsIn(v)) add(e, false);
    }
  }
  if (typeof n.code === 'string') add(n.code, false);
  if (typeof n.forEach === 'string') {
    for (const e of templateExprsIn(n.forEach)) add(e, false);
  }
  for (const f of ['when', 'repeatUntil'] as const) {
    const v = n[f];
    if (typeof v === 'string') {
      const exprs = templateExprsIn(v);
      if (exprs.length > 0) for (const e of exprs) add(e, true);
      else add(v, true);
    }
  }
  if (typeof n.elseOf === 'string') order.add(n.elseOf);
  return { order, data };
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
