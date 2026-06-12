import type { Edge, Node } from '@xyflow/react';
import { Position } from '@xyflow/react';
import dagre from 'dagre';

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

/**
 * Deterministic top-to-bottom dagre layout for the many-to-many delegation
 * graph. A single synthetic "Humans" node sits at the top; every agent that
 * nobody delegates to (a root) hangs off it, mirroring the "reports to humans"
 * escalation target. An agent with several parents simply renders with several
 * incoming edges — dagre ranks it below all of them.
 */
export function layoutOrgChart(
  chartNodes: OrgChartNode[],
  selectedSlug: string | null,
): { nodes: Array<OrganigramFlowNode | HumansFlowNode>; edges: Edge[] } {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'TB',
    nodesep: 56,
    ranksep: 72,
    marginx: 32,
    marginy: 32,
  });

  const slugs = new Set(chartNodes.map((node) => node.slug));
  const roots = chartNodes.filter((node) => node.parentSlugs.length === 0);
  const hasHumans = roots.length > 0;

  if (hasHumans) {
    graph.setNode(HUMANS_NODE_ID, {
      width: HUMANS_NODE_WIDTH,
      height: HUMANS_NODE_HEIGHT,
    });
  }
  for (const node of chartNodes) {
    graph.setNode(node.slug, {
      width: ORG_NODE_WIDTH,
      height: ORG_NODE_HEIGHT,
    });
  }

  const edges: Edge[] = [];
  const seenEdge = new Set<string>();
  const addEdge = (source: string, target: string) => {
    const id = `${source}->${target}`;
    if (seenEdge.has(id)) return;
    seenEdge.add(id);
    graph.setEdge(source, target);
    edges.push({
      id,
      source,
      target,
      type: 'smoothstep',
      style: EDGE_STYLE,
    });
  };

  // Authoritative edges: parent → each agent it delegates to.
  for (const node of chartNodes) {
    for (const child of node.directReports) {
      if (slugs.has(child)) addEdge(node.slug, child);
    }
  }
  // Roots hang off the single Humans node.
  if (hasHumans) for (const root of roots) addEdge(HUMANS_NODE_ID, root.slug);

  dagre.layout(graph);

  const nodes: Array<OrganigramFlowNode | HumansFlowNode> = chartNodes.map(
    (chartNode) => {
      const pos = graph.node(chartNode.slug);
      return {
        id: chartNode.slug,
        type: 'agent',
        position: {
          x: pos.x - ORG_NODE_WIDTH / 2,
          y: pos.y - ORG_NODE_HEIGHT / 2,
        },
        data: { chartNode },
        selected: chartNode.slug === selectedSlug,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      };
    },
  );

  if (hasHumans) {
    const pos = graph.node(HUMANS_NODE_ID);
    nodes.push({
      id: HUMANS_NODE_ID,
      type: 'humans',
      position: {
        x: pos.x - HUMANS_NODE_WIDTH / 2,
        y: pos.y - HUMANS_NODE_HEIGHT / 2,
      },
      data: { rootCount: roots.length },
      selectable: false,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    });
  }

  return { nodes, edges };
}
