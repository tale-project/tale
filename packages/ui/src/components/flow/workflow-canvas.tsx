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
import { flowCompareFaces, flowCompareLabels } from './compare/compare';
import { describeFlowGraph, flowListFormat } from './describe';
import {
  easeOutQuint,
  FLOW_TOUCH_TARGET,
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
import {
  FLOW_DURATION,
  FLOW_MOVE_TRANSITION,
  FLOW_RING_TOTAL,
} from './motion/flow-motion';
import {
  useLayoutTransition,
  type FlowPicture,
  type FlowTransitionPhase,
  type FlowTransitionPlan,
} from './motion/use-layout-transition';
import {
  highlightForBranch,
  highlightForIncident,
  sameFlowHighlight,
  type FlowHighlight,
  type FlowPath,
} from './paths/highlight';
import { flowStateAt, flowStateFromOverlay } from './playback/derive-state';
import type {
  FlowCompareOverlay,
  FlowPlayback,
  FlowRunOverlay,
} from './playback/types';
import { FlowEdgeMarkers } from './render/edge-markers';
import { FlowEntryNodeView } from './render/entry-node';
import { FlowExitNodeView } from './render/exit-node';
import {
  FlowRenderProvider,
  type FlowRenderContextValue,
} from './render/flow-render-context';
import { FlowGateNodeView } from './render/gate-node';
import { FlowGroupFrameView, type FlowFrameData } from './render/group-frame';
import { flowFrameCounters, flowLooks, looksSignature } from './render/looks';
import { FlowPulseLayer } from './render/pulse-layer';
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
   *  a live relayout (it glides to its new layout). */
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
  /** A run shown without time: where each node ended. */
  overlay?: FlowRunOverlay;
  /** A run with time, at the host's moment `t`; wins over `overlay`. */
  playback?: FlowPlayback;
  /**
   * Two runs on one chart, in place of a run: each box's foot shows how it
   * went in each ("A ✓ 1.2 s · B ✕ Failed"), a box where they differ is
   * ringed with a "Differs" glyph, one a run's version lacks is dashed, and
   * a line only one run took says so. Wins over `overlay` and `playback`.
   */
  compare?: FlowCompareOverlay;
  /**
   * When a run failed, bring the way it took to the first failure
   * forward and step back from the rest, until a highlight takes over.
   * @default true
   */
  focusFailure?: boolean;
  /** The possible paths: a pointer resting on a condition or on a Yes or
   *  No label then highlights the paths through it. An empty list (the
   *  host could not list them) highlights what lies below the branch. */
  paths?: readonly FlowPath[];
  /** The host's highlight (a pinned path, the nodes that end a run when
   *  they fail). It wins over the canvas's own; `null` leaves the
   *  canvas's own hover and focus highlights. */
  highlight?: FlowHighlight | null;
  /** The canvas's own highlight changed (a pointer or the keyboard). */
  onHighlightChange?: (highlight: FlowHighlight | null) => void;
  /** Nodes that changed outside this tab (another window, a coding
   *  agent): ringed once when `key` changes, after their relayout. */
  changed?: { ids: ReadonlySet<string>; key: string | number };
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
/** How long a pointer rests on a condition or a branch before its paths
 *  light up: passing over on the way elsewhere lights nothing. */
const HOVER_INTENT_MS = 150;

/** The frame node behind a group's members. */
const frameNodeId = (groupId: string) => `__frame:${groupId}`;
/** A part leaving with a relayout, beside the one that replaces it. */
const leavingId = (id: string) => `${id}~exit`;

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

/**
 * The graph to draw on `layout`: the one it was laid out for, each node,
 * line and frame in its newest words. While a relayout is under way a
 * removed node stays where it was (it leaves with the new layout) and a new
 * one waits for its place.
 */
function shownGraph(graph: FlowGraph, laidOut: FlowGraph | null): FlowGraph {
  if (laidOut === null || laidOut === graph) return graph;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const groups = new Map(
    (graph.groups ?? []).map((group) => [group.id, group]),
  );
  return {
    nodes: laidOut.nodes.map((node) => nodes.get(node.id) ?? node),
    edges: laidOut.edges.map((edge) => edges.get(edge.id) ?? edge),
    groups: (laidOut.groups ?? []).map(
      (group) => groups.get(group.id) ?? group,
    ),
  };
}

/** React Flow's nodes for a layout: frames behind, boxes on top, and while
 *  a relayout plays, what leaves at its old place. */
function toFlowNodes(
  graph: FlowGraph,
  layout: FlowLayout,
  plan: FlowTransitionPlan | null,
  phase: FlowTransitionPhase | null,
): Node[] {
  const nodes: Node[] = [];
  const glide = (moving: boolean): Record<string, string> =>
    plan !== null && moving ? { transition: FLOW_MOVE_TRANSITION } : {};
  const frameNode = (
    id: string,
    data: FlowFrameData,
    rect: FlowRect,
    style: Record<string, string>,
  ): Node => ({
    id,
    type: 'frame',
    position: { x: rect.x, y: rect.y },
    width: rect.width,
    height: rect.height,
    zIndex: -1,
    selectable: false,
    focusable: false,
    draggable: false,
    style: { pointerEvents: 'none', ...style },
    domAttributes: { 'aria-roledescription': undefined },
    data,
  });
  if (plan !== null && phase === 'exit')
    for (const { group, rect } of plan.framesLeaving)
      nodes.push(
        frameNode(
          leavingId(frameNodeId(group.id)),
          {
            group,
            header: relative(rect.header, rect),
            members: [],
            phase: 'exit',
          },
          rect,
          {},
        ),
      );
  for (const group of graph.groups ?? []) {
    const frame = layout.groups[group.id];
    if (frame === undefined) continue;
    const entering = plan?.framesEntering.has(group.id) === true;
    nodes.push(
      frameNode(
        frameNodeId(group.id),
        {
          group,
          header: relative(frame.header, frame),
          members: group.members.flatMap((id) => {
            const rect = layout.nodes[id];
            return rect ? [relative(rect, frame)] : [];
          }),
          ...(entering ? { phase: 'enter' as const } : {}),
        },
        frame,
        glide(plan?.framesMoving.has(group.id) === true),
      ),
    );
  }
  for (const node of graph.nodes) {
    const rect = layout.nodes[node.id];
    if (rect === undefined) continue;
    const entering = plan?.entering.has(node.id) === true;
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
      style: {
        pointerEvents: 'all',
        ...glide(plan?.moving.has(node.id) === true),
      },
      domAttributes: { 'aria-roledescription': undefined },
      data: entering ? { node, phase: 'enter' } : { node },
    });
  }
  if (plan !== null && phase === 'exit')
    for (const { node, rect } of plan.leaving)
      nodes.push({
        id: node.id,
        type: node.kind,
        position: { x: rect.x, y: rect.y },
        width: rect.width,
        height: rect.height,
        selectable: false,
        focusable: false,
        draggable: false,
        style: { pointerEvents: 'none' },
        domAttributes: { 'aria-roledescription': undefined },
        data: { node, phase: 'exit' },
      });
  return nodes;
}

function toFlowEdges(
  graph: FlowGraph,
  layout: FlowLayout,
  baseId: string,
  labelOf: (edge: FlowEdge) => string | undefined,
  plan: FlowTransitionPlan | null,
  phase: FlowTransitionPhase | null,
): Edge[] {
  const edges: Edge[] = [];
  const edgeOf = (id: string, edge: FlowEdge, data: FlowRoutedEdgeData) => ({
    id,
    source: edge.source,
    target: edge.target,
    type: 'routed',
    selectable: false,
    focusable: false,
    // The nodes say what the lines mean; the lines stay out of the
    // accessibility tree (React Flow names each in English).
    domAttributes: { 'aria-hidden': true as const },
    data,
  });
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
    edges.push(
      edgeOf(edge.id, edge, {
        edge,
        points: route.points,
        baseId,
        ...(text && route.label ? { label: { text, rect: route.label } } : {}),
        ...(plan?.edgesEntering.has(edge.id) ? { phase: 'enter' } : {}),
      }),
    );
  }
  if (plan !== null && phase === 'exit') {
    const present = new Set([
      ...graph.nodes
        .filter((node) => layout.nodes[node.id] !== undefined)
        .map((node) => node.id),
      ...plan.leaving.map(({ node }) => node.id),
    ]);
    for (const { edge, points, label } of plan.edgesLeaving) {
      if (!present.has(edge.source) || !present.has(edge.target)) continue;
      const text = labelOf(edge);
      edges.push(
        edgeOf(leavingId(edge.id), edge, {
          edge,
          points,
          baseId,
          ...(text && label ? { label: { text, rect: label } } : {}),
          phase: 'exit',
        }),
      );
    }
  }
  return edges;
}

/** Keeps the value from the last render while its signature is the same,
 *  so a playback frame that changed nothing re-renders nothing. */
function useStable<T>(value: T, signature: string): T {
  const kept = useRef<{ value: T; signature: string } | null>(null);
  if (kept.current === null || kept.current.signature !== signature)
    kept.current = { value, signature };
  return kept.current.value;
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
  overlay,
  playback: playbackProp,
  compare,
  focusFailure = true,
  paths,
  highlight,
  onHighlightChange,
  changed,
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
  const twoRuns =
    compare !== undefined &&
    (overlay !== undefined || playbackProp !== undefined);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' || !twoRuns) return;
    console.warn(
      'WorkflowCanvas shows a comparison in place of a run: leave out `overlay` and `playback` with `compare`.',
    );
  }, [twoRuns]);
  // A comparison takes the place of a run.
  const playback = compare === undefined ? playbackProp : undefined;
  const compareLabels = useMemo(
    () => (compare === undefined ? null : flowCompareLabels(compare, t)),
    [compare, t],
  );

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

  // A Yes or No line only one compared run took says which on its pill,
  // so the layout leaves the room for those words.
  const edgeLabel = useCallback(
    (edge: FlowEdge) => {
      const branch =
        edge.kind === 'branch-yes'
          ? t('branch.yes')
          : edge.kind === 'branch-no'
            ? t('branch.no')
            : undefined;
      const only = compare?.edges[edge.id];
      if (
        branch === undefined ||
        compareLabels === null ||
        (only !== 'a' && only !== 'b')
      )
        return branch;
      return `${branch} · ${t('compare.only', { label: compareLabels[only] })}`;
    },
    [t, compare, compareLabels],
  );
  const {
    layout,
    status,
    graph: laidOut,
    settled,
  } = useFlowLayout(graph, { layoutKey, edgeLabel });
  const shown = useMemo(() => shownGraph(graph, laidOut), [graph, laidOut]);
  const picture = useMemo<FlowPicture | null>(
    () => (layout === null ? null : { graph: shown, layout }),
    [shown, layout],
  );
  const { plan, phase } = useLayoutTransition({
    picture,
    layoutKey,
    enabled: !reduced,
  });

  // Once per layout, whatever the identity of the host's callback.
  const onLayoutRef = useRef(onLayout);
  onLayoutRef.current = onLayout;
  useEffect(() => {
    if (layout) onLayoutRef.current?.(layout);
  }, [layout]);

  // The run shown, at the host's moment; none while two are compared.
  const run = useMemo(
    () =>
      compare !== undefined
        ? null
        : playback
          ? flowStateAt(shown, playback.timeline, playback.t)
          : overlay
            ? flowStateFromOverlay(shown, overlay)
            : null,
    [shown, playback, overlay, compare],
  );
  const compareFaces = useMemo(
    () => (compare === undefined ? null : flowCompareFaces(shown, compare, t)),
    [shown, compare, t],
  );
  // A line only one compared run took, with no pill to say so, says it
  // when a pointer rests on it.
  const edgeNotes = useMemo(() => {
    const notes = new Map<string, string>();
    if (compare === undefined || compareLabels === null) return notes;
    for (const edge of shown.edges) {
      const only = compare.edges[edge.id];
      if (only !== 'a' && only !== 'b') continue;
      if (edge.kind === 'branch-yes' || edge.kind === 'branch-no') continue;
      notes.set(edge.id, t('compare.only', { label: compareLabels[only] }));
    }
    return notes;
  }, [shown, compare, compareLabels, t]);

  // The canvas's own highlight: a pointer or the keyboard on a node (its
  // lines only), or a pointer resting on a condition or a branch (its
  // paths). A host's highlight wins; a failed run's way to its failure
  // stands in when nothing else is shown.
  const [own, setOwnState] = useState<FlowHighlight | null>(null);
  const ownRef = useRef(own);
  ownRef.current = own;
  const onHighlightChangeRef = useRef(onHighlightChange);
  onHighlightChangeRef.current = onHighlightChange;
  const setOwn = useCallback((next: FlowHighlight | null) => {
    if (sameFlowHighlight(ownRef.current, next)) return;
    ownRef.current = next;
    setOwnState(next);
    onHighlightChangeRef.current?.(next);
  }, []);
  const failure =
    focusFailure && run?.failure !== undefined ? run.failure : null;
  const failureHighlight = useMemo<FlowHighlight | null>(
    () =>
      failure === null
        ? null
        : { nodes: failure.pathNodes, edges: failure.pathEdges },
    [failure],
  );
  const ownPath = own !== null && own.quietRest !== false ? own : null;
  const incident = own !== null && own.quietRest === false ? own : null;
  const primary = highlight ?? ownPath ?? failureHighlight;
  // Why each node outside the host's highlight steps back.
  const reasons = useMemo(() => {
    if (primary?.reasons === undefined) return undefined;
    const quiet: Record<string, string> = {};
    for (const [id, reason] of Object.entries(primary.reasons))
      if (!primary.nodes.has(id)) quiet[id] = reason;
    return quiet;
  }, [primary]);

  const computedWords = useMemo(
    () =>
      describeFlowGraph(shown, {
        t,
        tIssues,
        list: flowListFormat(locale),
        issues,
        run,
        compare: compare ?? null,
        stoppedAt: failure?.nodeId ?? null,
        reasons,
      }),
    [shown, t, tIssues, locale, issues, run, compare, failure, reasons],
  );
  const words = useStable(
    computedWords,
    JSON.stringify([
      [...computedWords.names],
      [...computedWords.descriptions],
      [...computedWords.strips],
      [...computedWords.explanations],
    ]),
  );
  const compareContext = useMemo(
    () =>
      compareLabels === null || compareFaces === null
        ? null
        : { labels: compareLabels, faces: compareFaces },
    [compareLabels, compareFaces],
  );
  // The legend says what a comparison's marks mean.
  const legendEntries = useMemo<readonly FlowLegendEntry[] | undefined>(
    () =>
      compare === undefined
        ? legend
        : [
            ...(legend ?? []),
            {
              id: 'compare:differs',
              swatch: { node: 'differs' },
              label: t('compare.legend.differs'),
            },
            {
              id: 'compare:only',
              swatch: { edgeLabel: true },
              label: t('compare.legend.onlyOne'),
            },
          ],
    [legend, compare, t],
  );

  const computedLooks = useMemo(
    () =>
      flowLooks({
        graph: shown,
        run,
        compare: compare ?? null,
        primary,
        incident,
        ringPrimary: primary !== failureHighlight,
      }),
    [shown, run, compare, primary, incident, failureHighlight],
  );
  const looks = useStable(
    computedLooks.nodes,
    looksSignature(computedLooks.nodes),
  );
  const edgeLooks = useStable(
    computedLooks.edges,
    looksSignature(computedLooks.edges),
  );
  const computedCounters = useMemo(
    () => flowFrameCounters(shown, run, t),
    [shown, run, t],
  );
  const frameCounters = useStable(
    computedCounters,
    looksSignature(computedCounters),
  );

  const nodes = useMemo(
    () => (layout ? toFlowNodes(shown, layout, plan, phase) : []),
    [shown, layout, plan, phase],
  );
  const edges = useMemo(
    () =>
      layout ? toFlowEdges(shown, layout, baseId, edgeLabel, plan, phase) : [],
    [shown, layout, baseId, edgeLabel, plan, phase],
  );

  const frameRef = useRef<HTMLDivElement>(null);
  const [lastFocused, setLastFocused] = useState<string | null>(null);
  const tabStopId = flowTabStop(shown, selectedId, lastFocused);

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

  // Once a relayout has settled, the open node is brought back into view
  // if it moved out of it (a refit already shows it).
  const settling = useRef(false);
  useEffect(() => {
    if (plan !== null) {
      settling.current = true;
      return undefined;
    }
    if (!settling.current) return undefined;
    settling.current = false;
    if (selectedId === null || view !== 'chart') return undefined;
    const frame = requestAnimationFrame(() => reveal(selectedId));
    return () => cancelAnimationFrame(frame);
  }, [plan, selectedId, view, reveal]);

  // While a run plays, the node it reaches is followed into view, as long
  // as the reader has not moved the view themselves.
  const following = useRef(true);
  const playing = playback !== undefined;
  useEffect(() => {
    following.current = true;
  }, [layoutKey, playing]);
  // One string per set of running nodes: a new frame of the same set says
  // nothing new.
  const runningKey =
    playback && run
      ? Object.entries(run.nodes)
          .filter(([, info]) => info.state === 'running')
          .map(([id]) => id)
          .join('\n')
      : '';
  const lastRunning = useRef<readonly string[]>([]);
  useEffect(() => {
    const ids = runningKey === '' ? [] : runningKey.split('\n');
    const fresh = ids.find((id) => !lastRunning.current.includes(id));
    lastRunning.current = ids;
    if (fresh === undefined || !following.current || view !== 'chart')
      return undefined;
    const frame = requestAnimationFrame(() => reveal(fresh));
    return () => cancelAnimationFrame(frame);
  }, [runningKey, view, reveal]);

  // Strips settle softly while a run plays on; going back swaps them.
  const playbackT = playback?.t ?? null;
  const [clock, setClock] = useState<{ t: number | null; forward: boolean }>({
    t: playbackT,
    forward: false,
  });
  if (clock.t !== playbackT)
    setClock({
      t: playbackT,
      forward: playbackT !== null && clock.t !== null && playbackT > clock.t,
    });
  const forward = clock.forward;

  // A change made outside this tab rings its nodes once, after their
  // relayout. The key the canvas opens with is never rung.
  const rungKey = useRef(changed?.key);
  const [ring, setRing] = useState<FlowRenderContextValue['ring']>(null);
  useEffect(() => {
    if (changed === undefined || !settled || layout === null) return;
    if (rungKey.current === changed.key) return;
    rungKey.current = changed.key;
    if (!reduced) setRing({ ids: changed.ids, key: changed.key });
  }, [changed, settled, layout, reduced]);
  useEffect(() => {
    if (ring === null) return undefined;
    const timer = setTimeout(() => setRing(null), FLOW_RING_TOTAL);
    return () => clearTimeout(timer);
  }, [ring]);

  // A host's highlight says what it shows, once, politely.
  const [spoken, setSpoken] = useState({ text: '', serial: 0 });
  const lastSpoken = useRef<string | undefined>(undefined);
  useEffect(() => {
    const text = highlight?.announcement;
    if (text === lastSpoken.current) return;
    lastSpoken.current = text;
    if (text === undefined || text === '') return;
    setSpoken((previous) => ({ text, serial: previous.serial + 1 }));
  }, [highlight]);

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const nodeKind = useCallback(
    (id: string) => shown.nodes.find((node) => node.id === id)?.kind,
    [shown],
  );

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
      looks,
      edgeLooks,
      frameCounters,
      stripSettle: forward && !reduced,
      ring,
      branchHover: paths !== undefined,
      explanations: words.explanations,
      compare: compareContext,
      edgeNotes,
      onActivate: (id) => onSelect?.(selectedId === id ? null : id),
      onKeyDown: (id, event: KeyboardEvent<HTMLButtonElement>) => {
        const key = FLOW_NAVIGATION_KEYS[event.key];
        if (key === undefined || layout === null) return;
        event.preventDefault();
        const next = flowNeighbour(shown, layout, id, key);
        // The canvas pans the box into view itself; the browser's own
        // scroll-into-view would shift the clipped frame instead.
        if (next !== null) buttonOf(next)?.focus({ preventScroll: true });
      },
      onFocusNode: (id, event: FocusEvent<HTMLButtonElement>) => {
        setLastFocused(id);
        // A mouse press focuses the button too, and panning then would drag
        // the box out from under the pointer mid-click — follow keyboard
        // focus only.
        if (event.currentTarget.matches(':focus-visible')) {
          reveal(id);
          // The keyboard brings a node's own lines forward; a condition's
          // paths are the Paths list's to show, so tabbing never flickers.
          setOwn(highlightForIncident(shown, id));
        }
      },
      onBlurNode: () => {
        if (ownRef.current?.quietRest === false) setOwn(null);
      },
      onHoverNode: (id) => {
        clearTimeout(hoverTimer.current);
        if (id === null) {
          setOwn(null);
          return;
        }
        if (nodeKind(id) === 'gate' && paths !== undefined) {
          hoverTimer.current = setTimeout(
            () => setOwn(highlightForBranch(shown, paths, id)),
            HOVER_INTENT_MS,
          );
          return;
        }
        setOwn(highlightForIncident(shown, id));
      },
      onHoverBranch: (branch) => {
        clearTimeout(hoverTimer.current);
        if (branch === null || paths === undefined) {
          setOwn(null);
          return;
        }
        hoverTimer.current = setTimeout(
          () =>
            setOwn(
              highlightForBranch(shown, paths, branch.gateId, branch.decision),
            ),
          HOVER_INTENT_MS,
        );
      },
    }),
    [
      baseId,
      selectedId,
      tabStopId,
      controlsId,
      issues,
      words,
      looks,
      edgeLooks,
      frameCounters,
      forward,
      reduced,
      ring,
      compareContext,
      edgeNotes,
      paths,
      onSelect,
      layout,
      shown,
      buttonOf,
      reveal,
      setOwn,
      nodeKind,
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
        className={FLOW_TOUCH_TARGET}
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

  const announcer = (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-slot="flow-announcer"
    >
      {spoken.text === '' ? null : (
        <span key={spoken.serial}>{spoken.text}</span>
      )}
    </div>
  );

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
      {announcer}
      {view === 'list' ? (
        <div ref={swapRef} className={cn(frameClass, 'overflow-y-auto')}>
          {/* The corners line up along their tops: a pill or a panel the
              host stacks under its view switch never pulls the other
              corner's buttons down to its middle. */}
          <div className="flex items-start gap-1 px-3 pt-3">
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
            run={run}
            {...(compare === undefined ? {} : { compare })}
            highlight={primary}
            stoppedAt={failure?.nodeId ?? null}
          />
          {/* The host's verbs stay with the List view: on a phone, where
              the list is the default, they are the only way to reach them. */}
          {toolbar && (
            <div className="sticky bottom-0 flex justify-center px-3 pt-2 pb-[max(1rem,var(--mobile-nav-clearance-live,0px))]">
              <div className="ring-border bg-background flex w-max max-w-full items-center gap-2 rounded-lg p-1 shadow-sm ring-1">
                {toolbar}
              </div>
            </div>
          )}
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
          data-flow-transition={plan === null ? undefined : 'move'}
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
                  refitDuration={plan === null ? 0 : FLOW_DURATION.medium}
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
                  onMoveStart={(event) => {
                    // The reader moved the view: stop following the run.
                    if (event !== null) following.current = false;
                  }}
                  onPaneClick={() => {
                    if (selectedId !== null) onSelect?.(null);
                  }}
                  backgroundProps={{ gap: 16 }}
                  centerActions={toolbar}
                  topStartActions={topStart}
                  topEndActions={topEnd}
                  cornerActions={
                    viewToggle || legendEntries || cornerActions ? (
                      <>
                        {legendEntries && (
                          <FlowLegend entries={legendEntries} />
                        )}
                        {viewToggle}
                        {cornerActions}
                      </>
                    ) : undefined
                  }
                >
                  {run !== null && !reduced && (
                    <FlowPulseLayer
                      travelling={run.travelling}
                      layout={layout}
                    />
                  )}
                </FlowCanvas>
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
 * picture, and a graph that changes on screen glides to its new layout
 * keeping every row in order.
 *
 * A run shows on it as an overlay (where each node ended) or a playback
 * (the host's moment `t`, values travelling the lines); a failed run brings
 * the way to its failure forward. Paths and highlights bring parts of the
 * chart forward and step back from the rest — dashed, never faded.
 *
 * The chart is one Tab stop: arrows follow the lines and the rows, Home and
 * End jump to Start and End, Enter or Space opens a node. The List view
 * says the same as text. Layout runs in a worker; until the first one
 * lands the frame shows a skeleton column, then the chart fades in. Under
 * reduced motion nothing glides, rings or travels.
 */
export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
