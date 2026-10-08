'use client';

import {
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import { ListOrdered, Workflow } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type TouchEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useMediaQuery } from '../../hooks/use-media-query';
import { usePrefersReducedMotion } from '../../hooks/use-prefers-reduced-motion';
import { useSwapFade } from '../../hooks/use-swap-fade';
import { useT } from '../../i18n/client';
import { cn } from '../../lib/cn';
import { Alert } from '../feedback/alert';
import type { IssueCounts } from '../feedback/issue-summary';
import { SkeletonBox } from '../feedback/skeleton';
import { Skeletonize } from '../feedback/skeleton-context';
import { Button } from '../primitives/button';
import { describeFlowGraph, flowListFormat } from './describe';
import {
  easeOutQuint,
  FLOW_VIEWPORT_DURATION,
  FlowCanvas,
  type FlowFitPolicy,
} from './flow-canvas';
import { FlowLegend, type FlowLegendEntry } from './flow-legend';
import { FlowStepList } from './flow-step-list';
import {
  FLOW_NAVIGATION_KEYS,
  flowNeighbour,
  flowTabStop,
} from './interaction/navigation';
import { useFlowLayout } from './layout/use-flow-layout';
import { FlowEdgeMarkers } from './render/edge-markers';
import { FlowEntryNodeView } from './render/entry-node';
import { FlowExitNodeView } from './render/exit-node';
import {
  FlowRenderProvider,
  type FlowRenderContextValue,
} from './render/flow-render-context';
import { FlowGateNodeView } from './render/gate-node';
import { FlowGroupFrameView, type FlowFrameData } from './render/group-frame';
import {
  FlowRoutedEdgeView,
  type FlowRoutedEdgeData,
} from './render/routed-edge';
import { FlowStepNodeView } from './render/step-node';
import type { FlowEdge, FlowGraph, FlowLayout, FlowRect } from './types';
import { validateFlowGraph } from './validate-graph';

export type FlowView = 'chart' | 'list';

export interface WorkflowCanvasProps {
  graph: FlowGraph;
  'aria-label': string;
  /** What the graph is a picture of; a change is another picture (laid
   *  out afresh, swapped in with a fade), the same key with a changed graph
   *  a live relayout. */
  layoutKey: string;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Bring this node into view, with the least pan. */
  revealId?: string | null;
  /** Problem counts by node id (Start, End and gates included). */
  issues?: ReadonlyMap<string, IssueCounts>;
  /** The region a node's button opens (an inspector): nodes then say
   *  whether it is open (`aria-expanded`) instead of `aria-pressed`. */
  controlsId?: string;
  /** Controlled view; the built-in chart/list toggle is hidden. */
  view?: FlowView;
  onViewChange?: (view: FlowView) => void;
  /** A bordered frame for a page (a run's page); off for a workbench. */
  framed?: boolean;
  /** `page-scroll`: on a touch screen one finger scrolls the page and two
   *  move the chart. @default framed ? 'page-scroll' : 'pan' */
  touchPolicy?: 'pan' | 'page-scroll';
  /** @default 'auto' */
  fitPolicy?: FlowFitPolicy;
  /** The canvas's top-left corner (a view switch). */
  topStart?: ReactNode;
  /** The canvas's top-right corner (its verbs). */
  topEnd?: ReactNode;
  /** The bottom-centre toolbar. */
  toolbar?: ReactNode;
  /** Extra buttons in the corner cluster, after zoom, reset and legend. */
  cornerActions?: ReactNode;
  /** The legend's lines; no legend button without them. */
  legend?: readonly FlowLegendEntry[];
  /** Shown instead of the chart when the graph has no nodes. */
  empty?: ReactNode;
  /** Shown above the chart (a warning about the graph). */
  notice?: ReactNode;
  className?: string;
  /** Every finished layout (tests, demos). */
  onLayout?: (layout: FlowLayout) => void;
}

const NODE_TYPES = {
  step: FlowStepNodeView,
  entry: FlowEntryNodeView,
  exit: FlowExitNodeView,
  gate: FlowGateNodeView,
  frame: FlowGroupFrameView,
};
const EDGE_TYPES = { routed: FlowRoutedEdgeView };

const NO_ISSUES: ReadonlyMap<string, IssueCounts> = new Map();
const VIEW_STORAGE_KEY = 'tale:flow-view';
const TOUCH_HINT_KEY = 'tale:flow-touch-hint';
/** Room left between a box brought into view and the frame's edge. */
const REVEAL_MARGIN = 24;
/** How long the two-finger hint stays. */
const TOUCH_HINT_MS = 1_500;

/** The frame node behind a group's members. */
const frameNodeId = (groupId: string) => `__frame:${groupId}`;

/**
 * How far to move the span `[start, end]` so it shows inside `[min, max]`:
 * nothing when it already does, otherwise the least shift that leaves the
 * margin — aligned to its start when the span is longer than the room.
 */
function revealShift(start: number, end: number, min: number, max: number) {
  if (start >= min && end <= max) return 0;
  const lo = min + REVEAL_MARGIN;
  const hi = max - REVEAL_MARGIN;
  if (end - start > hi - lo) return lo - start;
  if (end > hi) return hi - end;
  return lo - start;
}

function readStoredView(): FlowView | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === 'list' || stored === 'chart' ? stored : null;
  } catch (error) {
    console.warn('Flow canvas could not read the stored view', error);
    return null;
  }
}

const relative = (rect: FlowRect, origin: FlowRect): FlowRect => ({
  x: rect.x - origin.x,
  y: rect.y - origin.y,
  width: rect.width,
  height: rect.height,
});

/** React Flow's nodes for a layout: frames behind, boxes on top. */
function toFlowNodes(graph: FlowGraph, layout: FlowLayout): Node[] {
  const nodes: Node[] = [];
  for (const group of graph.groups ?? []) {
    const frame = layout.groups[group.id];
    if (frame === undefined) continue;
    const data: FlowFrameData = {
      group,
      header: relative(frame.header, frame),
      members: group.members.flatMap((id) => {
        const rect = layout.nodes[id];
        return rect ? [relative(rect, frame)] : [];
      }),
    };
    nodes.push({
      id: frameNodeId(group.id),
      type: 'frame',
      position: { x: frame.x, y: frame.y },
      width: frame.width,
      height: frame.height,
      zIndex: -1,
      selectable: false,
      focusable: false,
      draggable: false,
      style: { pointerEvents: 'none' },
      domAttributes: { 'aria-roledescription': undefined },
      data,
    });
  }
  for (const node of graph.nodes) {
    const rect = layout.nodes[node.id];
    if (rect === undefined) continue;
    nodes.push({
      id: node.id,
      type: node.kind,
      position: { x: rect.x, y: rect.y },
      width: rect.width,
      height: rect.height,
      selectable: false,
      focusable: false,
      draggable: false,
      // React Flow turns pointer events off on a node that is neither
      // selectable nor draggable; the box is a real button and needs them.
      style: { pointerEvents: 'all' },
      domAttributes: { 'aria-roledescription': undefined },
      data: { node },
    });
  }
  return nodes;
}

function toFlowEdges(
  graph: FlowGraph,
  layout: FlowLayout,
  baseId: string,
  labelOf: (edge: FlowEdge) => string | undefined,
): Edge[] {
  const edges: Edge[] = [];
  for (const edge of graph.edges) {
    if (edge.layoutOnly) continue;
    const route = layout.edges[edge.id];
    if (
      route === undefined ||
      layout.nodes[edge.source] === undefined ||
      layout.nodes[edge.target] === undefined
    )
      continue;
    const text = labelOf(edge);
    const data: FlowRoutedEdgeData = {
      edge,
      points: route.points,
      baseId,
      ...(text && route.label ? { label: { text, rect: route.label } } : {}),
    };
    edges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'routed',
      selectable: false,
      focusable: false,
      // The nodes say what the lines mean; the lines stay out of the
      // accessibility tree (React Flow names each in English).
      domAttributes: { 'aria-hidden': true },
      data,
    });
  }
  return edges;
}

/** A column of placeholder boxes in the real frame while the first layout
 *  is computed. */
function ArrangingSkeleton({ label }: { label: string }) {
  return (
    <Skeletonize
      loading
      label={label}
      className="flex size-full flex-col items-center gap-16 overflow-hidden pt-12"
    >
      {[160, 88, 108, 88, 120].map((height, index) => (
        <SkeletonBox asChild key={index}>
          <div
            className="border-border w-72 shrink-0 rounded-lg border"
            style={{ height }}
          />
        </SkeletonBox>
      ))}
    </Skeletonize>
  );
}

function WorkflowCanvasInner({
  graph,
  'aria-label': ariaLabel,
  layoutKey,
  selectedId = null,
  onSelect,
  revealId = null,
  issues = NO_ISSUES,
  controlsId,
  view: controlledView,
  onViewChange,
  framed = false,
  touchPolicy,
  fitPolicy = 'auto',
  topStart,
  topEnd,
  toolbar,
  cornerActions,
  legend,
  empty,
  notice,
  className,
  onLayout,
}: WorkflowCanvasProps) {
  const { t } = useT('flow');
  const { t: tIssues } = useT('issues');
  const { i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
  const baseId = useId();
  const helpId = `${baseId}-help`;
  const reduced = usePrefersReducedMotion();
  const narrow = useMediaQuery('(max-width: 23.99rem)');
  const coarse = useMediaQuery('(pointer: coarse)');
  const { getViewport, setViewport } = useReactFlow();

  // A host's adapter bug shows in development, without taking the page down.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    try {
      validateFlowGraph(graph);
    } catch (error) {
      console.error('WorkflowCanvas was given a graph it cannot draw', error);
    }
  }, [graph]);

  // The view: the host's, else the reader's last choice, else the chart
  // (the list on a phone too narrow for one).
  const [storedView, setStoredView] = useState<FlowView | null>(readStoredView);
  const view: FlowView =
    controlledView ?? storedView ?? (narrow ? 'list' : 'chart');
  const changeView = (next: FlowView) => {
    if (controlledView === undefined) {
      setStoredView(next);
      try {
        window.localStorage.setItem(VIEW_STORAGE_KEY, next);
      } catch (error) {
        console.warn('Flow canvas could not store the view', error);
      }
    }
    onViewChange?.(next);
  };

  const edgeLabel = useCallback(
    (edge: FlowEdge) =>
      edge.kind === 'branch-yes'
        ? t('branch.yes')
        : edge.kind === 'branch-no'
          ? t('branch.no')
          : undefined,
    [t],
  );
  const { layout, status } = useFlowLayout(graph, { layoutKey, edgeLabel });

  // Once per layout, whatever the identity of the host's callback.
  const onLayoutRef = useRef(onLayout);
  onLayoutRef.current = onLayout;
  useEffect(() => {
    if (layout) onLayoutRef.current?.(layout);
  }, [layout]);

  const words = useMemo(
    () =>
      describeFlowGraph(graph, {
        t,
        tIssues,
        list: flowListFormat(locale),
        issues,
      }),
    [graph, t, tIssues, locale, issues],
  );

  const nodes = useMemo(
    () => (layout ? toFlowNodes(graph, layout) : []),
    [graph, layout],
  );
  const edges = useMemo(
    () => (layout ? toFlowEdges(graph, layout, baseId, edgeLabel) : []),
    [graph, layout, baseId, edgeLabel],
  );

  const frameRef = useRef<HTMLDivElement>(null);
  const [lastFocused, setLastFocused] = useState<string | null>(null);
  const tabStopId = flowTabStop(graph, selectedId, lastFocused);

  const buttonOf = useCallback(
    (id: string) =>
      frameRef.current?.querySelector<HTMLButtonElement>(
        `[data-flow-node="${CSS.escape(id)}"]`,
      ) ?? null,
    [],
  );

  // Bring a box fully into the frame with the least pan, at the zoom the
  // reader chose. Measured on the page, so it holds even right after the
  // frame changed size.
  const reveal = useCallback(
    (id: string) => {
      const frame = frameRef.current;
      const box = buttonOf(id);
      if (frame === null || box === null) return;
      const bounds = frame.getBoundingClientRect();
      const rect = box.getBoundingClientRect();
      const dx = revealShift(rect.left, rect.right, bounds.left, bounds.right);
      const dy = revealShift(rect.top, rect.bottom, bounds.top, bounds.bottom);
      if (dx === 0 && dy === 0) return;
      const viewport = getViewport();
      void setViewport(
        { x: viewport.x + dx, y: viewport.y + dy, zoom: viewport.zoom },
        {
          duration: reduced ? 0 : FLOW_VIEWPORT_DURATION.reveal,
          ease: easeOutQuint,
          interpolate: 'linear',
        },
      );
    },
    [buttonOf, getViewport, setViewport, reduced],
  );

  useEffect(() => {
    if (revealId === null || layout === null || view !== 'chart')
      return undefined;
    // After React Flow has placed the box.
    const frame = requestAnimationFrame(() => reveal(revealId));
    return () => cancelAnimationFrame(frame);
  }, [revealId, layout, view, reveal]);

  const context = useMemo<FlowRenderContextValue>(
    () => ({
      baseId,
      selectedId,
      tabStopId,
      controlsId,
      issues,
      names: words.names,
      descriptions: words.descriptions,
      strips: words.strips,
      onActivate: (id) => onSelect?.(selectedId === id ? null : id),
      onKeyDown: (id, event: KeyboardEvent<HTMLButtonElement>) => {
        const key = FLOW_NAVIGATION_KEYS[event.key];
        if (key === undefined || layout === null) return;
        event.preventDefault();
        const next = flowNeighbour(graph, layout, id, key);
        // The canvas pans the box into view itself; the browser's own
        // scroll-into-view would shift the clipped frame instead.
        if (next !== null) buttonOf(next)?.focus({ preventScroll: true });
      },
      onFocusNode: (id, event: FocusEvent<HTMLButtonElement>) => {
        setLastFocused(id);
        // A mouse press focuses the button too, and panning then would drag
        // the box out from under the pointer mid-click — follow keyboard
        // focus only.
        if (event.currentTarget.matches(':focus-visible')) reveal(id);
      },
    }),
    [
      baseId,
      selectedId,
      tabStopId,
      controlsId,
      issues,
      words,
      onSelect,
      layout,
      graph,
      buttonOf,
      reveal,
    ],
  );

  // A new picture swaps in with a fade, as another item in the same place.
  const swapRef = useSwapFade<HTMLDivElement>(layoutKey);

  const pageScroll =
    (touchPolicy ?? (framed ? 'page-scroll' : 'pan')) === 'page-scroll' &&
    coarse;
  const [touchHint, setTouchHint] = useState(false);
  const onTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (!pageScroll || event.touches.length !== 1 || touchHint) return;
    try {
      if (window.sessionStorage.getItem(TOUCH_HINT_KEY) !== null) return;
      window.sessionStorage.setItem(TOUCH_HINT_KEY, '1');
    } catch (error) {
      console.warn('Flow canvas could not remember the touch hint', error);
    }
    setTouchHint(true);
  };
  useEffect(() => {
    if (!touchHint) return undefined;
    const timer = setTimeout(() => setTouchHint(false), TOUCH_HINT_MS);
    return () => clearTimeout(timer);
  }, [touchHint]);

  const viewToggle =
    controlledView === undefined ? (
      <Button
        size="icon"
        variant="secondary"
        title={t(view === 'chart' ? 'controls.showList' : 'controls.showChart')}
        tooltipSide="right"
        onClick={() => changeView(view === 'chart' ? 'list' : 'chart')}
      >
        {view === 'chart' ? (
          <ListOrdered className="size-4" />
        ) : (
          <Workflow className="size-4" />
        )}
      </Button>
    ) : null;

  if (graph.nodes.length === 0 && empty !== undefined) {
    return <div className={cn('flex h-full flex-col', className)}>{empty}</div>;
  }

  const frameClass = cn(
    'relative min-h-48 flex-1 overflow-hidden',
    framed && 'border-border min-h-[24rem] rounded-lg border',
  );

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      {notice}
      {view === 'list' ? (
        <div ref={swapRef} className={cn(frameClass, 'overflow-y-auto')}>
          <div className="flex items-center gap-1 px-3 pt-3">
            {topStart}
            <span className="ml-auto flex items-center gap-1">
              {topEnd}
              {viewToggle}
            </span>
          </div>
          <FlowStepList
            graph={graph}
            aria-label={ariaLabel}
            selectedId={selectedId}
            onSelect={onSelect}
            issues={issues}
            controlsId={controlsId}
          />
        </div>
      ) : (
        <div
          ref={frameRef}
          role="group"
          aria-roledescription={t('canvas.roleDescription')}
          aria-label={ariaLabel}
          aria-describedby={helpId}
          aria-busy={layout === null}
          data-flow-engine={layout?.engine}
          className={frameClass}
          onTouchMove={onTouchMove}
        >
          <span id={helpId} hidden>
            {t('canvas.keyboardHelp')}
          </span>
          <FlowEdgeMarkers baseId={baseId} />
          {layout === null ? (
            <ArrangingSkeleton label={t('canvas.arranging')} />
          ) : (
            <div
              ref={swapRef}
              className="animate-in fade-in size-full duration-[var(--duration-standard)] ease-[var(--ease-out-quint)] motion-reduce:animate-none"
            >
              <FlowRenderProvider value={context}>
                <FlowCanvas
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={NODE_TYPES}
                  edgeTypes={EDGE_TYPES}
                  fitPolicy={fitPolicy}
                  fitKey={layout.signature}
                  minZoom={0.25}
                  maxZoom={1.5}
                  // Every box is a real button holding the chart's one Tab
                  // stop: React Flow's own focus and keys stay off.
                  nodesFocusable={false}
                  edgesFocusable={false}
                  disableKeyboardA11y
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={false}
                  panOnDrag={!pageScroll}
                  preventScrolling={!pageScroll}
                  zoomOnScroll={!pageScroll}
                  onPaneClick={() => {
                    if (selectedId !== null) onSelect?.(null);
                  }}
                  backgroundProps={{ gap: 16 }}
                  centerActions={toolbar}
                  topStartActions={topStart}
                  topEndActions={topEnd}
                  cornerActions={
                    viewToggle || legend || cornerActions ? (
                      <>
                        {legend && <FlowLegend entries={legend} />}
                        {viewToggle}
                        {cornerActions}
                      </>
                    ) : undefined
                  }
                />
              </FlowRenderProvider>
            </div>
          )}
          {status === 'failed' && (
            <div className="pointer-events-none absolute inset-x-3 top-3 flex justify-center">
              <Alert
                variant="warning"
                description={t('canvas.arrangeFailed')}
                className="pointer-events-auto max-w-lg"
              />
            </div>
          )}
          {touchHint && (
            <div
              role="status"
              className="animate-in fade-in bg-popover text-popover-foreground ring-border pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-sm shadow-md ring-1 duration-[var(--duration-standard)] motion-reduce:animate-none"
            >
              {t('canvas.touchHint')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A workflow drawn from its data, laid out automatically: Start above, End
 * below, every step from its own words, conditions as pills with Yes and
 * No, frames round iterating steps, and lines along routes that never cross
 * a box. Nobody places a node — the same graph always draws the same
 * picture, and a graph that changes on screen keeps every row in order.
 *
 * The chart is one Tab stop: arrows follow the lines and the rows, Home and
 * End jump to Start and End, Enter or Space opens a node. The List view
 * says the same as text. Layout runs in a worker; until the first one
 * lands the frame shows a skeleton column, then the chart fades in.
 */
export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
