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
 *  - a DATA reference (input / prompt / system / files / code / forEach)
 *    also propagates skipping — if the source is skipped, this node is
 *    skipped;
 *  - a CONTROL reference (when / repeatUntil / elseOf) only orders the two
 *    nodes; it never propagates a skip.
 */

import { refsOf, topoSort } from '@/lib/engine/core/execute/controlflow';
import type { NodeDef, Automation } from '@/lib/engine/core/types';

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

/** The nodes of one document in execution order and the references between
 * them, derived in one pass (a run's step list reads them). */
export interface AutomationGraph {
  nodes: NodeDef[];
  edges: DerivedEdge[];
  /** True when the references form a cycle: the order shown is document order,
   * not execution order. */
  hasCycle: boolean;
}

export function buildGraph(automation: Automation | null): AutomationGraph {
  const source = automation?.nodes ?? [];
  const { nodes, hasCycle } = orderedNodes(source);
  const edges = deriveEdges(nodes);
  return { nodes, edges, hasCycle };
}
