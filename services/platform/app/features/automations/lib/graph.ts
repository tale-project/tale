/**
 * The canvas graph, DERIVED from the document.
 *
 * A v1 document has no edge list: a node names the nodes it needs by writing
 * `{{ nodes.<id>.output }}` in its own fields, and the engine orders the run
 * from exactly those references. The canvas therefore derives its edges the
 * same way — through the engine's own `refsOf` and `topoSort` — instead of
 * keeping a second graph beside the document. There is nothing to keep in sync
 * because there is only ever one source of truth, and a canvas edge is a
 * promise the executor will honour rather than a drawing.
 *
 * The reference kind is carried through to the edge, because it is what an
 * author needs to see:
 *  - a DATA reference (input / prompt / system / code / forEach) also
 *    propagates skipping — if the source is skipped, this node is skipped;
 *  - a CONTROL reference (when / repeatUntil / elseOf) only orders the two
 *    nodes; it never propagates a skip.
 */

import { refsOf, topoSort } from '@/lib/engine/core/execute/controlflow';
import type { NodeDef, Workflow } from '@/lib/engine/core/types';

/** One derived connection between two nodes of the document. */
export interface DerivedEdge {
  /** Stable within a document: `<source>-><target>`. */
  id: string;
  source: string;
  target: string;
  /**
   * `data` — the target reads the source's output, so a skip propagates.
   * `control` — the target only mentions the source in `when`, `repeatUntil`,
   * or `elseOf`, which orders the two without propagating a skip.
   */
  kind: 'data' | 'control';
}

/**
 * Every edge the document implies, in a stable order (by target position, then
 * by source position) so the canvas never reshuffles between renders.
 *
 * A reference to a node that does not exist is not an edge — validation reports
 * it as an error against the document; drawing a dangling line would only
 * duplicate that message less clearly.
 */
export function deriveEdges(nodes: readonly NodeDef[]): DerivedEdge[] {
  const index = new Map(nodes.map((node, position) => [node.id, position]));
  const edges: DerivedEdge[] = [];
  for (const node of nodes) {
    const { order, data } = refsOf(node);
    const sources = [...order]
      .filter((id) => id !== node.id && index.has(id))
      .sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
    for (const source of sources) {
      edges.push({
        id: `${source}->${node.id}`,
        source,
        target: node.id,
        kind: data.has(source) ? 'data' : 'control',
      });
    }
  }
  return edges;
}

/**
 * The nodes in execution order. A document whose references form a cycle has no
 * topological order — validation reports the cycle — so the canvas falls back to
 * document order and says so, which still lets the author reach the node that
 * needs fixing.
 */
export function orderedNodes(nodes: readonly NodeDef[]): {
  nodes: NodeDef[];
  hasCycle: boolean;
} {
  const sorted = topoSort([...nodes]);
  return sorted === null
    ? { nodes: [...nodes], hasCycle: true }
    : { nodes: sorted, hasCycle: false };
}

/** How far down the canvas a node sits: one more than the deepest node it
 * references. Computed over the ordered list, so one pass suffices. */
export function rankNodes(
  ordered: readonly NodeDef[],
  edges: readonly DerivedEdge[],
): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const bucket = incoming.get(edge.target);
    if (bucket) bucket.push(edge.source);
    else incoming.set(edge.target, [edge.source]);
  }
  const ranks = new Map<string, number>();
  for (const node of ordered) {
    const sources = incoming.get(node.id) ?? [];
    let rank = 0;
    for (const source of sources) {
      const sourceRank = ranks.get(source);
      // A source that has not been ranked yet only happens inside a cycle,
      // where there is no honest depth to read — treat it as level 0.
      if (sourceRank !== undefined) rank = Math.max(rank, sourceRank + 1);
    }
    ranks.set(node.id, rank);
  }
  return ranks;
}

/** The control-flow fields a node declares, as the canvas renders them: one
 * badge per field, in a fixed reading order. */
export type ControlFlowKind =
  | 'when'
  | 'elseOf'
  | 'forEach'
  | 'repeatUntil'
  | 'onError';

export interface ControlFlowBadge {
  kind: ControlFlowKind;
  /** The field's own value — the condition, the iterated expression, the
   * guarded node id, or the error policy. */
  value: string;
  /** `repeatUntil` only: the iteration cap the engine will apply. */
  maxRepeats?: number;
}

/**
 * The badges for one node. `onError: 'fail'` is the engine default and says
 * nothing an author did not already assume, so only `continue` shows.
 */
export function controlFlowBadges(node: NodeDef): ControlFlowBadge[] {
  const badges: ControlFlowBadge[] = [];
  if (node.when !== undefined) badges.push({ kind: 'when', value: node.when });
  if (node.elseOf !== undefined) {
    badges.push({ kind: 'elseOf', value: node.elseOf });
  }
  if (node.forEach !== undefined) {
    badges.push({ kind: 'forEach', value: node.forEach });
  }
  if (node.repeatUntil !== undefined) {
    badges.push({
      kind: 'repeatUntil',
      value: node.repeatUntil,
      ...(node.maxRepeats !== undefined && { maxRepeats: node.maxRepeats }),
    });
  }
  if (node.onError === 'continue') {
    badges.push({ kind: 'onError', value: node.onError });
  }
  return badges;
}

/** Everything the canvas needs about one document, derived in one pass. */
export interface AutomationGraph {
  nodes: NodeDef[];
  edges: DerivedEdge[];
  ranks: Map<string, number>;
  /** True when the references form a cycle: the order shown is document order,
   * not execution order. */
  hasCycle: boolean;
}

export function buildGraph(workflow: Workflow | null): AutomationGraph {
  const source = workflow?.nodes ?? [];
  const { nodes, hasCycle } = orderedNodes(source);
  const edges = deriveEdges(nodes);
  return { nodes, edges, ranks: rankNodes(nodes, edges), hasCycle };
}
