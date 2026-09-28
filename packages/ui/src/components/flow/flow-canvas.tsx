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
  type FitViewOptions,
  type ReactFlowProps,
  type Viewport,
} from '@xyflow/react';
import { Maximize, Minus, Plus, Sparkles } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  type ComponentProps,
  type MutableRefObject,
  type ReactNode,
} from 'react';

/**
 * The ONE base React Flow canvas every graph editor in the app builds on
 * (the automation canvas today). Owns the
 * shared chrome and house defaults — theme-reactive `colorMode`, hidden
 * attribution, the fit (initial, and kept while the canvas resizes until the
 * reader moves the view), the corner zoom cluster (zoom in / out / reset)
 * and the bottom-center action toolbar (editor actions + the AI-editor
 * toggle) — so editors differ only in nodes/edges/handlers and
 * minimap/background styling:
 *
 *  - `backgroundProps` — always rendered; pass variant/gap/color to style.
 *  - `minimapProps`    — renders a MiniMap when provided.
 *  - `centerActions`   — editor-specific buttons in the bottom-center toolbar.
 *  - `onOpenAi`        — adds the ✨ button to the bottom-center toolbar.
 *
 * Everything else spreads onto `<ReactFlow>` untouched; overlays and
 * `<Panel>`s ride through `children`.
 */
export interface FlowCanvasProps extends ReactFlowProps {
  backgroundProps?: ComponentProps<typeof Background>;
  minimapProps?: ComponentProps<typeof MiniMap>;
  /** Editor-specific buttons rendered in the bottom-center toolbar. */
  centerActions?: ReactNode;
  /** Opens the editor's AI assistant panel (✨ in the bottom-center toolbar). */
  onOpenAi?: () => void;
  /** Whether the AI assistant panel is open — drives the ✨ button's pressed
   *  (active) state so it reads as a toggle rather than a one-way open. */
  aiOpen?: boolean;
}

/** The view the last fit left, or `null` while a fit is under way. */
type FitMemo = MutableRefObject<Viewport | null>;

const sameView = (a: Viewport, b: Viewport) =>
  Math.abs(a.x - b.x) < 0.5 &&
  Math.abs(a.y - b.y) < 0.5 &&
  Math.abs(a.zoom - b.zoom) < 0.001;

/** Fit, then remember where the fit left the view. */
function useFitAndRemember(memo: FitMemo) {
  const { fitView, getViewport } = useReactFlow();
  return useCallback(
    async (options?: FitViewOptions) => {
      memo.current = null;
      await fitView(options);
      memo.current = getViewport();
    },
    [memo, fitView, getViewport],
  );
}

/**
 * Keeps the initial fit true while the canvas's box changes size — a window
 * resized, a tab strip wrapping onto a second row, an inspector opening
 * beside it. React Flow fits once, against the box it had at mount; a canvas
 * that then narrowed or shortened kept that zoom and cut its last nodes off.
 * It refits only while the view is still where a fit left it: once anything
 * moves it — the reader panning or zooming, the page bringing a picked node
 * into sight — the view is theirs until "reset view" fits it again. And only
 * to a fit that shows every node: past the zoom floor a fit merely
 * re-centres, which would pull a node the page is bringing into sight (a
 * picked box beside the inspector) back out of it.
 * Must render INSIDE <ReactFlow>.
 */
function FlowAutoFit({
  memo,
  fitViewOptions,
}: {
  memo: FitMemo;
  fitViewOptions?: FitViewOptions;
}) {
  const { getViewport, getNodes, getNodesBounds } = useReactFlow();
  const fitAndRemember = useFitAndRemember(memo);
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
      void fitAndRemember(fitViewOptions);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    width,
    height,
    hasNodes,
    minZoom,
    memo,
    getViewport,
    getNodes,
    getNodesBounds,
    fitAndRemember,
    fitViewOptions,
  ]);
  return null;
}

/** Corner cluster: zoom in / zoom out / reset view.
 *  Must render INSIDE <ReactFlow> — `useReactFlow` reads its store. Resetting
 *  hands the view back to the fit, which then follows the canvas's size. */
function FlowCornerControls({ memo }: { memo: FitMemo }) {
  const { t } = useT('common');
  const { zoomIn, zoomOut } = useReactFlow();
  const fitAndRemember = useFitAndRemember(memo);
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
        onClick={() => void zoomIn({ duration: 150 })}
      >
        <Plus className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="secondary"
        title={t('flow.zoomOut')}
        tooltipSide="right"
        onClick={() => void zoomOut({ duration: 150 })}
      >
        <Minus className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="secondary"
        title={t('flow.resetView')}
        tooltipSide="right"
        onClick={() => void fitAndRemember({ padding: 0.2, duration: 300 })}
      >
        <Maximize className="size-4" />
      </Button>
    </Panel>
  );
}

/** Bottom-center toolbar: the editor's primary actions (+ the AI toggle). */
function FlowCenterToolbar({
  centerActions,
  onOpenAi,
  aiOpen,
}: {
  centerActions?: ReactNode;
  onOpenAi?: () => void;
  aiOpen?: boolean;
}) {
  const { t } = useT('common');
  if (!centerActions && !onOpenAi) return null;
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
        {onOpenAi && (
          <Button
            variant="secondary"
            size="icon"
            title={t('flow.aiEditor')}
            aria-pressed={aiOpen}
            onClick={onOpenAi}
          >
            <Sparkles className="size-4" />
          </Button>
        )}
      </HStack>
    </Panel>
  );
}

export function FlowCanvas({
  backgroundProps,
  minimapProps,
  centerActions,
  onOpenAi,
  aiOpen,
  children,
  ...flowProps
}: FlowCanvasProps) {
  const { resolvedTheme } = useTheme();
  const fitMemo = useRef<Viewport | null>(null);
  return (
    <ReactFlow
      colorMode={resolvedTheme}
      fitView
      proOptions={{ hideAttribution: true }}
      {...flowProps}
    >
      <Background {...backgroundProps} />
      {flowProps.fitView !== false && (
        <FlowAutoFit memo={fitMemo} fitViewOptions={flowProps.fitViewOptions} />
      )}
      <FlowCornerControls memo={fitMemo} />
      <FlowCenterToolbar
        centerActions={centerActions}
        onOpenAi={onOpenAi}
        aiOpen={aiOpen}
      />
      {minimapProps && <MiniMap {...minimapProps} />}
      {children}
    </ReactFlow>
  );
}
