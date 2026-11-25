import type { FlowGraph, FlowLayout } from '../types';

/** A key that moves focus across the chart. */
export type FlowNavigationKey =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'first'
  | 'last';

/**
 * Where focus goes from `fromId` on `key` — pure, so the keyboard map is
 * tested without a browser:
 *
 *  - down / up follow the drawn edges to a successor / predecessor, the one
 *    whose centre lines up best with this node's (ties: reading order);
 *  - left / right step to the neighbour in the same row;
 *  - first / last jump to Start / End (else the first / last node).
 *
 * `null` when there is nowhere to go: focus stays.
 */
export function flowNeighbour(
  graph: FlowGraph,
  layout: FlowLayout,
  fromId: string,
  key: FlowNavigationKey,
): string | null {
  if (key === 'first')
    return (
      graph.nodes.find((node) => node.kind === 'entry')?.id ??
      graph.nodes[0]?.id ??
      null
    );
  if (key === 'last')
    return (
      graph.nodes.find((node) => node.kind === 'exit')?.id ??
      graph.nodes.at(-1)?.id ??
      null
    );
  if (key === 'left' || key === 'right') {
    const row = layout.rows.find((candidate) => candidate.includes(fromId));
    if (row === undefined) return null;
    const at = row.indexOf(fromId) + (key === 'right' ? 1 : -1);
    return row[at] ?? null;
  }
  const from = layout.nodes[fromId];
  if (from === undefined) return null;
  const centre = from.x + from.width / 2;
  const order = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const candidates = graph.edges
    .filter((edge) => !edge.layoutOnly)
    .filter((edge) =>
      key === 'down' ? edge.source === fromId : edge.target === fromId,
    )
    .map((edge) => (key === 'down' ? edge.target : edge.source))
    .filter((id, index, all) => all.indexOf(id) === index)
    .filter((id) => layout.nodes[id] !== undefined);
  let best: string | null = null;
  let bestDistance = Infinity;
  let bestOrder = Infinity;
  for (const id of candidates) {
    const rect = layout.nodes[id];
    if (rect === undefined) continue;
    const distance = Math.abs(rect.x + rect.width / 2 - centre);
    const rank = order.get(id) ?? Infinity;
    if (
      distance < bestDistance - 0.5 ||
      (Math.abs(distance - bestDistance) <= 0.5 && rank < bestOrder)
    ) {
      best = id;
      bestDistance = distance;
      bestOrder = rank;
    }
  }
  return best;
}

/** The arrow and jump keys the chart answers, by `KeyboardEvent.key`. */
export const FLOW_NAVIGATION_KEYS: Readonly<Record<string, FlowNavigationKey>> =
  {
    ArrowDown: 'down',
    ArrowUp: 'up',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    Home: 'first',
    End: 'last',
  };

/**
 * The chart's one Tab stop: the selected node, else the one focused last,
 * else Start, else the first node.
 */
export function flowTabStop(
  graph: FlowGraph,
  selectedId: string | null | undefined,
  lastFocusedId: string | null | undefined,
): string | null {
  const has = (id: string | null | undefined): id is string =>
    id !== null &&
    id !== undefined &&
    graph.nodes.some((node) => node.id === id);
  if (has(selectedId)) return selectedId;
  if (has(lastFocusedId)) return lastFocusedId;
  return (
    graph.nodes.find((node) => node.kind === 'entry')?.id ??
    graph.nodes[0]?.id ??
    null
  );
}
