import type { FlowGraph, FlowLayout, FlowPoint, FlowRect } from '../types';
import { FLOW_FRAME_PADDING, FLOW_LAYOUT_SPACING } from './elk-options';
import { boundsOf } from './geometry';

interface FallbackInput {
  signature: string;
  sizes: ReadonlyMap<string, { width: number; height: number }>;
  labels: ReadonlyMap<string, { width: number; height: number }>;
  headers: ReadonlyMap<string, { width: number; height: number }>;
  ms: number;
}

/** Room between the column and the first side channel, and between two
 *  channels. */
const CHANNEL_GAP = 24;
const CHANNEL_STEP = 12;
/** How far a route runs straight out of a box before it turns. */
const STUB = 16;

/**
 * Every node in one column, in reading order, when the layout engine could
 * not run: the canvas still shows the whole graph and stays usable, and an
 * Alert says why it looks plain. A node right under the one it comes from
 * gets a straight line; any other edge runs down a channel of its own to the
 * right of the column, so no line crosses a box.
 */
export function layoutFallbackColumn(
  graph: FlowGraph,
  input: FallbackInput,
): FlowLayout {
  const nodes: Record<string, FlowRect> = {};
  const groups: Record<string, FlowRect & { header: FlowRect }> = {};
  const groupOf = new Map<string, string>();
  for (const group of graph.groups ?? [])
    for (const member of group.members) groupOf.set(member, group.id);

  const widest = Math.max(
    ...graph.nodes.map((node) => input.sizes.get(node.id)?.width ?? 0),
  );
  const centre = widest / 2 + FLOW_FRAME_PADDING.left;
  let y = 0;
  const headed = new Set<string>();
  for (const node of graph.nodes) {
    const size = input.sizes.get(node.id) ?? { width: 0, height: 0 };
    const groupId = groupOf.get(node.id);
    if (groupId !== undefined && !headed.has(groupId)) {
      headed.add(groupId);
      const header = input.headers.get(groupId) ?? { width: 0, height: 0 };
      y += FLOW_FRAME_PADDING.top;
      groups[groupId] = {
        x: 0,
        y: y - FLOW_FRAME_PADDING.top,
        width: 0,
        height: 0,
        header: {
          x: centre - widest / 2,
          y,
          width: header.width,
          height: header.height,
        },
      };
      y += header.height + FLOW_FRAME_PADDING.top;
    }
    nodes[node.id] = {
      x: centre - size.width / 2,
      y,
      width: size.width,
      height: size.height,
    };
    y += size.height + FLOW_LAYOUT_SPACING.betweenLayers;
  }
  // A frame closes round its header and members.
  for (const group of graph.groups ?? []) {
    const frame = groups[group.id];
    if (frame === undefined) continue;
    const inner = boundsOf([
      frame.header,
      ...group.members.flatMap((id) => (nodes[id] ? [nodes[id]] : [])),
    ]);
    const right =
      group.kind === 'repeat'
        ? FLOW_FRAME_PADDING.repeatRight
        : FLOW_FRAME_PADDING.right;
    groups[group.id] = {
      header: frame.header,
      x: inner.x - FLOW_FRAME_PADDING.left,
      y: inner.y - FLOW_FRAME_PADDING.top,
      width: inner.width + FLOW_FRAME_PADDING.left + right,
      height: inner.height + FLOW_FRAME_PADDING.top + FLOW_FRAME_PADDING.bottom,
    };
  }

  const order = graph.nodes.map((node) => node.id);
  const columnRight = boundsOf([
    ...Object.values(nodes),
    ...Object.values(groups),
  ]);
  const edges: Record<string, { points: FlowPoint[]; label?: FlowRect }> = {};
  let channel = 0;
  for (const edge of graph.edges) {
    if (edge.layoutOnly) continue;
    const source = nodes[edge.source];
    const target = nodes[edge.target];
    if (source === undefined || target === undefined) continue;
    const from = {
      x: source.x + source.width / 2,
      y: source.y + source.height,
    };
    const to = { x: target.x + target.width / 2, y: target.y };
    const adjacent =
      order.indexOf(edge.target) === order.indexOf(edge.source) + 1 &&
      groupOf.get(edge.target) === groupOf.get(edge.source);
    let points: FlowPoint[];
    if (adjacent) {
      points = [from, { x: from.x, y: to.y }];
    } else {
      const x =
        columnRight.x +
        columnRight.width +
        CHANNEL_GAP +
        channel * CHANNEL_STEP;
      channel += 1;
      // Into a frame, the route turns in below the frame's header, inside
      // the gap the frame's padding leaves above the node.
      const approach = groupOf.has(edge.target)
        ? FLOW_FRAME_PADDING.top / 2
        : STUB;
      points = [
        from,
        { x: from.x, y: from.y + STUB },
        { x, y: from.y + STUB },
        { x, y: to.y - approach },
        { x: to.x, y: to.y - approach },
        to,
      ];
    }
    const label = input.labels.get(edge.id);
    edges[edge.id] = {
      points,
      ...(label
        ? {
            label: {
              x: from.x + 8,
              y: from.y + 4,
              width: label.width,
              height: label.height,
            },
          }
        : {}),
    };
  }
  const bounds = boundsOf([
    ...Object.values(nodes),
    ...Object.values(groups),
    ...Object.values(edges).flatMap((edge) =>
      edge.points.map((point) => ({ ...point, width: 0, height: 0 })),
    ),
  ]);
  return {
    signature: input.signature,
    nodes,
    groups,
    edges,
    bounds,
    rows: order.filter((id) => nodes[id] !== undefined).map((id) => [id]),
    engine: 'fallback-column',
    ms: input.ms,
  };
}
