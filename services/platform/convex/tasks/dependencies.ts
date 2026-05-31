/**
 * Pure graph helpers for task dependencies, shared by the mutation layer and its
 * tests. A dependency edge `blockerTaskId → blockedTaskId` means the blocker
 * must finish before the blocked task proceeds; the full edge set must stay a
 * DAG so the "blocked" computation terminates and the relationship reads
 * sensibly.
 */

export interface DependencyEdge {
  blockerTaskId: string;
  blockedTaskId: string;
}

/** Adjacency: blocker → tasks it blocks (its outgoing edges). */
function buildAdjacency(
  edges: readonly DependencyEdge[],
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const out = adjacency.get(edge.blockerTaskId);
    if (out) out.push(edge.blockedTaskId);
    else adjacency.set(edge.blockerTaskId, [edge.blockedTaskId]);
  }
  return adjacency;
}

/**
 * Would adding `blocker → blocked` introduce a cycle, given the existing edges?
 *
 * A self-edge is trivially a cycle. Otherwise a cycle forms iff `blocked` can
 * already reach `blocker` by following blocker→blocked edges (i.e. `blocked`
 * already transitively blocks `blocker`, so closing the loop the other way
 * would make them block each other). DFS from `blocked`; reaching `blocker`
 * means the new edge closes a cycle.
 */
export function wouldCreateCycle(
  edges: readonly DependencyEdge[],
  blockerTaskId: string,
  blockedTaskId: string,
): boolean {
  if (blockerTaskId === blockedTaskId) return true;

  const adjacency = buildAdjacency(edges);
  const seen = new Set<string>();
  const stack = [blockedTaskId];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || seen.has(node)) continue;
    if (node === blockerTaskId) return true;
    seen.add(node);
    for (const next of adjacency.get(node) ?? []) stack.push(next);
  }
  return false;
}
