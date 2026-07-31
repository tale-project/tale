'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import {
  MarkerType,
  Panel,
  Position,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
} from '@xyflow/react';
import { AlertTriangle, LocateFixed, Workflow } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import {
  FLOW_EDGE_COLORS,
  FLOW_EDGE_MARKER_SIZE,
  FLOW_EDGE_STROKE_WIDTH,
} from '@/app/components/flow/edge-palette';
import { FlowCanvas } from '@/app/components/flow/flow-canvas';
import { useElkLayout } from '@/app/components/flow/layout/use-elk-layout';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

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

/** First-sight zoom when the canvas follows a run's cursor: the step in flight
 * reads at full size, with its neighbours peeking in at the edges. */
const FOLLOW_ZOOM = 1;

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
  onSelectNode: (nodeId: string) => void;
  /** Id of the inspector region a node button expands. */
  inspectorId: string;
  runStatusByNode?: ReadonlyMap<string, NodeRunStatus>;
  /**
   * When set, only these nodes are drawn, with edges kept only where both
   * ends stay visible — the task modal's run dialog hands it the run's
   * visited set, so the strip shows the path taken rather than the whole
   * document. Layout still runs on the FULL graph, so positions hold still
   * as the run reaches more nodes.
   */
  visibleNodeIds?: ReadonlySet<string>;
  /**
   * Node the viewport keeps in sight — the run dialog hands it the stepper's
   * cursor. First sight centers at a readable zoom; afterwards the canvas
   * only pans, and only when the id CHANGES, so a live query ticking does not
   * fight the reader's own panning. While the selection sits elsewhere, an
   * in-canvas pill offers the way back: it recenters here and hands the
   * selection back through {@link onReturnToFollow}.
   */
  followNodeId?: string | null;
  /** Clears the caller's selection so the detail below returns to the
   * followed node. Required for the pill to render at all. */
  onReturnToFollow?: () => void;
  /**
   * Height of the canvas frame. The default is the editor's — tall enough to
   * author in. `compact` fits a short clipped strip for a surface where the
   * graph is orientation rather than subject. `fill` is for a column that
   * owns its height (the run dialog's left pane): a definite strip on small
   * screens, the column's remaining height from `md` up.
   */
  size?: 'default' | 'compact' | 'fill';
}

const EMPTY_STATUSES: ReadonlyMap<string, NodeRunStatus> = new Map();

function CanvasInner({
  graph,
  positions,
  selectedNodeId,
  onSelectNode,
  inspectorId,
  runStatusByNode = EMPTY_STATUSES,
  visibleNodeIds,
  followNodeId,
  onReturnToFollow,
  size = 'default',
}: AutomationCanvasProps) {
  const { t } = useT('automations');
  const { setCenter, getZoom, fitView } = useReactFlow();
  // React Flow's own readiness: `onInit` fires once the pane is mounted and
  // its zoom behaviour is live, which is the moment viewport commands start
  // landing instead of being dropped.
  const [flowReady, setFlowReady] = useState(false);
  // The pane React Flow measured, straight from its store. `useNodesInitialized`
  // is NOT the signal to wait for here — this canvas gives every node a fixed
  // box and centers from that constant, and the hook stays false in a real
  // browser long after the graph is on screen (measured against it, the follow
  // simply never ran).
  const paneWidth = useStore((state) => state.width);
  const paneHeight = useStore((state) => state.height);

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

  // The filter cuts AFTER layout, so a hidden node still holds its place —
  // the visible ones never re-flow when the run reaches another node, they
  // only gain a neighbour.
  const visibleNodes = useMemo(
    () =>
      visibleNodeIds === undefined
        ? nodes
        : nodes.filter((node) => visibleNodeIds.has(node.id)),
    [nodes, visibleNodeIds],
  );
  const visibleEdges = useMemo(
    () =>
      visibleNodeIds === undefined
        ? flowEdges
        : flowEdges.filter(
            (edge) =>
              visibleNodeIds.has(edge.source) &&
              visibleNodeIds.has(edge.target),
          ),
    [flowEdges, visibleNodeIds],
  );

  const centerOnNode = useCallback(
    (nodeId: string, zoom: number, duration: number): boolean => {
      const node = visibleNodes.find((candidate) => candidate.id === nodeId);
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
    [visibleNodes, setCenter],
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

  // Where the followed box actually sits. Keyed by POSITION, not just id: auto
  // layout resolves asynchronously, so the first sight of a followed node is
  // usually at a placeholder position that moves once ELK answers — a
  // recenter keyed on the id alone would frame that placeholder and then hold
  // the viewport over empty canvas forever.
  const followPosition = useMemo(() => {
    if (followNodeId == null) return null;
    return (
      visibleNodes.find((candidate) => candidate.id === followNodeId)
        ?.position ?? null
    );
  }, [followNodeId, visibleNodes]);

  // Follow the run: recenter when the followed step CHANGES, when its box
  // moves, or when the pane it is framed in resizes — and on nothing else, so
  // the live-query ticks that re-project the run constantly leave the viewport
  // alone rather than snapping it back mid-pan under the reader.
  const followedRef = useRef<string | null>(null);
  const fellBackToFitRef = useRef(false);
  useEffect(() => {
    // React Flow drops viewport commands until its pane is mounted, and the
    // drop is SILENT — without this gate the first follow is swallowed, the
    // step is recorded as framed, and the canvas keeps its identity transform
    // (nodes off-frame, an apparently empty strip).
    if (!flowReady || paneWidth === 0 || paneHeight === 0) return;
    if (followNodeId == null) return;
    if (followPosition === null) {
      // The cursor's box is not drawable — it fell outside the visible set. The
      // whole-graph fit is off while following, so fit the drawn path once
      // rather than leaving the viewport parked on nothing.
      if (visibleNodes.length > 0 && !fellBackToFitRef.current) {
        fellBackToFitRef.current = true;
        void fitView({ padding: 0.2, duration: 0 });
      }
      return;
    }
    // The pane's size belongs in the key: React Flow centers against the size
    // it has measured SO FAR, and this canvas grows into its column after
    // mount — a framing computed against the pre-growth pane leaves the step
    // half a pane off centre for the rest of the run.
    const followKey = `${followNodeId}@${String(followPosition.x)},${String(followPosition.y)}#${String(paneWidth)}x${String(paneHeight)}`;
    if (followedRef.current === followKey) return;
    const first = followedRef.current === null;
    centerOnNode(
      followNodeId,
      first ? FOLLOW_ZOOM : getZoom(),
      first ? 0 : 200,
    );
    followedRef.current = followKey;
  }, [
    flowReady,
    paneWidth,
    paneHeight,
    followNodeId,
    followPosition,
    visibleNodes.length,
    centerOnNode,
    fitView,
    getZoom,
  ]);

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
        className={cn(
          'border-border relative overflow-hidden rounded-lg border',
          // A definite height at mount matters: React Flow measures its frame
          // once, and a `flex-1` box inside a scrolling column can start at
          // zero — which paints an empty canvas that never re-fits.
          size === 'compact'
            ? 'h-44 shrink-0'
            : size === 'fill'
              ? 'h-64 shrink-0 md:h-auto md:min-h-[16rem] md:flex-1 md:shrink'
              : 'h-full min-h-[24rem] flex-1',
        )}
        role="group"
        aria-label={t('canvas.ariaLabel')}
        aria-busy={isLayouting}
      >
        <FlowCanvas
          nodes={visibleNodes}
          edges={visibleEdges}
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
          // While following, the follow effect frames the viewport itself —
          // the whole-graph initial fit would only flash a different framing
          // for it to override.
          fitView={followNodeId == null}
          onInit={() => setFlowReady(true)}
          backgroundProps={{ gap: 16 }}
        >
          {followNodeId != null &&
            onReturnToFollow !== undefined &&
            selectedNodeId !== followNodeId && (
              <Panel position="top-right">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={LocateFixed}
                  onClick={() => {
                    onReturnToFollow();
                    centerOnNode(followNodeId, getZoom(), 200);
                  }}
                >
                  {t('canvas.backToCurrent')}
                </Button>
              </Panel>
            )}
        </FlowCanvas>
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
