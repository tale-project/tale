'use client';

import '@xyflow/react/dist/style.css';
import { Button } from '@tale/ui/button';
import { useT } from '@tale/ui/i18n/client';
import { HStack } from '@tale/ui/layout';
import { useTheme } from '@tale/ui/theme';
import {
  Background,
  getViewportForBounds,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  useStore,
  useStoreApi,
  type FitViewOptions,
  type ReactFlowProps,
  type Viewport,
} from '@xyflow/react';
import { Maximize, Minus, Plus } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  type ComponentProps,
  type MutableRefObject,
  type ReactNode,
} from 'react';

import { usePrefersReducedMotion } from '../../hooks/use-prefers-reduced-motion';

/** The `--ease-out-quint` curve, for viewport moves run from script. */
export const easeOutQuint = (t: number) => 1 - (1 - t) ** 5;

/** Viewport move durations: the `--duration-*` tokens, 0 under reduced
 *  motion (React Flow eases in script, out of reach of the CSS rule). */
export const FLOW_VIEWPORT_DURATION = {
  zoom: 150,
  fit: 300,
  reveal: 200,
} as const;

/** How a fit treats a graph too big to show whole at a readable size. */
export type FlowFitPolicy = 'all' | 'auto';

/** Below this zoom an `auto` fit stops shrinking the graph to show it all. */
const READABLE_ZOOM = 0.5;
/** Room an `auto` fit leaves above the graph's top. */
const TOP_MARGIN = 24;

/**
 * The ONE base React Flow canvas every graph editor in the app builds on
 * (the workflow canvas). Owns the shared chrome and house defaults —
 * theme-reactive `colorMode`, hidden attribution, the fit (initial, and
 * kept while the canvas resizes until the reader moves the view), the
 * corner zoom cluster (zoom in / out / reset) and the bottom-center action
 * toolbar — so editors differ only in nodes/edges/handlers and
 * minimap/background styling:
 *
 *  - `backgroundProps`  — always rendered; pass variant/gap/color to style.
 *  - `minimapProps`     — renders a MiniMap when provided.
 *  - `centerActions`    — editor-specific buttons in the bottom-center toolbar.
 *  - `cornerActions`    — extra buttons after zoom/reset in the corner cluster.
 *  - `topStartActions` / `topEndActions` — the top corners (a view switch,
 *    the canvas's own verbs).
 *  - `fitPolicy`        — `all` fits every node; `auto` does too while that
 *    keeps the graph readable (zoom 0.5 or more), else shows its top at a
 *    readable zoom, centred on its first node.
 *  - `fitKey`           — refit when it changes, while the view is still
 *    where the last fit left it (the graph was laid out again).
 *
 * Viewport moves ease out (quint) over the duration tokens and jump under
 * reduced motion. Everything else spreads onto `<ReactFlow>` untouched;
 * overlays and `<Panel>`s ride through `children`.
 */
export interface FlowCanvasProps extends ReactFlowProps {
  backgroundProps?: ComponentProps<typeof Background>;
  minimapProps?: ComponentProps<typeof MiniMap>;
  /** Editor-specific buttons rendered in the bottom-center toolbar. */
  centerActions?: ReactNode;
  /** Buttons after zoom in / zoom out / reset view in the corner cluster. */
  cornerActions?: ReactNode;
  /** The top-left corner. */
  topStartActions?: ReactNode;
  /** The top-right corner. */
  topEndActions?: ReactNode;
  /** @default 'all' */
  fitPolicy?: FlowFitPolicy;
  /** Refit when this changes, while the view is still the fit. */
  fitKey?: unknown;
}

/** The view the last fit left, or `null` while a fit is under way. */
type FitMemo = MutableRefObject<Viewport | null>;

const sameView = (a: Viewport, b: Viewport) =>
  Math.abs(a.x - b.x) < 0.5 &&
  Math.abs(a.y - b.y) < 0.5 &&
  Math.abs(a.zoom - b.zoom) < 0.001;

/** Fit by the policy, then remember where the fit left the view. */
function useFitAndRemember(memo: FitMemo, policy: FlowFitPolicy) {
  const { fitView, getViewport, setViewport, getNodes, getNodesBounds } =
    useReactFlow();
  const store = useStoreApi();
  const reduced = usePrefersReducedMotion();
  return useCallback(
    async (options?: FitViewOptions) => {
      memo.current = null;
      const duration = reduced ? 0 : (options?.duration ?? 0);
      const { width, height } = store.getState();
      const minZoom = options?.minZoom ?? store.getState().minZoom;
      const nodes = getNodes();
      if (policy === 'auto' && nodes.length > 0 && width > 0 && height > 0) {
        const bounds = getNodesBounds(nodes);
        const padding =
          typeof options?.padding === 'number' ? options.padding : 0.1;
        const whole = getViewportForBounds(
          bounds,
          width,
          height,
          0,
          Number.POSITIVE_INFINITY,
          padding,
        );
        if (whole.zoom < READABLE_ZOOM) {
          // Too big to read whole: show its top at a readable zoom, centred
          // on the topmost box (Start), and let the reader scroll on.
          const zoom = Math.min(
            1,
            Math.max(
              READABLE_ZOOM,
              minZoom,
              width / (bounds.width * (1 + padding)),
            ),
          );
          const top = [...nodes].sort(
            (a, b) =>
              a.position.y - b.position.y || a.position.x - b.position.x,
          )[0];
          const centreX =
            top === undefined
              ? bounds.x + bounds.width / 2
              : top.position.x + (top.measured?.width ?? top.width ?? 0) / 2;
          await setViewport(
            {
              x: width / 2 - centreX * zoom,
              y: TOP_MARGIN - bounds.y * zoom,
              zoom,
            },
            { duration, ease: easeOutQuint, interpolate: 'linear' },
          );
          memo.current = getViewport();
          return;
        }
      }
      await fitView({
        ...options,
        duration,
        ease: easeOutQuint,
        interpolate: 'linear',
      });
      memo.current = getViewport();
    },
    [
      memo,
      policy,
      reduced,
      store,
      fitView,
      getViewport,
      setViewport,
      getNodes,
      getNodesBounds,
    ],
  );
}

/**
 * Keeps the fit true while the canvas's box changes size — a window
 * resized, a tab strip wrapping onto a second row, an inspector opening
 * beside it — and when the graph is laid out again (`fitKey`). It refits
 * only while the view is still where a fit left it: once anything moves it —
 * the reader panning or zooming, the page bringing a picked node into
 * sight — the view is theirs until "reset view" fits it again. Under the
 * `all` policy, only to a fit that shows every node: past the zoom floor a
 * fit merely re-centres, which would pull a node the page is bringing into
 * sight back out of it.
 * Must render INSIDE <ReactFlow>.
 */
function FlowAutoFit({
  memo,
  fitViewOptions,
  policy,
  fitKey,
}: {
  memo: FitMemo;
  fitViewOptions?: FitViewOptions;
  policy: FlowFitPolicy;
  fitKey: unknown;
}) {
  const { getViewport, getNodes, getNodesBounds } = useReactFlow();
  const fitAndRemember = useFitAndRemember(memo, policy);
  const minZoom = useStore((state) => state.minZoom);
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  // Nodes, not "nodes initialized": a canvas that gives its nodes explicit
  // sizes has no handles to measure, and that flag never turns true for it.
  const hasNodes = useStore((state) => state.nodeLookup.size > 0);
  useEffect(() => {
    if (!hasNodes || !width || !height) return undefined;
    // Moved since the last fit: the view is not the fit any more.
    const fitted = memo.current;
    if (fitted !== null && !sameView(getViewport(), fitted)) return undefined;
    const frame = requestAnimationFrame(() => {
      if (policy === 'all') {
        // The zoom that would show every node, before the floor clamps it.
        const { zoom } = getViewportForBounds(
          getNodesBounds(getNodes()),
          width,
          height,
          0,
          Number.POSITIVE_INFINITY,
          fitViewOptions?.padding ?? 0.1,
        );
        if (zoom < (fitViewOptions?.minZoom ?? minZoom)) return;
      }
      void fitAndRemember(fitViewOptions);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    width,
    height,
    hasNodes,
    minZoom,
    memo,
    policy,
    fitKey,
    getViewport,
    getNodes,
    getNodesBounds,
    fitAndRemember,
    fitViewOptions,
  ]);
  return null;
}

/** Corner cluster: zoom in / zoom out / reset view, then the host's own.
 *  Must render INSIDE <ReactFlow> — `useReactFlow` reads its store.
 *  Resetting hands the view back to the fit, which then follows the
 *  canvas's size. */
function FlowCornerControls({
  memo,
  policy,
  fitViewOptions,
  children,
}: {
  memo: FitMemo;
  policy: FlowFitPolicy;
  fitViewOptions?: FitViewOptions;
  children?: ReactNode;
}) {
  const { t } = useT('common');
  const { zoomIn, zoomOut } = useReactFlow();
  const reduced = usePrefersReducedMotion();
  const fitAndRemember = useFitAndRemember(memo, policy);
  const zoom = {
    duration: reduced ? 0 : FLOW_VIEWPORT_DURATION.zoom,
    ease: easeOutQuint,
  };
  return (
    <Panel
      position="bottom-left"
      className="mb-[max(1rem,var(--mobile-nav-clearance-live,0px))]! flex flex-col gap-1"
    >
      <Button
        size="icon"
        variant="secondary"
        title={t('flow.zoomIn')}
        tooltipSide="right"
        onClick={() => void zoomIn(zoom)}
      >
        <Plus className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="secondary"
        title={t('flow.zoomOut')}
        tooltipSide="right"
        onClick={() => void zoomOut(zoom)}
      >
        <Minus className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="secondary"
        title={t('flow.resetView')}
        tooltipSide="right"
        onClick={() =>
          void fitAndRemember({
            padding: 0.2,
            ...fitViewOptions,
            duration: FLOW_VIEWPORT_DURATION.fit,
          })
        }
      >
        <Maximize className="size-4" />
      </Button>
      {children}
    </Panel>
  );
}

/** Bottom-center toolbar: the editor's primary actions. */
function FlowCenterToolbar({ centerActions }: { centerActions?: ReactNode }) {
  if (!centerActions) return null;
  return (
    <Panel
      position="bottom-center"
      className="mr-0! mb-[max(1rem,var(--mobile-nav-clearance-live,0px))]! ml-6! w-max max-w-[calc(100%-6rem)] md:ml-0! md:max-w-[calc(100%-2rem)]"
    >
      <HStack
        gap={2}
        className="ring-border bg-background rounded-lg p-1 shadow-sm ring-1"
      >
        {centerActions}
      </HStack>
    </Panel>
  );
}

export function FlowCanvas({
  backgroundProps,
  minimapProps,
  centerActions,
  cornerActions,
  topStartActions,
  topEndActions,
  fitPolicy = 'all',
  fitKey,
  children,
  ...flowProps
}: FlowCanvasProps) {
  const { resolvedTheme } = useTheme();
  const fitMemo = useRef<Viewport | null>(null);
  // The `auto` fit is the canvas's own: React Flow's built-in fit would show
  // a tall graph whole at an unreadable zoom first.
  const builtInFit = fitPolicy === 'all' && flowProps.fitView !== false;
  return (
    <ReactFlow
      colorMode={resolvedTheme}
      proOptions={{ hideAttribution: true }}
      {...flowProps}
      fitView={builtInFit}
    >
      <Background {...backgroundProps} />
      {flowProps.fitView !== false && (
        <FlowAutoFit
          memo={fitMemo}
          fitViewOptions={flowProps.fitViewOptions}
          policy={fitPolicy}
          fitKey={fitKey}
        />
      )}
      {topStartActions && (
        <Panel position="top-left" className="flex items-center gap-1">
          {topStartActions}
        </Panel>
      )}
      {topEndActions && (
        <Panel position="top-right" className="flex items-center gap-1">
          {topEndActions}
        </Panel>
      )}
      <FlowCornerControls
        memo={fitMemo}
        policy={fitPolicy}
        fitViewOptions={flowProps.fitViewOptions}
      >
        {cornerActions}
      </FlowCornerControls>
      <FlowCenterToolbar centerActions={centerActions} />
      {minimapProps && <MiniMap {...minimapProps} />}
      {children}
    </ReactFlow>
  );
}
