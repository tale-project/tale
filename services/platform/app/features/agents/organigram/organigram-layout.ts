import type { Edge, Node } from '@xyflow/react';
import { Position } from '@xyflow/react';

import type { ElkLayoutOptions } from '@/app/components/flow/layout/elk-layout';
import type { OrgChartNode } from '@/convex/agents/org_chart_actions';

export const ORG_NODE_WIDTH = 280;
export const ORG_NODE_HEIGHT = 88;
export const HUMANS_NODE_ID = '__humans__';
export const HUMANS_NODE_WIDTH = 200;
export const HUMANS_NODE_HEIGHT = 72;

export type OrganigramFlowNode = Node<{ chartNode: OrgChartNode }, 'agent'>;
export type HumansFlowNode = Node<{ rootCount: number }, 'humans'>;

/** Edge styling reused from the automations canvas (smoothstep + 2px stroke,
 *  no arrowhead — direction is conveyed by the top-down layout). The shared
 *  `AutomationEdge` renderer reads `type` and `style`. */
const EDGE_STYLE = { strokeWidth: 2 } as const;

/** ELK options for the delegation graph: top-down, with cycle-breaking since
 *  the many-to-many delegation graph is allowed to contain cycles. */
export const ORG_ELK_OPTIONS: ElkLayoutOptions = {
  direction: 'DOWN',
  nodeNodeSpacing: 56,
  layerSpacing: 72,
  cycleBreaking: 'DEPTH_FIRST',
};

/**
 * Build the React Flow node/edge model for the many-to-many delegation graph.
 * A single synthetic "Humans" node sits at the top; every agent that nobody
 * delegates to (a root) hangs off it, mirroring the "reports to humans"
 * escalation target. An agent with several parents simply renders with several
 * incoming edges. Positioning is handled separately by ELK
 * ({@link layoutWithElk}) — this function is pure and selection-independent so
 * selecting a node never triggers a re-layout.
 */
export function buildOrgGraph(chartNodes: OrgChartNode[]): {
  nodes: Array<OrganigramFlowNode | HumansFlowNode>;
  edges: Edge[];
} {
  const slugs = new Set(chartNodes.map((node) => node.slug));
  const roots = chartNodes.filter((node) => node.parentSlugs.length === 0);
  const hasHumans = roots.length > 0;

  const edges: Edge[] = [];
  const seenEdge = new Set<string>();
  const addEdge = (source: string, target: string) => {
    const id = `${source}->${target}`;
    if (seenEdge.has(id)) return;
    seenEdge.add(id);
    edges.push({ id, source, target, type: 'smoothstep', style: EDGE_STYLE });
  };

  // Authoritative edges: parent → each agent it delegates to.
  for (const node of chartNodes) {
    for (const child of node.directReports) {
      if (slugs.has(child)) addEdge(node.slug, child);
    }
  }
  // Roots hang off the single Humans node.
  if (hasHumans) for (const root of roots) addEdge(HUMANS_NODE_ID, root.slug);

  const nodes: Array<OrganigramFlowNode | HumansFlowNode> = chartNodes.map(
    (chartNode) => ({
      id: chartNode.slug,
      type: 'agent',
      position: { x: 0, y: 0 },
      width: ORG_NODE_WIDTH,
      height: ORG_NODE_HEIGHT,
      data: { chartNode },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    }),
  );

  if (hasHumans) {
    nodes.push({
      id: HUMANS_NODE_ID,
      type: 'humans',
      position: { x: 0, y: 0 },
      width: HUMANS_NODE_WIDTH,
      height: HUMANS_NODE_HEIGHT,
      data: { rootCount: roots.length },
      selectable: false,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    });
  }

  return { nodes, edges };
}
