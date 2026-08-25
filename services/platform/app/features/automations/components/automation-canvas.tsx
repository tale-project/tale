'use client';

import { Alert } from '@tale/ui/alert';
import { EmptyState } from '@tale/ui/empty-state';
import {
  MarkerType,
  Position,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import { AlertTriangle, Workflow } from 'lucide-react';
import { useCallback, useMemo, type CSSProperties } from 'react';

import {
  FLOW_EDGE_COLORS,
  FLOW_EDGE_MARKER_SIZE,
  FLOW_EDGE_STROKE_WIDTH,
} from '@/app/components/flow/edge-palette';
import { FlowCanvas } from '@/app/components/flow/flow-canvas';
import { useElkLayout } from '@/app/components/flow/layout/use-elk-layout';
import { useT } from '@/lib/i18n/client';

import type { NodePosition } from '../lib/document';
import type { AutomationGraph } from '../lib/graph';
import type { NodeRunStatus } from '../lib/run-view';
import {
  AutomationNode,
  CanvasNodeProvider,
  type AutomationNodeData,
  type CanvasNodeContextValue,
} from './automation-node';

/** The box every node renders at. Fixed so the layout engine and the DOM
 * agree, and so a long node id cannot reflow the graph. */
const NODE_WIDTH = 300;
const NODE_HEIGHT = 116;

/** React Flow requires a stable node-type map; an inline object remounts every
 * node on each render. */
const NODE_TYPES = { automation: AutomationNode };

/** React Flow computes `pointer-events: none` on a node wrapper that is
 * neither selectable nor draggable and has no flow-level mouse handlers —
 * which is every node here, because this canvas turns React Flow's own
 * interaction models off in favour of the real button inside each box. The
 * per-node style spreads after that computed value, handing pointer events
 * back so the button is clickable at all. */
const NODE_STYLE: CSSProperties = { pointerEvents: 'all' };

export interface AutomationCanvasProps {
  graph: AutomationGraph;
  /** Hand-placed positions from the document's canvas metadata. Nodes without
   * one are laid out automatically. */
  positions: Record<string, NodePosition>;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  /** Id of the inspector region a node button expands. */
  inspectorId: string;
  runStatusByNode?: ReadonlyMap<string, NodeRunStatus>;
}

const EMPTY_STATUSES: ReadonlyMap<string, NodeRunStatus> = new Map();

function CanvasInner({
  graph,
  positions,
  selectedNodeId,
  onSelectNode,
  inspectorId,
  runStatusByNode = EMPTY_STATUSES,
}: AutomationCanvasProps) {
  const { t } = useT('automations');
  const { setCenter, getZoom } = useReactFlow();

  const incomingByNode = useMemo(() => {
    const grouped = new Map<string, typeof graph.edges>();
    for (const edge of graph.edges) {
      const bucket = grouped.get(edge.target);
      if (bucket) bucket.push(edge);
      else grouped.set(edge.target, [edge]);
    }
    return grouped;
  }, [graph.edges]);

  // Nodes are handed to React Flow in EXECUTION order, so Tab walks the graph
  // the way the engine runs it — DOM order is the tab order, and this canvas
  // switches React Flow's own focus handling off in favour of a real button
  // inside every box.
  const baseNodes = useMemo<Node[]>(
    () =>
      graph.nodes.map((node) => {
        const data: AutomationNodeData = { node };
        return {
          id: node.id,
          type: 'automation',
          position: positions[node.id] ?? { x: 0, y: 0 },
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
          style: NODE_STYLE,
          data,
        };
      }),
    [graph.nodes, positions],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        // One colour for every derived edge: the reference kind is carried by
        // the LINE STYLE, so colour keeps its single documented meaning. A
        // control reference only orders two nodes, so it is drawn dashed.
        style: {
          stroke: FLOW_EDGE_COLORS.flow,
          strokeWidth: FLOW_EDGE_STROKE_WIDTH,
          ...(edge.kind === 'control' && { strokeDasharray: '6 4' }),
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: FLOW_EDGE_MARKER_SIZE,
          height: FLOW_EDGE_MARKER_SIZE,
          color: FLOW_EDGE_COLORS.flow,
        },
        ariaLabel:
          edge.kind === 'data'
            ? t('canvas.edge.data', {
                source: edge.source,
                target: edge.target,
              })
            : t('canvas.edge.control', {
                source: edge.source,
                target: edge.target,
              }),
      })),
    [graph.edges, t],
  );

  // Auto-layout runs only for a document that has not placed every node.
  // Handing the shared layout engine an empty list is its documented no-op, so
  // a fully placed document never loads it at all.
  const needsLayout = graph.nodes.some((node) => !positions[node.id]);
  const { nodes: laidOut, isLayouting } = useElkLayout(
    needsLayout ? baseNodes : [],
    needsLayout ? flowEdges : [],
  );

  const nodes = needsLayout ? laidOut : baseNodes;

  const centerOnNode = useCallback(
    (nodeId: string, zoom: number, duration: number): boolean => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return false;
      // The pan resolves when the animation ends and there is nothing to do
      // afterwards, so it is not awaited.
      void setCenter(
        node.position.x + NODE_WIDTH / 2,
        node.position.y + NODE_HEIGHT / 2,
        { zoom, duration },
      );
      return true;
    },
    [nodes, setCenter],
  );

  const onFocusNode = useCallback(
    (nodeId: string) => {
      // Keep the zoom the author chose and only pan: a keyboard user tabbing
      // through the graph must see the box that just took focus, without the
      // viewport jumping scale under them.
      centerOnNode(nodeId, getZoom(), 200);
    },
    [centerOnNode, getZoom],
  );

  const canvasContext = useMemo<CanvasNodeContextValue>(
    () => ({
      selectedNodeId,
      inspectorId,
      onSelect: onSelectNode,
      onFocusNode,
      runStatusByNode,
      incomingByNode,
    }),
    [
      selectedNodeId,
      inspectorId,
      onSelectNode,
      onFocusNode,
      runStatusByNode,
      incomingByNode,
    ],
  );

  if (graph.nodes.length === 0) {
    return (
      <EmptyState
        icon={Workflow}
        title={t('canvas.empty.title')}
        description={t('canvas.empty.description')}
      />
    );
  }

  return (
    <CanvasNodeProvider value={canvasContext}>
      {graph.hasCycle && (
        <Alert
          variant="warning"
          icon={AlertTriangle}
          title={t('canvas.cycle.title')}
          description={t('canvas.cycle.description')}
          className="mb-3"
        />
      )}
      <div
        // A definite height at mount matters: React Flow measures its frame
        // once, and a `flex-1` box inside a scrolling column can start at
        // zero — which paints an empty canvas that never re-fits.
        className="border-border relative h-full min-h-[24rem] flex-1 overflow-hidden rounded-lg border"
        role="group"
        aria-label={t('canvas.ariaLabel')}
        aria-busy={isLayouting}
      >
        <FlowCanvas
          nodes={nodes}
          edges={flowEdges}
          nodeTypes={NODE_TYPES}
          // Every node box owns a real button, so React Flow must not add a
          // second tab stop around it or bind arrow keys that would fight the
          // page's own scrolling.
          nodesFocusable={false}
          edgesFocusable={false}
          disableKeyboardA11y
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          onPaneClick={() => {
            onSelectNode(null);
          }}
          fitView
          backgroundProps={{ gap: 16 }}
        />
      </div>
    </CanvasNodeProvider>
  );
}

/**
 * The automation canvas: the document, drawn.
 *
 * Nodes come from the document in execution order and edges are DERIVED from
 * the `{{ nodes.<id>.output }}` references between them — the canvas keeps no
 * graph of its own, so what it draws is exactly what the engine will run.
 * Positions come from the document's canvas metadata when an author placed
 * them, and from the shared layout engine when they did not.
 */
export function AutomationCanvas(props: AutomationCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
