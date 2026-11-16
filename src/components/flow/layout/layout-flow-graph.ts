import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';

import type {
  FlowEdge,
  FlowGraph,
  FlowGroup,
  FlowLayout,
  FlowNode,
  FlowPoint,
  FlowRect,
} from '../types';
import {
  FLOW_ELK_LIVE,
  FLOW_ELK_NODE,
  FLOW_ELK_ROOT,
  FLOW_FRAME_PADDING,
} from './elk-options';
import { layoutFallbackColumn } from './fallback-column';
import { boundsOf, cleanRoute, joinSections, snapHalf } from './geometry';
import {
  estimateFlowText,
  flowEdgeLabelSize,
  flowFrameHeaderSize,
  flowNodeSize,
  type FlowTextMeasure,
} from './sizes';

/** The JSON graph ELK reads and answers with. */
export type FlowElkNode = ElkNode;
export type FlowElkEdge = ElkExtendedEdge;

/** Anything that lays out an ELK JSON graph: elkjs's bundled build, the
 *  worker-backed client, or a test's stand-in. */
export interface ElkLike {
  layout(graph: FlowElkNode): Promise<FlowElkNode>;
}

/** A layout engine and where it runs. */
export interface FlowElk {
  layout(graph: FlowElkNode): Promise<{
    graph: FlowElkNode;
    engine: 'worker' | 'main';
  }>;
}

export interface LayoutFlowGraphOptions {
  /** The layout of the graph on screen before this change: lays out again
   *  keeping every row's order (a live relayout). Leave it out to lay out
   *  afresh — opening a document, switching versions. */
  previous?: FlowLayout | null;
  /** Measures text; the layout estimates when left out. */
  measure?: FlowTextMeasure;
  /** The words on an edge ("Yes", "No"); English when left out. */
  edgeLabel?: (edge: FlowEdge) => string | undefined;
  /** The engine; the shared worker-backed one when left out. */
  elk?: FlowElk;
  signal?: AbortSignal;
  /** Gives up on ELK after this long and lays the graph out in one column.
   *  @default 5000 */
  timeoutMs?: number;
}

/** The id of a frame's header box, which edges route around. */
const frameHeaderId = (groupId: string) => `${groupId}:head`;
const headerEdgeId = (groupId: string, member: string) =>
  `${groupId}:head>${member}`;

export function defaultEdgeLabel(edge: FlowEdge): string | undefined {
  if (edge.kind === 'branch-yes') return 'Yes';
  if (edge.kind === 'branch-no') return 'No';
  return undefined;
}

interface Prepared {
  signature: string;
  sizes: Map<string, { width: number; height: number }>;
  labels: Map<string, { text: string; width: number; height: number }>;
  headers: Map<string, { width: number; height: number }>;
  /** Layout-only links from a frame's header to its first members. */
  headerEdges: { id: string; source: string; target: string }[];
  groupOf: Map<string, FlowGroup>;
}

function prepare(
  graph: FlowGraph,
  measure: FlowTextMeasure,
  edgeLabel: (edge: FlowEdge) => string | undefined,
): Prepared {
  const sizes = new Map(
    graph.nodes.map((node) => [node.id, flowNodeSize(node, measure)]),
  );
  const labels = new Map<
    string,
    { text: string; width: number; height: number }
  >();
  for (const edge of graph.edges) {
    if (edge.layoutOnly) continue;
    const text = edgeLabel(edge);
    if (text)
      labels.set(edge.id, { text, ...flowEdgeLabelSize(text, measure) });
  }
  const groupOf = new Map<string, FlowGroup>();
  const headers = new Map<string, { width: number; height: number }>();
  const headerEdges: Prepared['headerEdges'] = [];
  for (const group of graph.groups ?? []) {
    headers.set(group.id, flowFrameHeaderSize(group.label, measure));
    const inside = new Set(group.members);
    for (const member of group.members) groupOf.set(member, group);
    // The header heads every member nothing inside the frame leads to, so
    // it sits in the frame's first row and incoming edges go round it.
    for (const member of group.members) {
      const led = graph.edges.some(
        (edge) => edge.target === member && inside.has(edge.source),
      );
      if (!led)
        headerEdges.push({
          id: headerEdgeId(group.id, member),
          source: frameHeaderId(group.id),
          target: member,
        });
    }
  }
  const signature = [
    graph.nodes
      .map((node) => {
        const size = sizes.get(node.id);
        return `${node.id}:${node.kind}:${size?.width}x${size?.height}`;
      })
      .join(','),
    graph.edges
      .map(
        (edge) =>
          `${edge.id}:${edge.source}>${edge.target}:${edge.kind}${edge.layoutOnly ? ':l' : ''}${labels.has(edge.id) ? `:${labels.get(edge.id)?.width}` : ''}`,
      )
      .join(','),
    (graph.groups ?? [])
      .map(
        (group) =>
          `${group.id}:${group.kind}:${group.members.join('+')}:${headers.get(group.id)?.width}`,
      )
      .join(','),
  ].join('|');
  return { signature, sizes, labels, headers, headerEdges, groupOf };
}

/** The structural signature a layout of `graph` would carry. */
export function flowLayoutSignature(
  graph: FlowGraph,
  options: Pick<LayoutFlowGraphOptions, 'measure' | 'edgeLabel'> = {},
): string {
  return prepare(
    graph,
    options.measure ?? estimateFlowText,
    options.edgeLabel ?? defaultEdgeLabel,
  ).signature;
}

const position = (point: FlowPoint) => `(${point.x},${point.y})`;

/** Where a node sat last time, or — new — just after a neighbour that did,
 *  so it sorts in beside the node it hangs from. */
function hintFor(
  id: string,
  graph: FlowGraph,
  previous: FlowLayout,
): FlowPoint | undefined {
  const before = previous.nodes[id];
  if (before) return { x: before.x, y: before.y };
  for (const edge of graph.edges) {
    if (edge.target !== id) continue;
    const source = previous.nodes[edge.source];
    if (source) return { x: source.x + 0.5, y: source.y + 1 };
  }
  const index = graph.nodes.findIndex((node) => node.id === id);
  for (let at = index - 1; at >= 0; at--) {
    const earlier = previous.nodes[graph.nodes[at]?.id ?? ''];
    if (earlier) return { x: earlier.x + 0.5, y: earlier.y + 1 };
  }
  return undefined;
}

/** The ELK graph for `graph`: one port per edge end (targets on top,
 *  sources at the bottom), frames as compound nodes with a header box. */
function toElkGraph(
  graph: FlowGraph,
  prepared: Prepared,
  previous?: FlowLayout | null,
): FlowElkNode {
  const linked = [
    ...graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
    ...prepared.headerEdges,
  ];
  const portsOf = (id: string) => [
    ...linked
      .filter((edge) => edge.target === id)
      .map((edge) => ({
        id: `${edge.id}:t`,
        width: 0,
        height: 0,
        layoutOptions: { 'elk.port.side': 'NORTH' },
      })),
    ...linked
      .filter((edge) => edge.source === id)
      .map((edge) => ({
        id: `${edge.id}:s`,
        width: 0,
        height: 0,
        layoutOptions: { 'elk.port.side': 'SOUTH' },
      })),
  ];
  const hinted = (id: string, options: Record<string, string>) => {
    if (!previous) return options;
    const hint =
      hintFor(id, graph, previous) ??
      (previous.groups[id]
        ? { x: previous.groups[id].x, y: previous.groups[id].y }
        : undefined);
    return hint ? { ...options, 'elk.position': position(hint) } : options;
  };
  const leaf = (node: FlowNode): FlowElkNode => {
    const size = prepared.sizes.get(node.id) ?? { width: 0, height: 0 };
    return {
      id: node.id,
      width: size.width,
      height: size.height,
      layoutOptions: hinted(node.id, { ...FLOW_ELK_NODE }),
      ports: portsOf(node.id),
    };
  };
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const children: FlowElkNode[] = [];
  const emitted = new Set<string>();
  for (const node of graph.nodes) {
    const group = prepared.groupOf.get(node.id);
    if (!group) {
      children.push(leaf(node));
      continue;
    }
    if (emitted.has(group.id)) continue;
    emitted.add(group.id);
    const header = prepared.headers.get(group.id) ?? { width: 0, height: 0 };
    const headerHint = previous?.groups[group.id]?.header;
    const right =
      group.kind === 'repeat'
        ? FLOW_FRAME_PADDING.repeatRight
        : FLOW_FRAME_PADDING.right;
    children.push({
      id: group.id,
      layoutOptions: hinted(group.id, {
        'elk.padding': `[top=${FLOW_FRAME_PADDING.top},left=${FLOW_FRAME_PADDING.left},bottom=${FLOW_FRAME_PADDING.bottom},right=${right}]`,
      }),
      children: [
        {
          id: frameHeaderId(group.id),
          width: header.width,
          height: header.height,
          layoutOptions: {
            ...FLOW_ELK_NODE,
            ...(headerHint ? { 'elk.position': position(headerHint) } : {}),
          },
          ports: portsOf(frameHeaderId(group.id)),
        },
        ...graph.nodes
          .filter((member) => group.members.includes(member.id))
          .map((member) => leaf(byId.get(member.id) ?? member)),
      ],
    });
  }
  return {
    id: 'root',
    layoutOptions: previous
      ? { ...FLOW_ELK_ROOT, ...FLOW_ELK_LIVE }
      : { ...FLOW_ELK_ROOT },
    children,
    edges: linked.map((edge) => {
      const elkEdge: FlowElkEdge = {
        id: edge.id,
        sources: [`${edge.id}:s`],
        targets: [`${edge.id}:t`],
      };
      const label = prepared.labels.get(edge.id);
      if (label)
        elkEdge.labels = [
          {
            id: `${edge.id}:label`,
            text: label.text,
            width: label.width,
            height: label.height,
          },
        ];
      return elkEdge;
    }),
  };
}

const snapRect = (rect: FlowRect): FlowRect => ({
  x: snapHalf(rect.x),
  y: snapHalf(rect.y),
  width: rect.width,
  height: rect.height,
});

/** Rows top to bottom: nodes whose centres share a line (ELK centres a
 *  row's boxes on it), each row left to right. */
function rowsOf(
  nodes: Readonly<Record<string, FlowRect>>,
  order: readonly string[],
): string[][] {
  const placed = order
    .filter((id) => nodes[id] !== undefined)
    .map((id) => {
      const rect = nodes[id];
      return { id, cy: rect.y + rect.height / 2, x: rect.x };
    })
    .sort((a, b) => a.cy - b.cy || a.x - b.x);
  const rows: { cy: number; ids: { id: string; x: number }[] }[] = [];
  for (const node of placed) {
    const row = rows.at(-1);
    if (row && Math.abs(row.cy - node.cy) <= 1) row.ids.push(node);
    else rows.push({ cy: node.cy, ids: [node] });
  }
  return rows.map((row) =>
    row.ids.sort((a, b) => a.x - b.x).map((node) => node.id),
  );
}

function readLayout(
  graph: FlowGraph,
  prepared: Prepared,
  laid: FlowElkNode,
  engine: FlowLayout['engine'],
  ms: number,
): FlowLayout {
  const known = new Set(graph.nodes.map((node) => node.id));
  const groupIds = new Set((graph.groups ?? []).map((group) => group.id));
  const nodes: Record<string, FlowRect> = {};
  const groups: Record<string, FlowRect & { header: FlowRect }> = {};
  const headers = new Map<string, FlowRect>();
  const elkEdges: FlowElkEdge[] = [];
  const rectOf = (node: FlowElkNode): FlowRect =>
    snapRect({
      x: node.x ?? 0,
      y: node.y ?? 0,
      width: node.width ?? 0,
      height: node.height ?? 0,
    });
  const walk = (node: FlowElkNode) => {
    if (known.has(node.id)) nodes[node.id] = rectOf(node);
    else if (groupIds.has(node.id))
      groups[node.id] = {
        ...rectOf(node),
        header: { x: 0, y: 0, width: 0, height: 0 },
      };
    else if (node.id.endsWith(':head')) headers.set(node.id, rectOf(node));
    for (const edge of node.edges ?? []) elkEdges.push(edge);
    for (const child of node.children ?? []) walk(child);
  };
  walk(laid);
  for (const [id, group] of Object.entries(groups)) {
    const header = headers.get(frameHeaderId(id));
    if (header) group.header = header;
  }
  const drawn = new Map(
    graph.edges
      .filter((edge) => !edge.layoutOnly)
      .map((edge) => [edge.id, edge]),
  );
  const edges: Record<string, { points: FlowPoint[]; label?: FlowRect }> = {};
  for (const elkEdge of elkEdges) {
    if (!drawn.has(elkEdge.id)) continue;
    const points = cleanRoute(joinSections(elkEdge.sections ?? []));
    const label = elkEdge.labels?.[0];
    const route: { points: FlowPoint[]; label?: FlowRect } = { points };
    if (label?.x !== undefined && label.y !== undefined)
      route.label = snapRect({
        x: label.x,
        y: label.y,
        width: label.width ?? 0,
        height: label.height ?? 0,
      });
    edges[elkEdge.id] = route;
  }
  const missing = [...drawn.keys()].filter((id) => edges[id] === undefined);
  if (missing.length > 0)
    throw new Error(`ELK returned no route for ${missing.join(', ')}`);
  const extents: FlowRect[] = [
    ...Object.values(nodes),
    ...Object.values(groups),
  ];
  for (const edge of Object.values(edges)) {
    for (const point of edge.points)
      extents.push({ x: point.x, y: point.y, width: 0, height: 0 });
    if (edge.label) extents.push(edge.label);
  }
  const bounds = boundsOf(extents);
  return {
    signature: prepared.signature,
    nodes,
    groups,
    edges,
    bounds,
    rows: rowsOf(
      nodes,
      graph.nodes.map((node) => node.id),
    ),
    engine,
    ms,
  };
}

function abortError(): Error {
  const error = new Error('The flow layout was cancelled');
  error.name = 'AbortError';
  return error;
}

/**
 * Lays out `graph` with ELK and answers where every box, frame, route and
 * label goes. Deterministic: the same graph and options give the same
 * layout. With `previous`, a graph that changed on screen is laid out again
 * keeping each row's order, so nothing swaps sides with its neighbour.
 *
 * Should ELK fail or take longer than `timeoutMs`, the graph is laid out in
 * one column instead (`engine: 'fallback-column'`): never no picture. A
 * cancelled layout rejects with an `AbortError`.
 */
export async function layoutFlowGraph(
  graph: FlowGraph,
  options: LayoutFlowGraphOptions = {},
): Promise<FlowLayout> {
  const measure = options.measure ?? estimateFlowText;
  const prepared = prepare(
    graph,
    measure,
    options.edgeLabel ?? defaultEdgeLabel,
  );
  const started = performance.now();
  if (options.signal?.aborted) throw abortError();
  if (graph.nodes.length === 0)
    return {
      signature: prepared.signature,
      nodes: {},
      groups: {},
      edges: {},
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      rows: [],
      engine: 'main',
      ms: 0,
    };
  const fallback = (error: unknown) => {
    console.warn('Flow layout failed; showing the nodes in one column', error);
    return layoutFallbackColumn(graph, {
      signature: prepared.signature,
      sizes: prepared.sizes,
      labels: prepared.labels,
      headers: prepared.headers,
      ms: performance.now() - started,
    });
  };
  let elk: FlowElk;
  try {
    elk = options.elk ?? (await (await import('./elk-client')).getFlowElk());
  } catch (error) {
    return fallback(error);
  }
  const json = toElkGraph(graph, prepared, options.previous);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const answer = await Promise.race([
      elk.layout(json),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `ELK took longer than ${options.timeoutMs ?? 5_000} ms`,
              ),
            ),
          options.timeoutMs ?? 5_000,
        );
      }),
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(abortError());
        options.signal?.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
    return readLayout(
      graph,
      prepared,
      answer.graph,
      answer.engine,
      performance.now() - started,
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return fallback(error);
  } finally {
    clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
  }
}
