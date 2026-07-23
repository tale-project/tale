/**
 * Derived scheduling: reference extraction and topological ordering.
 *
 * Edges are never declared — a node depends on every node it references.
 * References split into two classes with different skip behavior:
 *  - DATA references (in `input`, `prompt`, `system`, `code`, `forEach`)
 *    consume another node's output, so skipping propagates through them;
 *  - CONTROL references (in `when`, `repeatUntil`, plus the `elseOf`
 *    target) only order execution — a condition may legitimately read a
 *    skipped node's null output to decide what to do about it.
 */

import { refsInSource, templateExprsIn } from '../template';
import type { NodeDef } from '../types';

export interface NodeRefs {
  /** Every referenced node id — these establish execution order. */
  order: Set<string>;
  /** References whose skipping propagates to this node. */
  data: Set<string>;
}

/** All node ids a node references, split into order-only and data classes. */
export function refsOf(node: NodeDef): NodeRefs {
  const order = new Set<string>();
  const data = new Set<string>();
  const add = (source: string, controlOnly: boolean) => {
    for (const ref of refsInSource(source)) {
      order.add(ref);
      if (!controlOnly) data.add(ref);
    }
  };

  for (const expr of templateExprsIn(node.input)) add(expr, false);
  for (const field of ['prompt', 'system'] as const) {
    const value = node[field];
    if (typeof value !== 'string') continue;
    for (const expr of templateExprsIn(value)) add(expr, false);
  }
  // Transform code is JavaScript, not a template — scan the source itself.
  if (typeof node.code === 'string') add(node.code, false);
  if (typeof node.forEach === 'string') {
    for (const expr of templateExprsIn(node.forEach)) add(expr, false);
  }
  // Conditions accept both the `{{ expr }}` form and a bare expression.
  for (const field of ['when', 'repeatUntil'] as const) {
    const cond = node[field];
    if (typeof cond !== 'string') continue;
    const exprs = templateExprsIn(cond);
    if (exprs.length > 0) for (const expr of exprs) add(expr, true);
    else add(cond, true);
  }
  // The else branch must run after its partner's `when` decision.
  if (typeof node.elseOf === 'string') order.add(node.elseOf);

  return { order, data };
}

/**
 * Topological order with document order breaking ties among ready nodes, so
 * scheduling is fully deterministic. Returns null when no order exists
 * (a reference cycle, or duplicate ids) — validation reports the exact
 * path; the executor only needs to refuse to run.
 */
export function topoSort(nodes: NodeDef[]): NodeDef[] | null {
  const ids = new Set(nodes.map((n) => n.id));
  const deps = new Map<string, string[]>();
  for (const node of nodes) {
    deps.set(
      node.id,
      [...refsOf(node).order].filter((r) => ids.has(r) && r !== node.id),
    );
  }

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
