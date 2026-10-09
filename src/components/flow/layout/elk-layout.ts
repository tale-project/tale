import type { Edge, Node } from '@xyflow/react';
import { Position } from '@xyflow/react';
import type { ELK, ElkNode } from 'elkjs/lib/elk-api';

/**
 * The ONE graph-layout engine shared by every React Flow editor in the app
 * (the automation canvas today). It wraps
 * ELK's `layered` algorithm, which — unlike Dagre — natively understands:
 *
 *  - **Compound / nested nodes**: a loop container is laid out as a sub-graph
 *    and auto-sized to fit its children plus padding. ELK reports child
 *    coordinates relative to their parent, which is exactly React Flow's model
 *    for `parentId` nodes, so they map across 1:1 with no manual centering.
 *  - **Cycles**: graphs with cycles are laid out cleanly via a cycle-breaking
 *    pass.
 *  - **Crossing minimisation**: layered sweep keeps complex branches readable.
 *
 * Callers build the React Flow node/edge model (handles, colours, parentId,
 * fixed sizes) and hand it here purely for positioning. Edges passed in
 * `layoutEdges` drive the layering only — render whatever edge set you like.
 */

const DEFAULT_NODE_WIDTH = 300;
const DEFAULT_NODE_HEIGHT = 80;

export interface ElkLayoutOptions {
  /** Primary flow direction. 'DOWN' = top-to-bottom (default). */
  direction?: 'DOWN' | 'RIGHT';
  /** Spacing between adjacent nodes in the same layer. */
  nodeNodeSpacing?: number;
  /** Spacing between consecutive layers (the "rank" gap). */
  layerSpacing?: number;
  /** Minimum gap kept between an edge and a node it routes past. */
  edgeNodeSpacing?: number;
  /** Cycle-breaking strategy for graphs that may contain cycles. */
  cycleBreaking?: 'GREEDY' | 'DEPTH_FIRST' | 'INTERACTIVE' | 'MODEL_ORDER';
  /** Inner padding for compound (container) nodes. `top` reserves header room. */
  compoundPadding?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

const DEFAULTS: Required<Omit<ElkLayoutOptions, 'compoundPadding'>> & {
  compoundPadding: NonNullable<ElkLayoutOptions['compoundPadding']>;
} = {
  direction: 'DOWN',
  nodeNodeSpacing: 80,
  layerSpacing: 70,
  edgeNodeSpacing: 24,
  cycleBreaking: 'DEPTH_FIRST',
  compoundPadding: { top: 80, right: 16, bottom: 24, left: 16 },
};

// elkjs ships a ~500KB bundle; load it lazily and keep a single instance so it
// is excluded from the initial chunk and instantiated at most once.
let elkInstance: Promise<ELK> | null = null;
function getElk(): Promise<ELK> {
  if (!elkInstance) {
    elkInstance = import('elkjs/lib/elk.bundled.js').then(
      (mod) => new mod.default(),
    );
  }
  return elkInstance;
}

function nodeDimensions(node: Node): { width: number; height: number } {
  const styleWidth =
    typeof node.style?.width === 'number' ? node.style.width : undefined;
  const styleHeight =
    typeof node.style?.height === 'number' ? node.style.height : undefined;
  return {
    width: node.width ?? styleWidth ?? DEFAULT_NODE_WIDTH,
    height: node.height ?? styleHeight ?? DEFAULT_NODE_HEIGHT,
  };
}

/**
 * Position React Flow nodes with ELK. Returns the same nodes with `position`
 * set (relative to parent for nested nodes, absolute otherwise) and, for
 * compound containers, the ELK-computed `width`/`height` written back so the
 * container renders at the size that actually fits its children.
 */
export interface ElkPoint {
  x: number;
  y: number;
}

/** Absolute polyline a routed edge should follow, keyed by edge id. */
export type EdgeRoutes = Record<string, ElkPoint[]>;

export async function layoutWithElk(
  nodes: Node[],
  layoutEdges: Edge[],
  options: ElkLayoutOptions = {},
): Promise<{ nodes: Node[]; edgeRoutes: EdgeRoutes }> {
  if (nodes.length === 0) return { nodes, edgeRoutes: {} };

  const opts = { ...DEFAULTS, ...options };
  const isHorizontal = opts.direction === 'RIGHT';

  // Group nodes by their parent so we can build ELK's hierarchical tree. A node
  // is "compound" when its id appears as some other node's parentId.
  const childrenByParent = new Map<string | undefined, Node[]>();
  for (const node of nodes) {
    const key = node.parentId ?? undefined;
    const bucket = childrenByParent.get(key);
    if (bucket) bucket.push(node);
    else childrenByParent.set(key, [node]);
  }
  const isCompound = (id: string) => childrenByParent.has(id);

  const pad = opts.compoundPadding;
  const compoundPaddingValue = `[top=${pad.top},left=${pad.left},bottom=${pad.bottom},right=${pad.right}]`;

  const toElkNode = (node: Node): ElkNode => {
    if (isCompound(node.id)) {
      // Compound: omit width/height so ELK sizes the container to its children.
      return {
        id: node.id,
        layoutOptions: { 'elk.padding': compoundPaddingValue },
        children: (childrenByParent.get(node.id) ?? []).map(toElkNode),
      };
    }
    const { width, height } = nodeDimensions(node);
    return { id: node.id, width, height };
  };

  const nodeIds = new Set(nodes.map((n) => n.id));

  const root: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': opts.direction,
      // Lay out the full hierarchy as one graph so edges may cross container
      // boundaries (e.g. into / out of a loop) and still route cleanly.
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.cycleBreaking.strategy': opts.cycleBreaking,
      // Orthogonal routing draws arrows as clean right-angles that trace each
      // path and never cut through a box — the familiar flowchart look. The
      // routed polyline is returned in `edgeRoutes` for the edge renderer.
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(opts.layerSpacing),
      'elk.layered.spacing.edgeNodeBetweenLayers': String(opts.edgeNodeSpacing),
      'elk.layered.spacing.edgeEdgeBetweenLayers': String(opts.edgeNodeSpacing),
      'elk.spacing.nodeNode': String(opts.nodeNodeSpacing),
      'elk.spacing.edgeNode': String(opts.edgeNodeSpacing),
    },
    children: (childrenByParent.get(undefined) ?? []).map(toElkNode),
    edges: layoutEdges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      })),
  };

  const elk = await getElk();
  const laid = await elk.layout(root);

  // Walk the laid-out tree once, recording both the React-Flow position (ELK
  // reports child coords relative to their parent — exactly RF's model) and the
  // absolute top-left of every node (needed to place edge routes). Collect
  // every edge object across all containers as we go.
  const relPos = new Map<
    string,
    { x: number; y: number; width?: number; height?: number }
  >();
  const absPos = new Map<string, ElkPoint>();
  const elkEdges: NonNullable<ElkNode['edges']> = [];
  const walk = (elkNode: ElkNode, offsetX: number, offsetY: number) => {
    const nx = elkNode.x ?? 0;
    const ny = elkNode.y ?? 0;
    if (elkNode.id !== 'root') {
      relPos.set(elkNode.id, {
        x: nx,
        y: ny,
        width: elkNode.width,
        height: elkNode.height,
      });
      absPos.set(elkNode.id, { x: offsetX + nx, y: offsetY + ny });
    }
    if (elkNode.edges) elkEdges.push(...elkNode.edges);
    // Children are positioned relative to this node's origin (root sits at 0,0).
    const childOffsetX = elkNode.id === 'root' ? 0 : offsetX + nx;
    const childOffsetY = elkNode.id === 'root' ? 0 : offsetY + ny;
    elkNode.children?.forEach((c) => walk(c, childOffsetX, childOffsetY));
  };
  walk(laid, 0, 0);

  // ELK edge-section coordinates are relative to the lowest common ancestor of
  // the edge's endpoints. In these graphs an edge is always either between two
  // top-level nodes (ancestor = root, offset 0) or between two nodes in the
  // same loop (ancestor = that loop). So the offset is the source's parent.
  const parentById = new Map<string, string | undefined>(
    nodes.map((n) => [n.id, n.parentId ?? undefined]),
  );
  const edgeRoutes: EdgeRoutes = {};
  for (const edge of elkEdges) {
    const section = edge.sections?.[0];
    if (!section || !edge.id) continue;
    const sourceId = edge.sources?.[0];
    const parentId = sourceId ? parentById.get(sourceId) : undefined;
    const offset = (parentId && absPos.get(parentId)) || { x: 0, y: 0 };
    const points = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ].map((p) => ({ x: p.x + offset.x, y: p.y + offset.y }));
    edgeRoutes[edge.id] = points;
  }

  const sourcePosition = isHorizontal ? Position.Right : Position.Bottom;
  const targetPosition = isHorizontal ? Position.Left : Position.Top;

  const layoutedNodes = nodes.map((node) => {
    const pos = relPos.get(node.id);
    if (!pos) return node;
    const next: Node = {
      ...node,
      position: { x: pos.x, y: pos.y },
      sourcePosition,
      targetPosition,
    };
    // Write ELK's computed size back onto containers so they render to fit.
    if (isCompound(node.id) && pos.width && pos.height) {
      next.width = pos.width;
      next.height = pos.height;
      next.style = { ...node.style, width: pos.width, height: pos.height };
    }
    return next;
  });

  return { nodes: layoutedNodes, edgeRoutes };
}
